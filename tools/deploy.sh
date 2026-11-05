#!/bin/bash
# Deploy the game to Cloudflare (Worker "mlion", static assets only, served at https://mlion.lol/).
#   bash tools/deploy.sh            build, then upload only the files the site serves
# Needs a one-time `npx wrangler login` on this machine. GitHub (branch claude/mlion-game) stays the source
# of truth: commit and push first, then deploy, so the live site is always a committed version.
set -euo pipefail
cd "$(dirname "$0")/.."

node tools/build.js
if [ -n "$(git status --porcelain -- index.html sw.js js css img manifest.webmanifest _headers wrangler.jsonc worker)" ]; then
  echo "Uncommitted changes in served files (or the build changed them): commit first." >&2
  exit 1
fi

rm -rf dist
mkdir dist
cp index.html sw.js manifest.webmanifest _headers dist/
cp -r css js img dist/
# the two big data files also as brotli at its strongest (worker/index.js sends these to browsers that take it)
node -e 'const z = require("zlib"), fs = require("fs");
  for (const f of ["dist/js/data.js", "dist/js/explain.js"]) fs.writeFileSync(f + ".br", z.brotliCompressSync(fs.readFileSync(f),
    { params: { [z.constants.BROTLI_PARAM_QUALITY]: 11, [z.constants.BROTLI_PARAM_LGWIN]: 24, [z.constants.BROTLI_PARAM_MODE]: z.constants.BROTLI_MODE_TEXT } }));'

npx -y wrangler@4 deploy --message "$(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-80)"
