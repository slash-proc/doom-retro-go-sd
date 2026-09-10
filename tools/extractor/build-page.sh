#!/usr/bin/env bash
# Assembles the GitHub Pages site into site/.
#
# The page is a consumer of the same verify.mjs, extract.mjs and install.mjs
# the command line uses -- they are copied in, not reimplemented -- so
# publishing the page from the same CI run that builds the module keeps the two
# in step by construction.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf site
mkdir -p site
cp page/index.html page/style.css page/app.js page/worker.js page/i18n.js site/
cp verify.mjs extract.mjs install.mjs zip.mjs site/

# These files are loaded directly by the browser. Node-only constructs in them
# fail at import time and take the whole page down silently, which is a much
# worse failure than a build error -- so make it a build error. Both of these
# have bitten the page this one is descended from.
for f in site/verify.mjs site/extract.mjs site/install.mjs site/zip.mjs \
         site/app.js site/worker.js site/i18n.js; do
  if head -c 2 "$f" | grep -q '#!'; then
    echo "$f starts with a shebang; browsers cannot parse it" >&2
    exit 1
  fi
  if grep -n 'process\.' "$f" | grep -qv 'typeof process'; then
    if ! grep -q 'typeof process !== "undefined"' "$f"; then
      echo "$f uses process.* without a typeof guard; it will throw in a browser" >&2
      exit 1
    fi
  fi
done

# What the page reads: the version index that build_dist.py mirrors into this
# same site. The page offers every version the mirror holds, defaults to the
# newest, and a new release therefore reaches users without redeploying this
# page. Each version's manifest is the identical file a third-party installer
# fetches, and the module and every other file the manifest names resolve
# beside it.
#
# Release assets cannot be used directly: they are not CORS-fetchable, which is
# the reason the mirror exists (the spec's spec/01-distribution.md).
#
# DIST_DIR names an already-mirrored dist to copy in, which is what CI passes.
# With nothing to copy, a preview dist is generated from the local module so
# that the assembled site is testable at all -- see make-preview-dist.mjs for
# why that is not a second source of truth.
VERSIONS_URL="${VERSIONS_URL:-dist/versions.json}"
if [[ -n "${DIST_DIR:-}" ]]; then
  cp -r "$DIST_DIR" site/dist
  echo "mirrored dist from: $DIST_DIR"
elif [[ "${NO_PREVIEW_DIST:-0}" == "1" ]]; then
  echo "note: no dist mirrored; the page will have nothing to load"
else
  node make-preview-dist.mjs site/dist ${DOOM_BIN:+--bin "$DOOM_BIN"}
  echo "note: this is a PREVIEW dist built from local files, not a published release"
fi

# MANIFEST_URL pins the page to one manifest instead of an index, which is what
# an offline bundle needs: a bundle is one version's files in one directory
# with no index above them. Setting it hides the version picker.
if [[ -n "${MANIFEST_URL:-}" ]]; then
  printf '{\n  "manifestUrl": "%s"\n}\n' "$MANIFEST_URL" > site/config.json
  echo "page is pinned to: $MANIFEST_URL"
else
  printf '{\n  "versionsUrl": "%s"\n}\n' "$VERSIONS_URL" > site/config.json
  echo "page reads its versions from: $VERSIONS_URL"
fi

# Nothing here is Jekyll, and Jekyll would swallow files it does not recognise.
touch site/.nojekyll

echo "site/ ready ($(du -sh site | cut -f1))"
