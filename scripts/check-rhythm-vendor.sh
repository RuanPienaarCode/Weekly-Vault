#!/bin/bash
# Report whether src/rhythm/ still matches a local Rhythm checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
RHYTHM="${RHYTHM_REPO:-$HOME/Github/rhythm-vault}"
[ -d "$RHYTHM/src" ] || { echo "No Rhythm checkout at $RHYTHM (set RHYTHM_REPO)"; exit 0; }
drift=0
for f in model.js dates.js markdown.js; do
  if cmp -s "src/rhythm/$f" "$RHYTHM/src/$f"; then echo "  same   $f"; else echo "  DRIFT  $f"; drift=1; fi
done
exit $drift
