// Converts a real Doom install through the page's own code, headlessly.
//
// A LOCAL CHECK, not a CI one. It needs commercial WAD data, which this project
// cannot ship and CI cannot obtain, so nothing in .github runs it. Run it by
// hand before cutting a release, the same way check.sh's parity check is run:
//
//   ./build-page.sh && node test-convert.mjs site /path/to/doom
//
// test-site.mjs proves the assembled site is coherent; this proves it works. It
// imports extract.mjs, install.mjs and zip.mjs OUT OF THE ASSEMBLED SITE rather
// than out of the source tree, so what it exercises is the files a browser
// would actually fetch, and it repeats the page's sequence exactly: walk the
// tree the user pointed at, filter by extension, dedupe by stem, hash and match
// against the manifest's variants, run the module once per WAD, name each
// output from the manifest and the input's own stem, plan the install, build
// the zip.
//
// The one thing it cannot cover is the DOM, which is what a browser test is
// for. Everything between "the user chose a folder" and "the zip is built" is
// here.
//
//   node test-convert.mjs <site-dir> <doom directory> [--only DOOM2]
//
// The directory may be an install folder, a base/ folder, a folder of loose
// WADs, or something holding several of those: the page does not care where the
// WADs sit and neither does this.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const [siteArg, dataArg, ...rest] = process.argv.slice(2);
if (!siteArg || !dataArg) {
  console.error("usage: test-convert.mjs <site-dir> <doom directory> [--only NAME] [--zip out.zip]");
  process.exit(2);
}
const only = rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null;
const zipOut = rest.includes("--zip") ? rest[rest.indexOf("--zip") + 1] : null;
const site = resolve(siteArg);

// The files the browser loads, not the ones beside this script. If build-page.sh
// ever forgets to copy one, this fails here rather than in someone's browser.
const from = (f) => import(pathToFileURL(join(site, f)).href);
const { extract } = await from("extract.mjs");
const { INSTALL_ROOT, outputFileName, planInstall, stemOf, fileNameProblem, systemIdFor } =
  await from("install.mjs");
const { makeZip } = await from("zip.mjs");
const { verify } = await from("verify.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`); failures++; }
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sha1 = (b) => createHash("sha1").update(b).digest("hex").toUpperCase();

// --- what the page would have loaded ----------------------------------------

const cfg = JSON.parse(readFileSync(join(site, "config.json"), "utf8"));
const manifestPath = cfg.manifestUrl
  ? resolve(site, cfg.manifestUrl)
  : (() => {
    const indexPath = resolve(site, cfg.versionsUrl);
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const def = index.versions.find((v) => !v.prerelease) ?? index.versions[0];
    return resolve(dirname(indexPath), def.manifest);
  })();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tool = (manifest.tools ?? []).find((x) => (x.inputs ?? []).some((i) => i.runPerFile))
  ?? manifest.tools[0];
const target = (manifest.targets ?? []).find(
  (tg) => (tg.uses ?? []).some((u) => u.tool === tool.id)) ?? manifest.targets[0];
const input = tool.inputs[0];
const output = tool.outputs[0];

const wasm = new Uint8Array(readFileSync(join(dirname(manifestPath), tool.binary.url)));
check("the module matches the manifest", sha256(wasm) === tool.binary.sha256);
check("the module passes the verifier", verify(wasm).ok, verify(wasm).errors?.join("; "));

// --- the scan, exactly as the page does it ----------------------------------

/** Every file under `dir`, at any depth, with the path the picker would give. */
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    // webkitdirectory prefixes every path with the chosen folder's own name.
    else out.push({ path: [base.split(sep).pop(), relative(base, full)].join("/").replaceAll(sep, "/"),
      full, name, size: st.size });
  }
  return out;
}

const all = walk(resolve(dataArg));
const wanted = (name) =>
  (input.extensions ?? []).some((e) => name.toLowerCase().endsWith(e.toLowerCase()));

let found = [];
const skipped = [];
let ignored = 0;
for (const f of all) {
  if (!wanted(f.name)) { ignored++; continue; }
  if (input.maxBytes && f.size > input.maxBytes) {
    skipped.push(`${f.path}: larger than maxBytes`); continue;
  }
  const bad = fileNameProblem(f.name);
  if (bad) { skipped.push(`${f.path}: ${bad}`); continue; }
  found.push(f);
}
console.log(`\nscanned ${all.length} files under ${dataArg}`);
console.log(`  ${found.length} WAD(s), ${ignored} other file(s) ignored`);
check("the scan found WADs anywhere in the tree", found.length > 0,
  `${all.length} files seen`);

// Two copies of one WAD would be written under one name. First wins, and the
// second is reported rather than dropped in silence.
const byStem = new Map();
found = found.filter((f) => {
  const key = stemOf(f.name).toLowerCase();
  if (byStem.has(key)) {
    skipped.push(`${f.path}: another copy of ${stemOf(f.name)}, using ${byStem.get(key).path}`);
    return false;
  }
  byStem.set(key, f);
  return true;
});
for (const s of skipped) console.log(`  skipped ${s}`);

