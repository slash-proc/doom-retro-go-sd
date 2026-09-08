#!/usr/bin/env bash
# Build the module, verify it, and prove its output byte-for-byte against the
# native converter.
#
#   ./check.sh                     build + verify + malformed-input handling
#   ./check.sh /path/to/doom2.wad  also byte-for-byte parity against the oracle
#
# The oracle is build-host/whd_gen, built from the same sources by the host
# compiler. Parity against real data is the only thing that makes a port of
# this kind trustworthy, which is why the native build is kept rather than
# retired: it is the reference, not dead code.
set -euo pipefail
cd "$(dirname "$0")/../.."

WAD="${1:-}"
MODULE=tools/extractor/doom_whd.wasm

echo "== build =="
bash tools/extractor/build.sh
ls -l "$MODULE" | awk '{print "   " $5 " bytes"}'

echo
echo "== conformance =="
node tools/extractor/verify.mjs "$MODULE"

echo
echo "== malformed input =="
# Not an edge case: the manifest declares this input strict:false, so files
# that match no known IWAD hash reach the module by design. Each of these must
# come back as an error with a message, never as a trap and never as output.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
head -c 100000 /dev/urandom > "$tmp/junk.wad"
head -c 8 /dev/zero > "$tmp/tiny.wad"
printf 'IWAD\xff\xff\xff\x7f\xff\xff\xff\x7f garbage' > "$tmp/badhdr.wad"
for f in junk tiny badhdr; do
  if node tools/extractor/extract.mjs "$MODULE" "$tmp/out.whd" "$tmp/$f.wad" >/dev/null 2>"$tmp/err"; then
    echo "   FAIL - $f.wad was accepted"; exit 1
  fi
  grep -q "trapped" "$tmp/err" && { echo "   FAIL - $f.wad trapped instead of returning"; cat "$tmp/err"; exit 1; }
  echo "   ok: $f.wad -> $(sed -n 's/.*failed ([0-9]*): //p' "$tmp/err" | head -1)"
done

if [[ -z "$WAD" ]]; then
  echo
  echo "No WAD given - skipping the parity check."
  echo "Run './check.sh /path/to/doom2.wad' to compare against the native converter."
  exit 0
fi

echo
echo "== native oracle =="
# Always rebuilt from the current sources. A stale binary is worse than no
# binary here: it would compare the module against a converter that no longer
# exists and call the difference a regression.
#
# Built through the Makefile, so there is one definition of how the oracle is
# compiled and it cannot drift from the one `make convert` uses.
rm -f build-host/whd_gen
make -s build-host/whd_gen
python3 scripts/build/wadwide.py "$WAD" "$tmp/cropped.wad" >/dev/null
build-host/whd_gen "$tmp/cropped.wad" "$tmp/native.whd" -no-super-tiny -raw-columns >/dev/null
echo "   $(stat -c%s "$tmp/native.whd") bytes"

echo
echo "== wasm module =="
# The module crops widescreen art itself, so it is given the ORIGINAL WAD --
# the same file a user would hand a web tool, not the pre-processed one.
node tools/extractor/extract.mjs "$MODULE" "$tmp/wasm.whd" "$WAD"

echo
if cmp "$tmp/native.whd" "$tmp/wasm.whd"; then
  echo "PASS - wasm output is byte-identical to the native converter."
else
  echo "FAIL - output differs from the native converter."
  exit 1
fi
