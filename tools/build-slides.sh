#!/usr/bin/env bash
# Export docs/slides.html to docs/Penumbra-demo.pdf (7 slides, 16:9) with headless Microsoft Edge.
# Re-capture screenshots first if the UI changed (see README). Usage: bash tools/build-slides.sh
set -euo pipefail
cd "$(dirname "$0")/.."
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
ROOT="$(cygpath -m "$PWD" 2>/dev/null || pwd)"
"$EDGE" --headless=new --lang=en-US --no-pdf-header-footer --user-data-dir="$(cygpath -m "${TEMP:-/tmp}")/edge-pdf-$RANDOM" --print-to-pdf="$ROOT/docs/Penumbra-demo.pdf" "file:///$ROOT/docs/slides.html" 2>&1 | tail -1
ls -la docs/Penumbra-demo.pdf
