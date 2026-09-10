// Naming and placement for produced files.
//
// This is the half of spec/05-host.md that is pure computation, pulled out of
// the page so it can be tested without a browser and so the headless test and
// the page cannot drift apart: both call these functions, neither has a second
// copy of the rules.
//
// The rules, in the spec's words:
//
//   - "A module labels its outputs; the manifest and the host decide their
//     names." The module here emits the id `pkd` and nothing else. Every
//     filename below is built from the manifest and from the name of the file
//     the user chose, and a module-supplied string never reaches one.
//   - A derived name is the matched variant's `filename` when the input was
//     recognised and declares one, otherwise the input's own stem with the
//     declared `extension` REPLACING whatever it had. DOOM2.WAD becomes
//     DOOM2.whd, never DOOM2.WAD.whd.
//   - Validate the result as a plain file name: no separators, no `..`, no
//     control characters, length capped.
//   - Compare names case-insensitively and per destination directory. The card
//     is FAT or exFAT, which case-folds, so DOOM.whd and doom.whd are one file
//     there and two in any ordinary Set.
//   - Place a converted file by what it IS, not by where the project lives.
//     This project is a core, and spec/03-manifest.md is explicit about what
//     that means: "a `.whd` produced from a WAD is a Doom ROM whether or not it
//     arrived converted", so it belongs under `roms/<system id>/` beside one
//     the user supplied ready-made, while the core binary goes to the core
//     directory. `dataDir` is the homebrew rule and does not apply here; it is
//     still honoured below so this file stays usable by a homebrew that
//     vendors it.

/** Longest name the spec permits on the card. */
export const MAX_NAME_LENGTH = 200;

