// The page's own logic. This is a reference consumer of the GWRG distribution
// spec: it reads the same versions.json and manifest.json a third-party
// installer reads, resolved the same way, and it uses the same verify.mjs,
// extract.mjs and install.mjs. If the spec or the ABI drifts, this page breaks
// in CI before anything else does.
//
// What makes it different from the single-ROM converter the other projects
// vendor is the shape of the job, and the manifest states that shape rather
// than the page assuming it: this tool's input declares `runPerFile`, so the
// user hands over a library and the module runs once per file. The spec's
// wording, in spec/03-manifest.md: "a converter that converts a library derives
// each name from the file it converted".
//
// The user points at a Doom install rather than at a folder we name. A DOS
// install keeps DOOM.WAD beside the executable, the Unity and KEX re-releases
// keep it in a base/ subfolder, a Steam copy buries both under a long path, and
// a folder somebody collected WADs into has no layout at all. Asking someone to
// find the right subfolder before the page will talk to them is a worse
// experience than walking the tree ourselves. So: take a directory, find the
// .wad files wherever they are, and say what was found before doing anything
// with it.
//
// Every string that came from the module or the manifest is inserted with
// textContent, never innerHTML. Both are data we fetched, not code we trust.
// A module-supplied string never becomes a filename at all: the module emits
// the id `whd`, install.mjs matches it against the manifest, and the name comes
// from the manifest and from the user's own file.

import { verify } from "./verify.mjs";
import { makeZip } from "./zip.mjs";
import {
  INSTALL_ROOT, fileNameProblem, outputDir, outputFileName, planInstall, stemOf,
} from "./install.mjs";
import { SUPPORTED, applyStatic, localeText, onLocaleChange, setLocale, locale, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);

// Where the index lives, relative to this page. build-page.sh writes the real
// value into config.json; this is the fallback for a site laid out the usual
// way. The page hardcodes no filenames beyond these two entry points, because
// a consuming tool cannot hardcode any.
const DEFAULT_VERSIONS = "dist/versions.json";
// An offline bundle is a manifest and its files in one directory, with no index
// above them. Falling back to a manifest beside the page is what lets this same
// page open one.
const DEFAULT_MANIFEST = "manifest.json";
// Per WAD, not for the run as a whole. The module converts Doom II in a few
// seconds on a desktop; four minutes is the budget for a phone having a bad
// day, and it is what the timeout means because the ABI has no cancel flag.
const RUN_TIMEOUT_MS = 240_000;

const state = {
  wasmBytes: null, tool: null, manifest: null, moduleSha256: null,
  index: null, version: null, versionsUrl: null, manifestUrl: null,
  showPrereleases: false,
  // What the user pointed us at: one entry per .wad found, in the order the
  // tree gave them. Each is { path, name, size, bytes, sha1, variant, outName }.
  found: [],
  // Whatever the scan refused, so it can be shown rather than silently dropped.
  skipped: [],
  // The folder the user picked, and how many files in it were none of our
  // business -- both only so the page can say what it did with the selection.
  root: null,
  ignored: 0,
  scanProblem: null,
  // One entry per converted WAD, accumulated across runs rather than
  // replacing: { source, outputId, data, sha256, warnings }.
  produced: [],
  // The WAD a run stopped on, if one did. It never reaches `produced`, so
  // without this the table would simply not mention the file that failed.
  failure: null,
  running: false,
};

const setStatus = (el, cls, text) => {
  el.hidden = false;
  el.className = `status ${cls}`;
  el.textContent = text;
};

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function digest(algo, bytes) {
  return hex(await crypto.subtle.digest(algo, bytes));
}

/** The one input this tool declares. `runPerFile` makes it the library slot. */
const theInput = () => state.tool?.inputs?.[0] ?? null;
/** The output the produced files carry. A runPerFile tool declares exactly one. */
const theOutput = () => state.tool?.outputs?.[0] ?? null;
/** The target that says it uses this tool -- where the artifacts and systems live. */
function targetForTool() {
  const targets = state.manifest?.targets ?? [];
  const id = state.tool?.id;
  return targets.find((tg) => (tg.uses ?? []).some((u) => u.tool === id)) ?? targets[0] ?? null;
}

/**
 * Whether the manifest gives this page anything to recognise a file by. With no
 * variants declared there is no table to match against, so neither "known" nor
 * "unknown" is a statement this page is entitled to make about a WAD.
 */
const knowsReleases = () => (theInput()?.variants ?? []).length > 0;

