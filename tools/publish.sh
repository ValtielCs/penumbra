#!/usr/bin/env bash
# Publish Penumbra to GitHub Pages in one go (public repository + Pages from the root of `main`).
# Run it yourself AFTER `gh auth login`:   bash tools/publish.sh [repo-name]   (default: penumbra)
# It fills [LIVE URL] / [REPO URL] in the slides and SUBMISSION.md, rebuilds the PDF and pushes again.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:-penumbra}"

gh auth status >/dev/null 2>&1 || { echo "Not logged in. Run: gh auth login"; exit 1; }
git config user.email >/dev/null || { echo "Set your git identity first: git config --global user.name/user.email"; exit 1; }
OWNER="$(gh api user --jq .login)"
REPO="https://github.com/$OWNER/$NAME"
LIVE="https://$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]').github.io/$NAME/"   # host as GitHub shows it; the /$NAME/ path stays case-sensitive
echo "Publishing to $REPO  ->  $LIVE"

# 1. fill the link placeholders and point the link-preview image at the live site
sed -i "s#\[LIVE URL\]#$LIVE#g; s#\[REPO URL\]#$REPO#g" docs/slides.html SUBMISSION.md README.md
sed -i "s#content=\"docs/og-card.png\"#content=\"${LIVE}docs/og-card.png\"#; s#<meta property=\"og:url\" content=\"[^\"]*\">#<meta property=\"og:url\" content=\"$LIVE\">#" index.html
# CI badge + live link under the README title, canonical URL for the app (idempotent)
sed -i "s#<!-- badges -->#[![tests]($REPO/actions/workflows/tests.yml/badge.svg)]($REPO/actions/workflows/tests.yml) · **[Open the live app]($LIVE)**#" README.md
grep -q 'rel="canonical"' index.html || sed -i "s#<meta property=\"og:url\" content=\"$LIVE\">#&\n  <link rel=\"canonical\" href=\"$LIVE\">#" index.html
bash tools/build-slides.sh >/dev/null || echo "(PDF rebuild skipped: Edge not found)"

# 2. commit everything that is not ignored (raw/ downloads and the hackathon guide stay local)
[ -d .git ] || git init -b main >/dev/null
git add -A
git commit -q -m "Penumbra - Lunar Landing Site Navigator (NASA Space Apps 2026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || echo "(nothing new to commit)"

# 3. create the public repository on first run, otherwise just push
if gh repo view "$OWNER/$NAME" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO.git"
  git push -u origin main
else
  gh repo create "$NAME" --public --source . --remote origin --push \
    --description "Compare lunar south-pole landing sites and dates: Sun & Earth above the real NASA LOLA horizon, power and direct-to-Earth windows (NASA Space Apps 2026)"
fi

# 4. enable GitHub Pages (branch main, folder /) - harmless if it is already on
gh api -X POST "repos/$OWNER/$NAME/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$NAME/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
gh repo edit "$OWNER/$NAME" --homepage "$LIVE" >/dev/null 2>&1 || true

echo
echo "Repository : $REPO"
echo "Live app   : $LIVE   (the first Pages build takes about a minute)"
echo "Demo deck  : $REPO/blob/main/docs/Penumbra-demo.pdf"
