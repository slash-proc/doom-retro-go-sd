# The browser conversion page

A static page that converts the WAD files from a Doom install into the `.whd`
files this core reads, published to GitHub Pages by CI. It serves two purposes:

1. **For users** — a way to produce a card's worth of Doom games without a
   terminal, an ARM toolchain, or a copy of the converter.
2. **For the project** — the reference consumer of the GWRG distribution spec.
   It uses the same `verify.mjs`, `extract.mjs` and `install.mjs` a command line
   or a web builder does, so if the spec or the ABI drifts, this page breaks in
   CI first.

It is also the **distribution endpoint**: GitHub release assets are not
CORS-fetchable, so a consuming web tool reads `manifest.json` and the module
from this Pages site. See
[spec/01-distribution.md](https://github.com/slash-proc/gwrg-dist-spec/blob/main/spec/01-distribution.md).

## Files

| | |
|---|---|
| `index.html` | markup |
| `style.css` | styles; light and dark |
| `app.js` | fetches and verifies the module, drives the flow |
| `worker.js` | runs one conversion off the main thread |
| `i18n.js` | page translations, English base, seven locales |

`build-page.sh` assembles these with `verify.mjs`, `extract.mjs`,
`install.mjs`, `zip.mjs` and a mirrored `dist/` into `site/`.

## What makes this one different

Most projects in this family convert one ROM into one file. This one takes a
folder. The manifest states that rather than the page assuming it: the input
declares `runPerFile`, so the module runs once for every WAD, and the output
declares an `extension` rather than a `filename`, so each produced file is named
from the WAD it came from — or, for a release the manifest recognises by hash,
from the name the project chose for it, so `DOOM.WAD` reaches the launcher as
`The Ultimate Doom.whd`.

**The user picks one folder and the page finds the WADs underneath it.** A DOS
install keeps its IWAD beside the executable, the re-releases keep it in
`base/`, a Steam copy buries both under a long path, and someone may well point
at a folder holding several of those. The page walks the whole subtree and
filters by extension, case-insensitively; the shape of the tree decides nothing.

**It says what it found before it converts anything.** Pointing at the wrong
folder is then visible in the list rather than after a conversion or four, and
the count of files that were none of our business is stated so nobody has to
wonder what happened to the rest of the folder.

**Two copies of one WAD are a question, not a surprise.** They would be written
under the same name, so the first is converted, the second is named in the
skipped list beside the path that won, and the selection can be narrowed if that
was the wrong call.

**The zip is laid out for the card, and that layout is two trees.** Doom is a
core, and spec/03-manifest.md is explicit about what that means: a `.whd`
produced from a WAD is a Doom ROM whether or not it arrived converted, so it
belongs beside one somebody was handed ready-made. The archive therefore holds

```
cores/doom.bin
roms/doom/The Ultimate Doom.whd
roms/doom/Doom II - Hell on Earth.whd
```

rather than the `homebrews/<name>/` layout a homebrew's page produces. The
system folder comes from the core's own `systems[]`, and `uses[].system` picks
one when a core declares several. Every path segment is validated; none of them
comes from the module.

## Design notes

**Verification is silent.** Users cannot act on its details and saying
"verified!" is reassurance, not information. The info box, which answers *what
goes in and what comes out*, renders only once the module has been hash-matched
and verified, so its presence is the result of the check while its content is
something a user wants. On failure the page says it cannot run, and why.

**"Not a release we know" is a note, not an error.** The manifest lists the
commercial IWADs by hash, and the input is deliberately not `strict`: a PWAD, a
fan megawad, or an IWAD from a release nobody has hashed yet cannot match by
construction and converts perfectly well. So an unmatched file reads as a line
under the row rather than as a failed run.

**One worker per WAD.** Doom II costs the module around 220 MiB and wasm memory
only ever grows, so a single instance converting four IWADs in turn would hold
the largest one's high-water mark until the page was closed. Terminating the
worker is the only way to give that back, and it is also the only way to
implement a timeout, since the ABI has no cancellation flag.

## Two failure modes to know about

`verify.mjs`, `extract.mjs`, `install.mjs` and `zip.mjs` are loaded directly by
the browser as well as run under node. Node-only constructs in them throw at
import time and take the page down **silently** — no error anywhere, just a page
where nothing happens. Both a `#!/usr/bin/env node` shebang and a bare
`process.argv` in a CLI block have bitten the page this one is descended from.
`build-page.sh` fails the build on either, and `test-site.mjs` checks the same
thing on the assembled result, because the two can be run apart.

## Checking it

```bash
./build-page.sh                                  # assembles site/
node test-site.mjs site                          # the wiring, no browser
node test-install.mjs                            # the naming and placement rules
node test-i18n.mjs                               # every string, every locale
node test-convert.mjs site /path/to/doom         # a real install, end to end
```

The first four run in CI. `test-convert.mjs` does not and cannot: it needs
commercial WAD data, which this project cannot ship and CI cannot obtain, so it
is a local check run by hand before a release — the same standing as check.sh's
byte-for-byte parity run against the native converter. It imports its code out
of `site/` rather than out of the source tree, so what it exercises is the files
a browser would fetch: it converts every WAD it finds, builds the zip, and reads
the archive's central directory back to see the names an unzip would create.