/**
 * Whether this input insists on a file it recognises. `strict` defaults to
 * true: an input that says nothing wants a known hash. This project's does not,
 * because a PWAD, a fan megawad or an IWAD from a release nobody hashed yet
 * cannot match a known hash by construction and converts perfectly well.
 */
const isStrict = (input) => input?.strict !== false;

// --- load and verify the module -------------------------------------------
//
// This happens silently. Verification is not a feature the user asked for and
// they cannot act on its details; it either passes, in which case saying so is
// noise, or it fails, in which case the page cannot work and must say why.

// Revalidate rather than trusting the cache. A manifest names its module and
// that module's hash, so a stale manifest fetches a stale module -- and because
// the pair is internally consistent the hash check passes, leaving the
// staleness to surface later as a confusing verification failure.
const FRESH = { cache: "no-cache" };

/**
 * Fetches a manifest and the module it describes, and checks both. Returns the
 * loaded pair, or throws with the reason this source is unusable.
 */
async function loadFrom(manifestUrl) {
  const manRes = await fetch(manifestUrl, FRESH).catch(() => null);
  if (!manRes || !manRes.ok) throw new Error(t().fatal.noManifest);
  const manifest = await manRes.json();

  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `manifest declares schemaVersion ${manifest.schemaVersion}, this page reads 1`);
  }
  // A version may legitimately declare no converter -- `tools: []` is the
  // spec's way of saying "nothing to convert, just install what is published".
  // That is not an error, it is a different page state, and it is the state
  // this project publishes until the converter is declared.
  const tool = (manifest.tools ?? []).find((x) => (x.inputs ?? []).some((i) => i.runPerFile))
    ?? manifest.tools?.[0];
  if (!tool) return { manifest, tool: null, bytes: null, sha256: null };

  if (tool.processor?.type !== "wasm" || tool.processor?.version !== 1) {
    throw new Error(
      `manifest declares processor ${tool.processor?.type}/${tool.processor?.version}, ` +
      `this page implements wasm/1`);
  }

  // Every url in a manifest is a plain filename resolved beside the manifest
  // that named it, which is what lets the same manifest work from this site and
  // from an offline bundle.
  const binary = tool.binary;
  const moduleUrl = new URL(binary.url ?? binary.file, new URL(manifestUrl, location.href));
  // Content-address the request so a new module can never be served from a
  // cache entry belonging to an older one. The hash is checked below either
  // way; this stops the wrong bytes arriving in the first place.
  if (binary.sha256) moduleUrl.searchParams.set("v", binary.sha256.slice(0, 16));
  const wasmRes = await fetch(moduleUrl, FRESH);
  if (!wasmRes.ok) throw new Error(`could not fetch ${binary.file} (${wasmRes.status})`);
  const bytes = new Uint8Array(await wasmRes.arrayBuffer());

  if (binary.bytes && bytes.length !== binary.bytes) {
    throw new Error(`${binary.file}: expected ${binary.bytes} bytes, got ${bytes.length}`);
  }

  // The manifest says which bytes it describes. If they disagree, the manifest
  // is describing something other than what we are about to run, and the honest
  // response is to refuse rather than to prefer one of them.
  const sha256 = await digest("SHA-256", bytes);
  if (sha256 !== binary.sha256) throw new Error(t().fatal.mismatch);

  // The real gate: decided by reading the binary, not by reading the manifest.
  const result = verify(bytes);
  if (!result.ok) throw new Error(t().fatal.unsafe(result.errors.join("; ")));

  return { manifest, tool, bytes, sha256 };
}

/** Reads config.json, which build-page.sh writes. Absent is not an error. */
async function readConfig() {
  try {
    const cfg = await fetch("config.json", FRESH);
    if (cfg.ok) return await cfg.json();
  } catch { /* no config: use the defaults below */ }
  return {};
}

async function boot() {
  try {
    const cfg = await readConfig();

    // A pinned build names one manifest and gets no picker: an offline bundle
    // has exactly one version in it, and a deliberately pinned page is pinned.
    if (cfg.manifestUrl) {
      await loadVersion(cfg.manifestUrl, null);
      renderPicker();
      return;
    }

    state.versionsUrl = cfg.versionsUrl || DEFAULT_VERSIONS;
    const index = await loadIndex(state.versionsUrl);
    if (index) {
      state.index = index;
      const entry = defaultVersion(index);
      if (!entry) throw new Error(t().fatal.noVersions);
      await loadVersion(new URL(entry.manifest, new URL(state.versionsUrl, location.href)), entry);
      renderPicker();
      return;
    }

    // No index: a manifest beside the page is the offline-bundle layout.
    await loadVersion(DEFAULT_MANIFEST, null);
    renderPicker();
  } catch (e) {
    fatal(e);
  }
}

