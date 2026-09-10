// Builds a local `dist/` so the page can be assembled and tested before CI
// publishes a real one.
//
// The page reads a version index and a manifest and refuses to do anything
// without them, which is correct: a converter it has not hash-matched against
// a manifest is a converter it will not run. That leaves a gap on a developer's
// machine and in the tests, because a manifest only exists once a tag has been
// cut, and nothing here is allowed to invent one and publish it.
//
// So this writes a dist of the same shape from local files, and says loudly
// that it did. It is not a second source of truth: CI hands build-page.sh the
// real mirrored dist through DIST_DIR and this never runs there. What it is
// for is making `./build-page.sh && node test-site.mjs site` a real check of
// the page's fetch path rather than a check of nothing.
//
// The tool block is read out of gwrg.json rather than typed again here. That
// file is what scripts/make_manifest.py turns into the published manifest, so
// reading it is the closest a preview can get to the real thing: a variant
// added there shows up in the preview page without a second edit, and a mistake
// in it fails the tests here rather than after a release.
//
// The binary is a placeholder unless a real one is given, because building
// doom.bin needs an ARM toolchain and this script needs to work without one. It
// is labelled as such in the tag, so a preview build can never be mistaken for
// something installable.
//
//   node make-preview-dist.mjs <out-dir> [--bin <doom.bin>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "./verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

const args = process.argv.slice(2);
const out = args[0];
if (!out) {
  console.error("usage: make-preview-dist.mjs <out-dir> [--bin <doom.bin>]");
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const binPath = flag("--bin");

const TAG = "v0.0.0-preview";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const wasm = new Uint8Array(readFileSync(join(here, "doom_whd.wasm")));
// The ceiling the page holds the module to comes from the module, not from a
// number typed here twice. test-site.mjs checks the two agree, so reading it
// off the binary is what makes that check meaningful.
const maxMemoryPages = inspect(wasm).memories?.[0]?.max ?? 8192;

// The project's own declaration, verbatim where it can be. gwrg.json states
// what the manifest generator cannot derive from the binary: the accepted
// IWADs, their hashes, and the name each one takes on the card.
const gwrg = JSON.parse(readFileSync(join(repo, "gwrg.json"), "utf8"));
const declared = gwrg.tool;
const systems = Object.entries(gwrg.systems ?? {}).map(([id, s]) => ({
  id,
  longName: s.longName ?? s.shortName ?? id,
  shortName: s.shortName ?? id,
  extensions: s.extensions ?? [".whd"],
  compression: s.compression ?? false,
}));

// A placeholder unless a real binary was handed over. Recognisable on sight,
// and the tag says preview, so nobody can install this by accident and wonder
// why the device does nothing.
const bin = binPath
  ? new Uint8Array(readFileSync(binPath))
  : new TextEncoder().encode(
    "This is not doom.bin. It is a placeholder written by " +
    "make-preview-dist.mjs so the conversion page could be assembled and " +
    "tested without an ARM toolchain. A published release carries the real " +
    "core in its place.\n");

const manifest = {
  schemaVersion: 1,
  project: "doom",
  title: "Doom",
  docs: "https://github.com/slash-proc/doom-retro-go-sd#readme",
  source: { repo: "slash-proc/doom-retro-go-sd", commit: "0".repeat(40), ref: TAG },
  tools: [
    {
      id: declared.id,
      processor: { type: "wasm", version: 1 },
      title: declared.title,
      binary: {
        file: "doom_whd.wasm",
        url: "doom_whd.wasm",
        bytes: wasm.length,
        sha256: sha256(wasm),
      },
      limits: { maxMemoryPages, maxOutputBytes: declared.maxOutputBytes },
      options: declared.options ?? [],
      inputs: declared.inputs,
      outputs: declared.outputs,
    },
  ],
  targets: [
    {
      id: "gnw-retro-go",
      platform: "game-and-watch",
      label: "Game & Watch (Retro-Go SD)",
      // A core, which is the whole reason this page's install layout differs
      // from the homebrew page it descends from: the binary goes to the core
      // directory and what the converter produces is a game, so it goes where
      // the launcher browses for games instead of beside the binary.
      kind: "core",
      requiresAbi: { version: 2, minSize: 832 },
      systems,
      artifacts: [
        { filename: "doom.bin", bytes: bin.length, sha256: sha256(bin), url: "doom.bin" },
      ],
      // No `system`: this core declares one, so there is only one answer and
      // writing it down would be a field that can only ever be wrong.
      uses: [{ tool: declared.id, outputs: declared.outputs.map((o) => o.id), required: true }],
    },
  ],
};

const versions = {
  schemaVersion: 1,
  project: "doom",
  versions: [
    {
      tag: TAG,
      manifest: `${TAG}/manifest.json`,
      publishedAt: new Date(0).toISOString(),
      prerelease: true,
      requiresAbi: { version: 2, minSize: 832 },
    },
  ],
};

const dir = join(out, TAG);
mkdirSync(dir, { recursive: true });
writeFileSync(join(out, "versions.json"), JSON.stringify(versions, null, 2) + "\n");
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(dir, "doom_whd.wasm"), wasm);
writeFileSync(join(dir, "doom.bin"), bin);

console.log(`preview dist written to ${out} (${TAG})`);
console.log(`  ${(declared.inputs[0].variants ?? []).length} known IWAD hashes, from gwrg.json`);
console.log(`  doom.bin is ${binPath ? basename(binPath) : "a PLACEHOLDER, not installable"}`);
if (!existsSync(join(dir, "manifest.json"))) process.exit(1);
