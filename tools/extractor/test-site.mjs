// Checks an assembled site the way the page loads it, without a browser.
//
// CI can run this on every build with nothing but node, so a missing file, a
// manifest the page cannot read, or a module that does not match what the
// manifest says about it cannot reach a deploy.
//
// It walks the exact sequence app.js walks: read config.json, fetch the
// manifest it names, resolve the module beside that manifest, check size and
// hash, then verify the binary. Then it checks the parts that are particular
// to this project -- a converter that runs per file, derives every name, and
// installs its output as a game under roms/<system id>/ rather than beside the
// core -- because those are the fields the page's whole flow hangs off and a
// manifest missing one of them would render a page that quietly does nothing.
//
//   node test-site.mjs <site-dir>

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { verify } from "./verify.mjs";
import {
  INSTALL_ROOT, outputFileName, planInstall, fileNameProblem, systemIdFor,
} from "./install.mjs";

const site = process.argv[2];
if (!site) {
  console.error("usage: test-site.mjs <site-dir>");
  process.exit(2);
}

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`); failures++; }
};

// --- the files the page itself is made of -----------------------------------

for (const f of ["index.html", "app.js", "worker.js", "i18n.js", "style.css",
                 "verify.mjs", "extract.mjs", "install.mjs", "zip.mjs", "config.json"]) {
  check(`site has ${f}`, existsSync(join(site, f)));
}

// Jekyll would swallow anything it does not recognise, including dist/.
check("site has .nojekyll", existsSync(join(site, ".nojekyll")));

// The failure this catches is invisible: a node-only construct in a file the
// browser imports throws at import time and takes the page down with no error
// shown anywhere. build-page.sh already refuses to assemble one, and this is
// the same check on the assembled result, because the two can be run apart.
for (const f of ["verify.mjs", "extract.mjs", "install.mjs", "zip.mjs",
                 "app.js", "worker.js", "i18n.js"]) {
  const p = join(site, f);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, "utf8");
  check(`${f} has no shebang`, !text.startsWith("#!"));
  const usesProcess = /\bprocess\./.test(text.replace(/typeof process/g, ""));
  check(`${f} guards any use of process`,
    !usesProcess || text.includes('typeof process !== "undefined"'));
}

// --- config.json points somewhere real --------------------------------------

const cfgPath = join(site, "config.json");
if (!existsSync(cfgPath)) {
  console.log("\ncannot continue without config.json");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const entry = cfg.versionsUrl ?? cfg.manifestUrl;
check("config.json names a starting point", typeof entry === "string" && Boolean(entry),
  JSON.stringify(cfg));

// The page resolves it relative to itself, so it must stay inside the site. An
// absolute URL would make the page depend on another origin, which is the thing
// the mirror exists to avoid.
check("the configured url is relative", !/^[a-z]+:\/\//i.test(entry ?? ""), entry);

let manifestPath;
if (cfg.versionsUrl) {
  const indexPath = resolve(site, cfg.versionsUrl);
  check("the version index exists", existsSync(indexPath), cfg.versionsUrl);
  if (!existsSync(indexPath)) {
    console.log("\nthe page would fail to load: no versions.json at its configured URL");
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  check("index schemaVersion is 1", index.schemaVersion === 1, String(index.schemaVersion));
  const versions = index.versions ?? [];
  check("index lists at least one version", versions.length > 0, String(versions.length));

  // The page takes versions[0] as the default without sorting, because the spec
  // guarantees newest-first. If that is ever untrue the page silently offers
  // the wrong default, so it is checked here rather than trusted.
  const dates = versions.map((v) => Date.parse(v.publishedAt)).filter((n) => !Number.isNaN(n));
  check("index is newest-first", dates.every((d, i) => i === 0 || dates[i - 1] >= d),
    versions.map((v) => v.tag).join(", "));

  // Every version the picker offers has to be loadable, not just the default:
  // switching to an older one must not land on a 404.
  for (const v of versions) {
    check(`${v.tag}: its manifest is mirrored`,
      existsSync(resolve(dirname(indexPath), v.manifest)), v.manifest);
  }

  const def = versions.find((v) => !v.prerelease) ?? versions[0];
  check("a default version exists", Boolean(def), def?.tag);
  manifestPath = resolve(dirname(indexPath), def.manifest);
} else {
  manifestPath = resolve(site, cfg.manifestUrl);
  check("the manifest it names exists", existsSync(manifestPath), cfg.manifestUrl);
}
if (!existsSync(manifestPath)) {
  console.log("\nthe page would fail to load: no manifest at its configured URL");
  process.exit(1);
}

// --- the manifest is the shape the page reads -------------------------------

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
check("schemaVersion is 1", manifest.schemaVersion === 1, String(manifest.schemaVersion));

// The page picks the tool that runs per file, falling back to the first. A
// manifest declaring none is the "nothing to convert" state, which is a
// different page and not something this test can go on to check.
const tool = (manifest.tools ?? []).find((x) => (x.inputs ?? []).some((i) => i.runPerFile))
  ?? manifest.tools?.[0];
check("manifest declares a tool", Boolean(tool));
if (!tool) {
  console.log("\nnothing further to check without a tool");
  process.exit(1);
}

check("processor is wasm/1",
  tool.processor?.type === "wasm" && tool.processor?.version === 1,
  `${tool.processor?.type}/${tool.processor?.version}`);
check("tool has a binary block", Boolean(tool.binary?.url && tool.binary?.sha256));
check("tool declares limits", Number.isInteger(tool.limits?.maxOutputBytes));
check("tool declares inputs", Array.isArray(tool.inputs) && tool.inputs.length > 0);
check("tool declares outputs", Array.isArray(tool.outputs) && tool.outputs.length > 0);

const input = tool.inputs[0];
const output = tool.outputs[0];

// The shape this page implements, stated by the manifest rather than assumed.
// A tool that runs once cannot drive this page and a page that assumed it ran
// per file would convert only the first WAD of a folder.
check("the input runs per file", input?.runPerFile === true, String(input?.runPerFile));
check("runPerFile comes with allowMultiple", input?.allowMultiple === true,
  String(input?.allowMultiple));
check("the input caps how many files it takes",
  input?.maxCount === undefined || Number.isInteger(input.maxCount), String(input?.maxCount));
check("the input names the extensions to look for",
  Array.isArray(input?.extensions) && input.extensions.length > 0);
check("the input caps a file's size", Number.isInteger(input?.maxBytes), String(input?.maxBytes));

// Exactly one of filename and extension, and for a runPerFile tool it has to be
// the extension: a fixed filename would be written once per WAD under the same
// name, so the manifest would be a collision with itself.
check("the output declares exactly one of filename and extension",
  Boolean(output?.filename) !== Boolean(output?.extension),
  `filename=${output?.filename} extension=${output?.extension}`);
check("a runPerFile tool derives its output name", Boolean(output?.extension),
  output?.extension ?? "(fixed filename)");
check("the extension starts with a dot", (output?.extension ?? ".").startsWith("."),
  output?.extension);
check("the output caps each produced file", Number.isInteger(output?.maxBytes),
  String(output?.maxBytes));

// A strict input with nothing to match is a slot no file can ever fill: the
// host refuses anything unrecognised, and every file is unrecognised.
const strict = input.strict !== false;
check("a strict input has variants to match", !strict || (input.variants ?? []).length > 0,
  strict ? `strict with ${(input.variants ?? []).length} variant(s)` : "not strict");

// A variant id has to be unique within its input: it is what tells one accepted
// file from another. JSON Schema cannot say this.
const ids = (input.variants ?? []).map((v) => v.id);
check("variant ids are unique", new Set(ids).size === ids.length,
  ids.filter((id, i) => ids.indexOf(id) !== i).join(", "));
// A variant may name the file it produces. If it does, that name wins over the
// derived one, so it has to be a name the card can hold.
for (const v of input.variants ?? []) {
  if (!v.filename) continue;
  check(`variant ${v.id}: its filename is usable`, !fileNameProblem(v.filename),
    fileNameProblem(v.filename) ?? "");
}

for (const opt of tool.options ?? []) {
  check(`option ${opt.id} declares a bit`, Number.isInteger(opt.bit), String(opt.bit));
}

// --- the module resolves beside the manifest, and is the one described ------

const url = tool.binary.url ?? tool.binary.file;
check("binary url is a plain filename", !url.includes("/") && !url.includes(".."), url);

const wasmPath = join(dirname(manifestPath), url);
check("the module is there", existsSync(wasmPath), wasmPath);
if (!existsSync(wasmPath)) {
  console.log("\nthe page would load its manifest and then fail to fetch the module");
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(wasmPath));
check("module size matches the manifest", bytes.length === tool.binary.bytes,
  `${bytes.length} vs ${tool.binary.bytes}`);
check("module hash matches the manifest",
  createHash("sha256").update(bytes).digest("hex") === tool.binary.sha256);

// The real gate, and the same call the page makes: decided by reading the
// binary, never by trusting what the manifest says about it.
const result = verify(bytes);
check("module passes the verifier", result.ok, (result.errors ?? []).join("; "));

// The declared ceiling has to cover what the binary actually asks for.
const declared = result.info?.memories?.[0]?.max;
if (Number.isInteger(declared)) {
  check("manifest memory ceiling matches the binary",
    tool.limits.maxMemoryPages === declared,
    `manifest ${tool.limits.maxMemoryPages} vs binary ${declared}`);
}

// --- the target this converter feeds ----------------------------------------

const target = (manifest.targets ?? []).find(
  (tg) => (tg.uses ?? []).some((u) => u.tool === tool.id)) ?? manifest.targets?.[0];
check("a target uses this tool", Boolean(target), tool.id);

if (target) {
  check("the target says what kind it is",
    target.kind === "homebrew" || target.kind === "core", String(target.kind));
  // This project is a core, and that is what decides where a converted WAD
  // goes. A core states its systems; without them there is no rom folder to
  // put a game in, and dataDir is a homebrew field that would quietly file the
  // games somewhere the launcher never looks.
  check("a core declares its systems",
    target.kind !== "core" || ((target.systems ?? []).length > 0),
    JSON.stringify(target.systems));
  check("a core declares no dataDir",
    target.kind !== "core" || target.dataDir === undefined, String(target.dataDir));
  for (const sys of target.systems ?? []) {
    check(`system ${sys.id}: its id is a usable folder name`, !fileNameProblem(sys.id),
      fileNameProblem(sys.id) ?? sys.id);
  }
  if (target.dataDir) {
    check("dataDir is a usable single segment", !fileNameProblem(target.dataDir),
      fileNameProblem(target.dataDir) ?? target.dataDir);
  }
  // Which system this tool's output belongs to has to be answerable, whether
  // from uses[] or because there is only one system to mean.
  try {
    const id = systemIdFor(target, tool, output.id);
    check("the manifest says which system this converter feeds", Boolean(id), id);
  } catch (e) {
    check("the manifest says which system this converter feeds", false, e.message);
  }
  check("uses[] names an output the tool declares",
    (target.uses ?? []).every((u) => u.tool !== tool.id
      || (u.outputs ?? []).every((id) => tool.outputs.some((o) => o.id === id))),
    JSON.stringify(target.uses));

  for (const a of target.artifacts ?? []) {
    const p = join(dirname(manifestPath), a.url);
    const there = existsSync(p);
    check(`artifact ${a.filename} is mirrored`, there);
    if (there) {
      check(`artifact ${a.filename} matches its hash`,
        createHash("sha256").update(readFileSync(p)).digest("hex") === a.sha256);
    }
  }

  // Finally, the layout itself. Everything above says the manifest has the
  // right fields; this says the fields produce an install a card can hold. Run
  // through the same planner the page uses, on the names the manifest's own
  // variants say this converter will meet.
  try {
    // Named after the variant, not after the file it came from, so two accepted
    // releases that declare the same filename show up here as the collision
    // they would be on the card.
    const sample = (input.variants ?? []).length
      ? input.variants.map((v, i) => ({ name: `IWAD${i}${input.extensions[0]}`, variant: v }))
      : [{ name: `DOOM2${input.extensions[0]}`, variant: null }];
    const entries = planInstall({
      root: INSTALL_ROOT[target.kind],
      target,
      tool,
      artifacts: target.artifacts ?? [],
      produced: sample.map((s) => ({ outputId: output.id, source: s })),
    });
    const dirs = new Set(entries.map((e) => e.dir));
    check("the install set has no colliding names", true);
    console.log(`  note it lays out as: ${[...dirs].sort().join(", ")}`);
    // The placement rule itself, read off the plan rather than off the code
    // that made it: the published binary in the core directory, every converted
    // game under roms/<system id>/, and nothing anywhere else.
    if (target.kind === "core") {
      const system = systemIdFor(target, tool, output.id);
      check("the core binary installs to cores/",
        entries.filter((e) => e.kind === "artifact").every((e) => e.dir === "cores"),
        [...dirs].join(", "));
      check("every converted game installs to its system's rom folder",
        entries.filter((e) => e.kind === "output").every((e) => e.dir === `roms/${system}`),
        [...dirs].join(", "));
      check("nothing installs under homebrews",
        !entries.some((e) => e.path.startsWith("homebrews/")), [...dirs].join(", "));
    }
    const first = entries.find((e) => e.kind === "output");
    if (first) {
      console.log(`  note ${first.source.name} would install as ${first.path}`);
    }
    // The extension replaces, never appends. Checked on a name with no variant
    // behind it, because a variant's declared filename is the manifest's own
    // string and this rule is about the user's.
    const plain = outputFileName(output, { name: `DOOM2${input.extensions[0]}`, variant: null });
    check("a derived name replaces the input's extension",
      plain === `DOOM2${output.extension}`, plain);
  } catch (e) {
    check("the install set has no colliding names", false, e.message);
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