function fatal(e) {
  const box = $("fatal");
  box.hidden = false;
  box.textContent = t().fatal.cannotRun(e?.message ?? e);
  $("go").disabled = true;
  $("pick").disabled = true;
}

/** The version index, or null when this site does not publish one. */
async function loadIndex(url) {
  const res = await fetch(url, FRESH).catch(() => null);
  if (!res || !res.ok) return null;
  const index = await res.json();
  if (index.schemaVersion !== 1) {
    throw new Error(`versions.json declares schemaVersion ${index.schemaVersion}, this page reads 1`);
  }
  if (!Array.isArray(index.versions) || index.versions.length === 0) {
    throw new Error(t().fatal.noVersions);
  }
  return index;
}

/** Versions this page will offer, newest first. The spec guarantees the order. */
const offered = () =>
  (state.index?.versions ?? []).filter((v) => state.showPrereleases || !v.prerelease);

/** The newest release, preferring a stable one -- a prerelease is opt-in. */
function defaultVersion(index) {
  return index.versions.find((v) => !v.prerelease) ?? index.versions[0];
}

/**
 * Loads one version and rebuilds everything that depends on it.
 *
 * A version switch is a full reload, not a swap of the module: a different
 * version may declare different inputs, different accepted hashes, a different
 * output extension and a different set of systems. What the user already chose is
 * discarded rather than carried over, because a scan is only meaningful against
 * the version that produced it.
 */
async function loadVersion(manifestUrl, entry) {
  resetScan();
  $("fatal").hidden = true;

  const { manifest, tool, bytes, sha256 } = await loadFrom(manifestUrl);
  state.manifestUrl = String(manifestUrl);
  state.version = entry;
  state.wasmBytes = bytes;
  state.tool = tool;
  state.manifest = manifest;
  state.moduleSha256 = sha256;

  const converts = Boolean(tool);
  $("input").hidden = !converts;
  $("run").hidden = !converts;
  $("no-converter").hidden = converts;
  $("about").hidden = !converts;
  if (converts && manifest.docs) {
    $("repo-link").href = manifest.docs;
  } else if (converts && manifest.source?.repo) {
    $("repo-link").href = `https://github.com/${manifest.source.repo}`;
  }
  renderLocalised();
  updateGo();
}

// --- the version picker ----------------------------------------------------

function renderPicker() {
  const wrap = $("version-wrap");
  const select = $("version");
  const note = $("version-note");
  if (!state.index) {
    // Pinned or offline: there is nothing to choose between. Say which version
    // this is anyway, because "which one am I running" is a fair question.
    wrap.hidden = true;
    note.hidden = !state.manifest?.source?.ref;
    note.textContent = state.manifest?.source?.ref
      ? t().version.pinned(state.manifest.source.ref)
      : "";
    return;
  }

  wrap.hidden = false;
  select.replaceChildren();
  for (const v of offered()) {
    const opt = document.createElement("option");
    opt.value = v.tag;
    // The firmware requirement travels with the version because this is the
    // only place a user learns it: a binary built for a newer ABI hardfaults on
    // device with nothing on screen to explain why.
    const abi = v.requiresAbi
      ? t().version.abi(v.requiresAbi.version, v.requiresAbi.minSize)
      : "";
    opt.textContent = [v.tag, v.prerelease ? t().version.prerelease : "", abi]
      .filter(Boolean).join(" · ");
    select.append(opt);
  }
  if (state.version) select.value = state.version.tag;

  const anyPre = (state.index.versions ?? []).some((v) => v.prerelease);
  $("prerelease-wrap").hidden = !anyPre;
  $("prerelease").checked = state.showPrereleases;

  note.replaceChildren();
  note.hidden = !state.index.retained;
  if (state.index.retained) {
    note.append(document.createTextNode(`${t().version.retained(state.index.retained)} `));
    if (state.index.releasesUrl) {
      const a = document.createElement("a");
      a.href = state.index.releasesUrl;
      a.textContent = t().version.olderReleases;
      note.append(a);
    }
  }
}

async function switchVersion(tag) {
  const entry = (state.index?.versions ?? []).find((v) => v.tag === tag);
  if (!entry) return;
  const select = $("version");
  select.disabled = true;
  try {
    await loadVersion(
      new URL(entry.manifest, new URL(state.versionsUrl, location.href)), entry);
  } catch (e) {
    fatal(e);
  } finally {
    select.disabled = false;
    renderPicker();
  }
}