for (const f of found) {
  f.bytes = new Uint8Array(readFileSync(f.full));
  f.sha1 = sha1(f.bytes);
  f.variant = (input.variants ?? []).find((v) => v.sha1 === f.sha1) ?? null;
}
if (input.strict !== false) {
  const before = found.length;
  found = found.filter((f) => f.variant);
  if (found.length !== before) console.log(`  strict input dropped ${before - found.length}`);
}
check("maxCount is respected", !input.maxCount || found.length <= input.maxCount,
  `${found.length} vs ${input.maxCount}`);

const toRun = only ? found.filter((f) => stemOf(f.name) === only) : found;
check(only ? `${only} is in the scan` : "there is something to convert", toRun.length > 0);

// --- one run per WAD --------------------------------------------------------

const produced = [];
for (const f of toRun) {
  const stages = [];
  const { outputs, warnings, ms } = await extract(wasm, f.bytes, {
    expectedOutputs: tool.outputs.map((o) => o.id),
    maxOutputBytes: tool.limits.maxOutputBytes,
    onProgress: (p) => { if (p.stage < p.stages) stages.push(p.name); },
  });
  check(`${f.name}: the module labelled its output "${output.id}"`,
    outputs.length === 1 && outputs[0].id === output.id,
    outputs.map((o) => o.id).join(", "));
  check(`${f.name}: progress reported every stage`, stages.length > 0, stages.join(" / "));

  const data = outputs[0].data;
  check(`${f.name}: within the declared ceiling`, data.length <= output.maxBytes,
    `${data.length} vs ${output.maxBytes}`);

  const name = outputFileName(output, f);
  check(`${f.name} -> ${name}`, name === stemOf(f.name) + output.extension
    || name === f.variant?.filename, name);

  produced.push({ outputId: outputs[0].id, source: f, data, name, warnings, ms });
  const note = warnings.length ? `  (${warnings.length} warning)` : "";
  console.log(`  converted ${f.name} -> ${name}, ${data.length} bytes, ${ms} ms${note}`);
  for (const w of warnings) console.log(`      not placed: ${w}`);
}

// --- the byte-for-byte claim ------------------------------------------------
//
// This project has an oracle rather than a published hash: check.sh compares
// the module's output against build-host/whd_gen, the native converter built
// from the same sources, and that comparison is the real parity check. What is
// stated here is the one thing the oracle cannot say, because it does not run
// through the page's code: the size each recognised release comes out at, which
// gwrg.json already declares as `variants[].bytes` for the input side. A run
// whose output does not fit the manifest's own ceiling is caught above; run
// check.sh with the same WAD for the byte-for-byte answer.

// --- the install, and the zip -----------------------------------------------

const root = INSTALL_ROOT[target.kind];
const artifacts = (target.artifacts ?? []).map((a) => ({
  filename: a.filename,
  data: new Uint8Array(readFileSync(join(dirname(manifestPath), a.url))),
}));
for (const a of target.artifacts ?? []) {
  const got = artifacts.find((x) => x.filename === a.filename);
  check(`artifact ${a.filename} matches its hash`, sha256(got.data) === a.sha256);
}

let entries = [];
try {
  entries = planInstall({ root, target, tool, artifacts, produced });
  check("the install set has no colliding names", true);
} catch (e) {
  check("the install set has no colliding names", false, e.message);
}

console.log("\nzip layout:");
for (const e of entries) console.log(`  ${e.path}  (${e.data.length} bytes)`);

const blob = await makeZip(entries.map((e) => ({ name: e.path, data: e.data })));
const zipBytes = new Uint8Array(await blob.arrayBuffer());
check("the zip was built", zipBytes.length > 0, `${zipBytes.length} bytes`);

// Read the central directory back rather than trusting what we handed in: the
// names in there are what an unzip will actually create.
const names = [];
{
  const dv = new DataView(zipBytes.buffer);
  let eocd = zipBytes.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  check("the zip has an end-of-central-directory record", eocd >= 0);
  if (eocd >= 0) {
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      names.push(new TextDecoder().decode(zipBytes.subarray(p + 46, p + 46 + nameLen)));
      p += 46 + nameLen + extraLen + commentLen;
    }
    check("every entry the plan named is in the zip",
      entries.length === names.length
      && entries.every((e) => names.includes(e.path)),
      names.join(", "));
  }
}
check("the core is in the core directory",
  names.some((n) => n === `${root}/${target.artifacts[0].filename}`),
  names.filter((n) => !n.includes("/", root.length + 1)).join(", "));
if (target.kind === "core") {
  // The placement rule, on the names an unzip would actually create: a
  // converted WAD is a game, so it goes where the launcher browses for games.
  const dir = `roms/${systemIdFor(target, tool, output.id)}`;
  check("every converted game is under the system's rom folder",
    produced.every((p) => names.includes(`${dir}/${p.name}`)), dir);
  check("nothing is under homebrews", !names.some((n) => n.startsWith("homebrews/")),
    names.join(", "));
}

if (zipOut) {
  writeFileSync(zipOut, zipBytes);
  console.log(`\nwrote ${zipOut} (${zipBytes.length} bytes)`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
