#!/usr/bin/env bash
# Headless screenshot of the running app (WebGL via SwiftShader) with Microsoft Edge.
# Usage: bash tools/shot.sh <out.png> <WxH> "<hash-or-url>" [budget_ms]
#   e.g. bash tools/shot.sh docs/plan.png 1440,1010 "#site=c1&start=2027-03-01T00:00&days=29.53"
set -uo pipefail
out="$1"; size="$2"; target="$3"; budget="${4:-30000}"
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
[[ "$target" == http* ]] || target="http://127.0.0.1:8787/${target}"
outw="$(cygpath -m "$PWD")/$out"
profile="$(cygpath -m "${TEMP:-/tmp}")/edge-shot-$$-$RANDOM"   # fresh profile: avoids lock clashes between runs
for attempt in 1 2 3; do
  before=$(stat -c %Y "$out" 2>/dev/null || echo 0)
  "$EDGE" --headless=new --hide-scrollbars --lang=en-US --user-data-dir="$profile" --window-size="$size" \
    --virtual-time-budget="$budget" --use-angle=swiftshader --enable-unsafe-swiftshader \
    --screenshot="$outw" "$target" >/dev/null 2>&1
  after=$(stat -c %Y "$out" 2>/dev/null || echo 0)
  if [[ -f "$out" && "$after" != "$before" ]]; then echo "ok  $out"; rm -rf "$(cygpath -u "$profile")"; exit 0; fi
  sleep 1
done
echo "FAILED $out" >&2; exit 1