// --- localised rendering ---------------------------------------------------

function renderLocalised() {
  applyStatic();
  if (state.manifest) {
    $("title").textContent = t().app.heading(state.manifest.title ?? "");
    document.title = $("title").textContent;
  }
  renderPicker();

  const tool = state.tool;
  if (!tool) {
    $("no-converter").textContent = t().version.noConverter;
    return;
  }

  const input = theInput();
  const output = theOutput();
  $("lede-text").textContent =
    t().app.lede(state.manifest?.title ?? localeText(tool.title) ?? "", output?.extension ?? "");
  $("io-in").textContent = (input?.extensions ?? []).join(", ");
  $("io-out").textContent = output?.extension ?? output?.filename ?? "";
  // The manifest owns this copy: what the file is and where a user gets it is
  // the project's to say, not this page's.
  $("input-desc").textContent = localeText(input?.description) ?? "";
  $("pick").textContent = t().input.chooseFolder;
  $("pick-files").textContent = t().input.chooseFiles;

  renderFound();
  renderResults();
}

// --- 1. what the user pointed us at ----------------------------------------

function resetScan() {
  state.found = [];
  state.skipped = [];
  state.root = null;
  state.ignored = 0;
  state.scanProblem = null;
  state.produced = [];
  state.failure = null;
  $("found").hidden = true;
  $("scan-status").hidden = true;
  $("results").hidden = true;
  $("run-status").hidden = true;
  $("zip-wrap").hidden = true;
}

/** The name a picker gave a file within the tree the user chose. */
const relPath = (file) => file.webkitRelativePath || file.name;

/**
 * The folder the user actually picked, for use in messages. webkitdirectory
 * puts it at the head of every relative path; a plain file picker gives none,
 * and there is nothing honest to name in that case.
 */
function pickedRoot(files) {
  for (const f of files) {
    const rel = f.webkitRelativePath;
    if (rel && rel.includes("/")) return rel.slice(0, rel.indexOf("/"));
  }
  return null;
}

/** Case-insensitively, because a CD writes DOOM.WAD and an installer doom.wad. */
function hasExtension(name, extensions) {
  if (!extensions?.length) return true;
  const lower = name.toLowerCase();
  return extensions.some((e) => lower.endsWith(e.toLowerCase()));
}

/**
 * Drops WADs that would produce the same file as one already kept.
 *
 * The user picks one folder and everything underneath it is in scope, so an
 * install sitting next to a backup of itself is an ordinary thing to hand over
 * and it means the same WAD arrives twice at two paths. Both would be named
 * from the same stem, so both would be written as DOOM2.whd and the second
 * would overwrite the first.
 *
 * The first one wins. It is not a better copy -- nothing here can tell which
 * is -- but converting both and then refusing the pair would spend two runs to
 * reach the same question, and silently picking one would leave the user with
 * a card whose contents they cannot account for. So: keep the first, say which
 * path it was and which path was passed over, and let them narrow the
 * selection if the answer was wrong.
 *
 * Stems are compared case-folded, because the destination folds case: DOOM2
 * and doom2 are one file on the card.
 */
function dedupeByStem(entries, note) {
  const kept = [];
  const byStem = new Map();
  for (const e of entries) {
    const key = stemOf(e.name).toLowerCase();
    const first = byStem.get(key);
    if (first) {
      note({ path: e.path, why: t().input.duplicateStem(stemOf(e.name), first.path) });
      continue;
    }
    byStem.set(key, e);
    kept.push(e);
  }
  return kept;
}

/**
 * Reads whatever the user handed over and works out what is convertible.
 *
 * Nothing is converted here. The whole point of this step is that the user sees
 * the list -- four IWADs, or the one that survived pointing at the wrong
 * folder -- before spending a run on any of it.
 */
