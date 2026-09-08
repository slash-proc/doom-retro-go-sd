# Changelog

Doom CORE for [Game & Watch Retro-Go SD](https://github.com/sylverb/game-and-watch-retro-go-sd).

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release tags must
match a section heading exactly (for example `v1.0.0`).

When you cut a release:

1. Move items from `[Unreleased]` into a new `## [vX.Y.Z] - YYYY-MM-DD` section.
2. Commit the changelog update.
3. Push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`

CI reads the matching section and uses it as the GitHub Release notes.

## [v0.1.0] - 2026-09-08

### Added

- Published under the [GWRG distribution
  spec](https://github.com/slash-proc/gwrg-dist-spec): a `manifest.json`
  describing this core and the system it provides, an offline bundle, and a
  GitHub Pages mirror of `dist/` that a web installer can read without a human
  in the loop.
- `symbols[]` publishes the linked ELF so a crash address from a device can be
  resolved back to a function. It is named by the manifest and mirrored, but is
  not part of the install set and never reaches the card.
- `gwrg.json`, the hand-written half of the manifest: the short console name
  and whether compressed ROMs work. Everything else -- the system, its folder,
  extensions and browse mode, the firmware ABI, sizes and hashes -- is derived
  from the packed binary at release time, so the manifest and the firmware
  cannot disagree about which folder the system reads.
- The Doom tab is keyed by the `doom` folder the packed core names. Its "ROMs"
  are `.whd` files converted from a WAD on a host machine, which the manifest
  treats exactly as it treats a cartridge dump: a file the user supplies into
  `/roms/doom/`. Nothing else is installed, so there is no `bios[]` and no
  sidecar.
- The Makefile answers `print-TARGET_ELF` and `print-TARGET_MAP`, naming the
  engine's `doom.out` and the map the linker already writes beside it. Neither
  had a name outside the recipe that builds them.
- Integrate gnw-doom engine + G&W platform layer into this single-project tree
  (`/cores/doom.bin`, WHDs under `/roms/doom/`).

### Changed

- `scripts/make_manifest.py`, `build_dist.py`, `make_bundle.py` and
  `stage_release.py` are now the shared copies, byte-identical across every
  project. A script that has to be edited on the way in is a script that
  drifts.
- The Makefile answers `print-SIDECARS` and `print-RO_BIN`. This core installs
  neither, but the shared release script reads its variables positionally: a
  missing target shifts every later value onto the wrong name.
- Adapt `src/gnw/abi_stubs.c` to the current firmware ABI (direct audio/LCD/input
  slots; `*_ctl` folding was reverted upstream).