// FAT and exFAT refuse these outright; a separator would also let a name leave
// its directory, which is the reason the check exists at all rather than a
// tidiness preference. Everything else is allowed on purpose -- real filenames
// carry brackets, apostrophes and commas.
const FORBIDDEN = /["*/:<>?\\|]/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Why `name` is not usable as a filename, or null when it is.
 *
 * Returns a reason rather than throwing because every caller wants to show the
 * user what was wrong with which file, not to abort the whole run.
 */
export function fileNameProblem(name) {
  if (typeof name !== "string" || name.length === 0) return "empty";
  if (name.length > MAX_NAME_LENGTH) return `longer than ${MAX_NAME_LENGTH} characters`;
  if (CONTROL.test(name)) return "contains a control character";
  if (FORBIDDEN.test(name)) return "contains a character the card cannot store";
  if (name === "." || name === ".." || name.includes("..")) return "contains ..";
  if (name.startsWith(" ") || name.endsWith(" ")) return "starts or ends with a space";
  if (name.startsWith(".") || name.endsWith(".")) return "starts or ends with a dot";
  return null;
}

/** The same, for a manifest-declared path segment (`dataDir`, `subdir`). */
export function pathSegmentProblem(seg) {
  const bad = fileNameProblem(seg);
  if (bad) return bad;
  return null;
}

/**
 * Splits a `subdir` into validated segments. A subdir may name more than one
 * level ("fmv/en"), so it is the one manifest string that legitimately holds a
 * separator; each segment is still checked on its own.
 */
export function subdirSegments(subdir) {
  if (!subdir) return [];
  if (subdir.startsWith("/") || subdir.startsWith("\\")) {
    throw new Error(`subdir "${subdir}" is absolute`);
  }
  const parts = subdir.split("/");
  for (const p of parts) {
    const bad = pathSegmentProblem(p);
    if (bad) throw new Error(`subdir "${subdir}" has an unusable segment "${p}": ${bad}`);
  }
  return parts;
}

/** `DOOM2.WAD` -> `DOOM2`. A name with no dot is its own stem. */
export function stemOf(name) {
  const base = name.replace(/^.*[\\/]/, "");     // a picker may hand back a path
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The name a produced file gets.
 *
 * @param {{filename?: string, extension?: string}} output  the manifest's output
 * @param {{name: string, variant?: {filename?: string}|null}} [source]
 *        the file this run converted, for an output that derives its name
 * @returns {string}
 */
export function outputFileName(output, source = null) {
  if (output.filename) return output.filename;   // a publisher-declared name wins
  if (!output.extension) {
    throw new Error(`output "${output.id}" declares neither filename nor extension`);
  }
  if (!source) {
    throw new Error(`output "${output.id}" derives its name but no source file was given`);
  }
  // 1. the matched variant's own filename, which is how a recognised release
  //    gets the name the project chose for it -- "The Ultimate Doom.whd" in the
  //    launcher rather than DOOM.whd -- instead of the name on the disc.
  if (source.variant?.filename) {
    const bad = fileNameProblem(source.variant.filename);
    if (bad) throw new Error(`the manifest's filename for this file is unusable: ${bad}`);
    return source.variant.filename;
  }
  // 2. the user's own stem, with the declared extension replacing whatever the
  //    file had. This is the rule that stops a .wad renamed to .bin landing
  //    where the launcher looks for an executable.
  const name = stemOf(source.name) + output.extension;
  const bad = fileNameProblem(name);
  if (bad) throw new Error(`"${source.name}" cannot be named on the card: ${bad}`);
  return name;
}

/**
 * Where the install lands on the card, by what the project is.
 *
 * Nothing in a manifest says this. The spec is explicit that placement is the
 * installing firmware's decision rather than the project's, so the rule lives
 * here, once, next to its reason, and the manifest supplies only `kind`.
 */
export const INSTALL_ROOT = { homebrew: "homebrews", core: "cores" };

/** Where the launcher browses for games. A core's converted output is a game. */
export const ROMS_ROOT = "roms";

/**
 * The system a produced file belongs to.
 *
 * A core states its systems, and `uses[].system` says which one a tool's output
 * feeds. A core with one system needs to say nothing: there is only one answer
 * and making every single-system project write it down would be a field that
 * can only be wrong. With several and no `system`, there is no answer to guess
 * at, so this refuses instead of picking the first.
 */
export function systemIdFor(target, tool, outputId) {
  for (const use of target?.uses ?? []) {
    if (use.tool !== tool?.id) continue;
    if (use.outputs && !use.outputs.includes(outputId)) continue;
    if (use.system) return use.system;
  }
  const systems = target?.systems ?? [];
  if (systems.length === 1) return systems[0].id;
  if (systems.length === 0) {
    throw new Error("this core declares no systems, so its converted games have nowhere to go");
  }
  throw new Error(
    `this core declares ${systems.length} systems and uses[] does not say which one ` +
    `"${outputId}" belongs to`);
}

/**
 * Where an installed file goes, as the full path segments inside the zip.
 *
 * The two kinds place their converted files differently, and the difference is
 * the whole of spec/03-manifest.md's placement table. A homebrew's converted
 * assets sit beside its binary, under `dataDir` when it reads them from a
 * folder, because that is what the program opens at run time. A core's do not:
 * what its converter produces is a game, and games live under
 * `roms/<system id>/` where the launcher browses for them, next to a .whd
 * somebody was handed ready-made.
 */
export function outputDir(target, output, tool) {
  const kind = target?.kind;
  if (kind === "core") {
    const system = systemIdFor(target, tool, output.id);
    const bad = pathSegmentProblem(system);
    if (bad) throw new Error(`system id "${system}" is unusable: ${bad}`);
    // No dataDir. It is homebrew-only, and a core that declared one would be
    // asking for its games to be filed somewhere the launcher does not look.
    return [ROMS_ROOT, system, ...subdirSegments(output?.subdir)];
  }

  const root = INSTALL_ROOT[kind];
  if (!root) throw new Error(`cannot place a target of kind "${kind}"`);
  const segs = [root];
  if (target?.dataDir) {
    const bad = pathSegmentProblem(target.dataDir);
    if (bad) throw new Error(`dataDir "${target.dataDir}" is unusable: ${bad}`);
    segs.push(target.dataDir);
  }
  segs.push(...subdirSegments(output?.subdir));
  return segs;
}

/**
 * Plans the whole install set: every artifact, plus one produced file per
 * converted input, each with the path it takes inside the zip.
 *
 * `root` is where the published artifacts land: `cores` for this project,
 * because the launcher picks the core it starts out of that directory. The
 * produced files do not take it -- `outputDir` places them by what they are --
 * so the two halves of the archive deliberately end up in two trees.
 *
 * Collisions are refused here rather than at the zip, because the useful error
 * names the two files that clash and the zip only knows it was handed the same
 * string twice.
 *
 * @param {{root: string,
 *          target: object,
 *          tool: object,
 *          artifacts?: {filename: string, data?: Uint8Array}[],
 *          produced?: {outputId: string, source: {name: string, variant?: object},
 *                      data: Uint8Array}[]}} plan
 * @returns {{path: string, dir: string, name: string, data?: Uint8Array,
 *            kind: "artifact"|"output"}[]}
 */
export function planInstall({ root, target, tool, artifacts = [], produced = [] }) {
  const artifactRoot = root ?? INSTALL_ROOT[target?.kind];
  const bad = pathSegmentProblem(artifactRoot);
  if (bad) throw new Error(`install directory "${artifactRoot}" is unusable: ${bad}`);

  const entries = [];
  const add = (kind, dirSegs, name, data, source) => {
    const problem = fileNameProblem(name);
    if (problem) throw new Error(`"${name}" cannot be installed: ${problem}`);
    const dir = dirSegs.join("/");
    entries.push({ kind, dir, name, path: `${dir}/${name}`, data, source });
  };

  for (const a of artifacts) add("artifact", [artifactRoot], a.filename, a.data, null);

  for (const p of produced) {
    const declared = (tool.outputs ?? []).find((o) => o.id === p.outputId);
    // The module's own string, matched against the manifest and never used for
    // anything else. An id we do not recognise is a module doing something the
    // manifest did not declare, which is a refusal and not a rename.
    if (!declared) {
      throw new Error(`the converter produced "${p.outputId}", which this version does not declare`);
    }
    add("output", outputDir(target, declared, tool), outputFileName(declared, p.source),
      p.data, p.source);
  }

  // Per directory, case-folded, because that is how the destination compares
  // them. Two files in different directories cannot collide however alike
  // their names are, which is why the key includes the directory.
  const seen = new Map();
  for (const e of entries) {
    const key = `${e.dir.toLowerCase()}/${e.name.toLowerCase()}`;
    const first = seen.get(key);
    if (first) {
      const who = (x) => (x.source ? `${x.source.name} -> ${x.name}` : x.name);
      throw new Error(
        `two files would be installed as ${e.path}: ${who(first)} and ${who(e)}`);
    }
    seen.set(key, e);
  }

  return entries;
}