async function scan(fileList) {
  resetScan();
  const status = $("scan-status");
  const input = theInput();
  const output = theOutput();
  if (!input || !output) return;

  const files = [...fileList];
  if (files.length === 0) return;
  const root = pickedRoot(files);
  state.root = root;
  setStatus(status, "busy", t().input.scanning(files.length));

  // The whole subtree, at any depth, ignoring how it is arranged. A DOS install
  // keeps its IWAD at the top, a re-release keeps it in base/, and a folder
  // holding several installs is still one selection -- so the shape of the tree
  // decides nothing here and only the extension does. The user points at Doom
  // and the page finds the WADs.
  let found = [];
  const skipped = [];
  let ignored = 0;
  for (const file of files) {
    const path = relPath(file);
    if (!hasExtension(file.name, input.extensions)) {
      // An install carries executables, DLLs, savegames, config files and a
      // manual. None of it is a problem and none of it is worth a line each,
      // but the count is worth saying so nobody has to wonder what happened to
      // the rest of the folder.
      ignored++;
      continue;
    }
    if (input.maxBytes && file.size > input.maxBytes) {
      skipped.push({ path, why: t().input.tooLarge(file.size, input.maxBytes) });
      continue;
    }
    // Nothing downstream can name this file, so say so now rather than after
    // twenty conversions. The check is on the name we would write, not on the
    // one we were given.
    const bad = fileNameProblem(file.name);
    if (bad) {
      skipped.push({ path, why: t().input.unusableName(bad) });
      continue;
    }
    found.push({ file, path, name: file.name, size: file.size });
  }
  state.ignored = ignored;

  if (found.length === 0) {
    // By far the likeliest thing to go wrong, so it gets a plain sentence
    // naming what was looked for and where, rather than an empty list that
    // reads like the page broke.
    state.skipped = skipped;
    state.scanProblem = t().input.noneFound(
      (input.extensions ?? []).join(", "), root ?? t().input.theSelection, files.length);
    setStatus(status, "warn", state.scanProblem);
    renderFound();
    updateGo();
    return;
  }

  // Before reading anything: two copies of one WAD cost two conversions and
  // collide at the end, and the answer is the same either way.
  found = dedupeByStem(found, (s) => skipped.push(s));

  // Only now is anything read: hashing a folder of files the user did not mean
  // to give us would be a lot of work for nothing, and an IWAD is megabytes.
  for (const entry of found) {
    setStatus(status, "busy", t().input.reading(entry.name));
    entry.bytes = new Uint8Array(await entry.file.arrayBuffer());
    entry.sha1 = (await digest("SHA-1", entry.bytes)).toUpperCase();
    entry.variant = (input.variants ?? []).find((v) => v.sha1 === entry.sha1) ?? null;
    entry.file = null;                       // the bytes are held; the handle is not
  }

  // Strict is the host's call and this page's job, not the module's: we have
  // the file, the hash table and the user in front of us. This project's input
  // is not strict, so an unrecognised WAD is kept and flagged rather than
  // refused -- but the code has to honour a manifest that says otherwise.
  let kept = found;
  if (isStrict(input)) {
    kept = found.filter((e) => e.variant);
    for (const e of found) {
      if (!e.variant) skipped.push({ path: e.path, why: t().input.notRecognised(e.sha1) });
    }
  }

  if (input.maxCount && kept.length > input.maxCount) {
    // Checked before running rather than discovered afterwards: an unbounded
    // run count is the one genuinely open-ended thing in this model.
    state.skipped = skipped;
    state.scanProblem = t().input.tooMany(kept.length, input.maxCount);
    setStatus(status, "bad", state.scanProblem);
    renderFound();
    updateGo();
    return;
  }

  // The name each file would take on the card, and whether any two of them
  // would be the same file there. Doing it now means a folder holding both
  // DOOM2.WAD and base/doom2.wad is a question the user answers before the
  // conversion rather than after it.
  try {
    for (const e of kept) e.outName = outputFileName(output, e);
    planInstall({
      root: INSTALL_ROOT[targetForTool()?.kind],
      target: targetForTool(),
      tool: state.tool,
      artifacts: targetForTool()?.artifacts ?? [],
      produced: kept.map((e) => ({ outputId: output.id, source: e })),
    });
  } catch (e) {
    state.skipped = skipped;
    state.scanProblem = e?.message ?? String(e);
    setStatus(status, "bad", state.scanProblem);
    renderFound();
    updateGo();
    return;
  }

  state.found = kept;
  state.skipped = skipped;
  setStatus(status, "ok", t().input.foundCount(kept.length, state.ignored, root));
  renderFound();
  updateGo();
}

