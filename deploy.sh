#!/usr/bin/env bash
# Deploys hardest to GitHub Pages at michael-han.com/hardest (repo michaellhan/michaellhan.github.io, folder /hardest).
# Build-time env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, …) comes from .env.production.local or the shell;
# without Supabase credentials the site is built in demo mode (synthetic data, browser-only changes).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
SITE="${SITE_REPO:-$HOME/.cache/michaellhan.github.io}"

cd "$SRC"
npm run build

if [ ! -d "$SITE/.git" ]; then
  gh repo clone michaellhan/michaellhan.github.io "$SITE"
fi
git -C "$SITE" pull -q --ff-only

mkdir -p "$SITE/hardest"
rsync -a --delete "$SRC/dist/" "$SITE/hardest/"

# GitHub Pages has no SPA fallback: the site-wide 404.html sends /hardest/<path> back to /hardest/?p=<path>,
# and index.html restores the URL with history.replaceState. Inserted once, replaced on later deploys.
python3 - "$SITE/404.html" <<'PY'
import re, sys
path = sys.argv[1]
html = open(path).read()
snippet = """<!-- hardest:spa -->
  <script>
    (function () {
      var m = location.pathname.match(/^\\/hardest\\/(?!assets\\/)(.+)$/)
      if (m) location.replace('/hardest/?p=' + encodeURIComponent(m[1]) + (location.search ? '&' + location.search.slice(1) : '') + location.hash)
    })()
  </script>
  <!-- /hardest:spa -->"""
if '<!-- hardest:spa -->' in html:
    html = re.sub(r'<!-- hardest:spa -->.*?<!-- /hardest:spa -->', lambda _: snippet, html, flags=re.S)
else:
    html = html.replace('<head>', '<head>\n  ' + snippet, 1)
open(path, 'w').write(html)
PY

git -C "$SITE" add hardest 404.html
if git -C "$SITE" diff --cached --quiet; then
  echo "Site unchanged."
else
  git -C "$SITE" commit -q -m "hardest: deploy $(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo local)"
  git -C "$SITE" push -q
fi
echo "Deployed → https://michael-han.com/hardest/"
if ! git -C "$SRC" diff --quiet HEAD 2>/dev/null; then echo "Note: uncommitted changes were deployed."; fi