function renderFound() {
  const box = $("found");
  const list = $("found-list");
  const skippedBox = $("skipped");
  list.replaceChildren();

  state.found.forEach((e, i) => {
    const li = document.createElement("li");
    li.id = `row-${i}`;

    const name = document.createElement("span");
    name.className = "f-name";
    name.textContent = e.name;
    name.title = e.path;                     // the tree it came from, on hover

    const size = document.createElement("span");
    size.className = "f-size";
    size.textContent = t().input.bytes(e.size);

    // What we know before converting: a hash match against the manifest's list
    // of releases. Anything else is not a verdict yet -- the module gets the
    // last word on that, and says so in a warning after the run.
    //
    // An input that declares no variants at all gives us nothing to check
    // against, and "not a known release" would then be a verdict on the
    // manifest rather than on the file. So the column is simply absent: an
    // empty table of releases is not the same as a file that failed to match
    // one.
    const mark = document.createElement("span");
    mark.className = `f-mark ${e.variant ? "ok" : "warn"}`;
    mark.textContent = !knowsReleases() ? ""
      : e.variant ? (localeText(e.variant.label) || t().input.recognised)
      : t().input.unknownYet;

    const to = document.createElement("span");
    to.className = "f-to";
    to.textContent = `→ ${e.outName}`;

    const prog = document.createElement("span");
    prog.className = "f-progress";

    li.append(name, size, mark, to, prog);
    list.append(li);
  });

  box.hidden = state.found.length === 0;
  $("found-toggle").textContent = t().input.detail(state.found.length);

  skippedBox.replaceChildren();
  skippedBox.hidden = state.skipped.length === 0;
  for (const s of state.skipped) {
    const li = document.createElement("li");
    li.textContent = `${s.path}: ${s.why}`;
    skippedBox.append(li);
  }
}

function updateGo() {
  $("go").disabled = state.running || !state.tool || state.found.length === 0;
  $("pick").disabled = state.running;
  $("pick-files").disabled = state.running;
}

// --- 2. run ----------------------------------------------------------------

/**
 * One WAD, in its own worker.
 *
 * Resolves with the module's outputs and warnings, or rejects. The timeout is
 * per WAD and terminating the worker is what it does, because the ABI has no
 * cancellation flag and cannot have one.
 */
function convertOne(entry, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("worker.js", { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(t().run.timedOut(entry.name)));
    }, RUN_TIMEOUT_MS);

    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(e?.message ?? "worker failed"));
    };
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") { onProgress(m); return; }
      clearTimeout(timer);
      worker.terminate();
      if (m.type === "error") reject(new Error(m.message));
      else resolve(m);
    };

    worker.postMessage({
      wasmBytes: state.wasmBytes,
      input: entry.bytes,
      // No flags. Admission was settled before the run, by `strict` above, and
      // an option a project declares would be read from the manifest.
      flags: 0,
      expectedOutputs: (state.tool.outputs ?? []).map((o) => o.id),
      maxOutputBytes: state.tool.limits?.maxOutputBytes,
    });
  });
}

async function run() {
  const status = $("run-status");
  state.running = true;
  state.produced = [];
  state.failure = null;
  $("results").hidden = true;
  $("zip-wrap").hidden = true;
  updateGo();

  let failed = null;

  for (let i = 0; i < state.found.length && !failed; i++) {
    const entry = state.found[i];
    const cell = document.querySelector(`#row-${i} .f-progress`);
    setStatus(status, "busy", t().run.converting(i + 1, state.found.length, entry.name));

    try {
      const result = await convertOne(entry, ({ stage, stages, name }) => {
        if (cell) cell.textContent = stage < stages ? `${name} ${stage + 1}/${stages}` : "";
      });
      for (const out of result.outputs) {
        const data = new Uint8Array(out.data);
        // The manifest states a ceiling per produced file as well as one for
        // the run; the worker enforced the run's, this is the per-output one.
        const declared = (state.tool.outputs ?? []).find((o) => o.id === out.id);
        if (declared?.maxBytes && data.length > declared.maxBytes) {
          throw new Error(t().run.tooBig(entry.name, data.length, declared.maxBytes));
        }
        state.produced.push({
          source: entry,
          outputId: out.id,
          data,
          sha256: await digest("SHA-256", data),
          warnings: result.warnings,
          ms: result.ms,
        });
      }
      if (cell) cell.textContent = "✓";
    } catch (e) {
      if (cell) cell.textContent = "✗";
      failed = { entry, message: e?.message ?? String(e) };
      state.failure = failed;
    }
  }

  state.running = false;
  updateGo();

  if (failed) {
    setStatus(status, "bad", t().run.failed(failed.entry.name, failed.message));
    // Everything that converted before the failure is still real and still
    // worth having, so the results stay on screen rather than being thrown
    // away along with the run.
  } else {
    setStatus(status, "ok", t().run.done(state.produced.length));
  }
  if (state.produced.length) renderResults();
}

// --- 3. results ------------------------------------------------------------

function renderResults() {
  if (!state.produced.length) return;
  const rows = $("file-rows");
  rows.replaceChildren();

  const cell = (tr, text, cls) => {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    if (text != null) td.textContent = text;      // never innerHTML: module data
    tr.append(td);
    return td;
  };

  for (const p of state.produced) {
    const tr = document.createElement("tr");
    const name = outputFileName(theOutput(), p.source);

    cell(tr, p.source.name).title = p.source.path ?? p.source.name;
    cell(tr, name, "out");

    // Three outcomes, and the module has the last word on two of them. A WAD
    // that hashes to a release the manifest lists and that the module placed
    // against its own table is a known one; a WAD the module warned about
    // converted perfectly well and is simply not a release we know, which is
    // what a PWAD or a fan megawad looks like. Neither is a failure.
    //
    // With no variants declared there is no table to place a WAD against, so
    // the column says the only thing that is true: it converted. The three-way
    // verdict comes back on its own the moment a manifest ships variants, which
    // is the same rule the found list follows.
    const placed = p.warnings.length === 0 && Boolean(p.source.variant);
    const status = cell(tr, "", `st ${!knowsReleases() || placed ? "ok" : "warn"}`);
    status.textContent = !knowsReleases() ? t().results.converted
      : placed ? (localeText(p.source.variant.label) || t().results.known)
      : t().results.unknown;
    // The module's own words about what it could not place, under the verdict
    // rather than instead of it. textContent: this string came from the module.
    for (const w of p.warnings) {
      const note = document.createElement("span");
      note.className = "st-note";
      note.textContent = w;
      status.append(note);
    }

    cell(tr, t().results.bytes(p.data.length), "num");

    const hash = cell(tr, p.sha256.slice(0, 16), "mono hash");
    hash.title = p.sha256;

    // Still here, still one click, just not the thing the page is shouting
    // about: someone re-converting one WAD should not have to take the whole
    // archive again.
    const td = document.createElement("td");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([p.data], { type: "application/octet-stream" }));
    a.download = name;
    a.textContent = t().results.save;
    td.append(a);
    tr.append(td);

    rows.append(tr);
  }

  // The one row that is a failure. It is not in `produced` because nothing was
  // produced, and leaving it out would make the table disagree with the run.
  if (state.failure) {
    const tr = document.createElement("tr");
    cell(tr, state.failure.entry.name).title = state.failure.entry.path;
    cell(tr, state.failure.entry.outName ?? "", "out");
    const status = cell(tr, t().results.failed, "st bad");
    const note = document.createElement("span");
    note.className = "st-note";
    note.textContent = state.failure.message;
    status.append(note);
    cell(tr, "", "num");
    cell(tr, "", "mono hash");
    cell(tr, "");
    rows.append(tr);
  }

  $("file-summary").textContent = t().results.summary(rows.childElementCount);
  $("results").hidden = false;
  renderZipOffer();
}

/**
 * Everything the install needs, as one file, laid out the way it goes on the
 * card: the core the project published in the core directory, and the games
 * this run produced under the folder the launcher browses for games.
 *
 * The layout is not a guess, and it is not one directory either. `kind` says
 * where the published binary goes, and a core's converted output is a game
 * rather than data belonging to a program, so it goes to `roms/<system id>/`
 * instead -- the same folder as a .whd somebody was handed ready-made.
 * install.mjs turns the manifest's `kind` and `systems[]` into those paths with
 * every segment checked.
 */
async function buildInstallZip() {
  const target = targetForTool();
  if (!target) throw new Error("manifest declares no target");
  const root = INSTALL_ROOT[target.kind];
  if (!root) throw new Error(`this page cannot place a target of kind "${target.kind}"`);

  const artifacts = [];
  for (const artifact of target.artifacts ?? []) {
    const url = new URL(artifact.url, new URL(state.manifestUrl, location.href));
    const res = await fetch(url, FRESH);
    if (!res.ok) throw new Error(t().zip.fetchFailed(artifact.filename, res.status));
    const data = new Uint8Array(await res.arrayBuffer());

    // A mirror is not a trust boundary. The manifest says how big each file is
    // and what it hashes to, and a file that disagrees does not go in the zip:
    // shipping it would hand someone a broken install with our name on it.
    if (artifact.bytes && data.length !== artifact.bytes) {
      throw new Error(t().zip.sizeMismatch(artifact.filename, data.length, artifact.bytes));
    }
    if (artifact.sha256 && (await digest("SHA-256", data)) !== artifact.sha256) {
      throw new Error(t().zip.hashMismatch(artifact.filename));
    }
    artifacts.push({ filename: artifact.filename, data });
  }

  // Only the outputs this target actually installs. A tool may produce more
  // than a given target uses.
  const wanted = new Set();
  for (const use of target.uses ?? []) {
    if (use.tool !== state.tool.id) continue;
    for (const id of use.outputs ?? []) wanted.add(id);
  }
  const produced = state.produced
    .filter((p) => wanted.size === 0 || wanted.has(p.outputId))
    .map((p) => ({ outputId: p.outputId, source: p.source, data: p.data }));

  const entries = planInstall({ root, target, tool: state.tool, artifacts, produced });
  return makeZip(entries.map((e) => ({ name: e.path, data: e.data })));
}

/** `<project>-<tag>-gwrg.zip`, or a sensible name when the tag is unknown. */
function zipName() {
  const project = state.manifest?.project ?? "install";
  const tag = state.version?.tag ?? state.manifest?.source?.ref ?? "";
  return [project, tag, "gwrg"].filter(Boolean).join("-") + ".zip";
}

function renderZipOffer() {
  const wrap = $("zip-wrap");
  const button = $("zip");
  const status = $("zip-status");
  const target = targetForTool();

  wrap.hidden = false;
  status.hidden = true;
  button.disabled = false;
  // What the archive holds, on the control that fetches it: how many files and
  // how much of the connection they will cost. The artifact sizes come from the
  // manifest, which states them, and the games are already in hand, so this is
  // the real total rather than an estimate. The zip itself can only be smaller,
  // since entries are stored or deflated, whichever is less.
  const bytes = state.produced.reduce((n, p) => n + p.data.length, 0)
    + (target?.artifacts ?? []).reduce((n, a) => n + (a.bytes ?? 0), 0);
  const count = state.produced.length + (target?.artifacts ?? []).length;
  button.textContent = t().zip.button(count, t().results.mb(bytes / 1e6));
  // Say where the files land, because that is the question the zip answers, and
  // for a core the answer is two places: the core in one folder, the games in
  // another. Asked of the planner rather than spelled out again here.
  const root = INSTALL_ROOT[target?.kind] ?? "";
  let dir = `${root}/`;
  try {
    dir = outputDir(target, theOutput(), state.tool).join("/") + "/";
  } catch { /* a manifest the planner refuses; the zip button will say so */ }
  $("zip-note").textContent = t().zip.note(
    (target?.artifacts ?? []).map((a) => `${root}/${a.filename}`).join(", "),
    dir, state.produced.length);

  button.onclick = async () => {
    button.disabled = true;
    setStatus(status, "busy", t().zip.building);
    try {
      const blob = await buildInstallZip();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = zipName();
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(status, "ok", t().zip.ready(a.download, blob.size));
    } catch (e) {
      setStatus(status, "bad", t().zip.failed(e?.message ?? e));
    } finally {
      button.disabled = false;
    }
  };
}

// --- wiring ----------------------------------------------------------------

const langSelect = $("lang");
for (const l of SUPPORTED) {
  const opt = document.createElement("option");
  opt.value = l.code;
  opt.textContent = l.label;          // languages are named in their own language
  langSelect.append(opt);
}
langSelect.value = locale();
langSelect.addEventListener("change", (e) => setLocale(e.target.value));

// A directory is the normal way in: the user knows where Doom is installed and
// does not necessarily know which folder inside it holds the IWAD. The file
// picker beside it is the fallback for a browser without webkitdirectory and
// for someone who has the WADs loose somewhere.
for (const [button, picker] of [["pick", "dir-input"], ["pick-files", "file-input"]]) {
  $(button).addEventListener("click", () => $(picker).click());
  $(picker).addEventListener("change", (e) => {
    const picked = e.target.files;
    e.target.value = "";              // so choosing the same folder twice still fires
    scan(picked);
  });
}

const drop = $("input");
for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
}
drop.addEventListener("dragleave", (e) => {
  if (!drop.contains(e.relatedTarget)) drop.classList.remove("over");
});
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  scan(e.dataTransfer.files);
});

$("go").addEventListener("click", run);
$("version").addEventListener("change", (e) => switchVersion(e.target.value));
$("prerelease").addEventListener("change", (e) => {
  state.showPrereleases = e.target.checked;
  renderPicker();
});

// The "?" is a disclosure, not a tooltip: it has to work on a touch screen.
const why = $("why");
why.addEventListener("click", () => {
  const box = $("why-text");
  box.hidden = !box.hidden;
  why.setAttribute("aria-expanded", String(!box.hidden));
});

onLocaleChange(renderLocalised);
document.documentElement.lang = locale();
boot();
