#!/usr/bin/env bash
# Runs every V1.1 automated check against the source in this repo.
# Needs Node 18+. The dashboard checks also need jsdom (installed automatically into the work folder).
# Usage:  bash purchase-intelligence-v1.1/tests/run_all.sh  [work-folder]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; SRC="$HERE/.."
WORK="${1:-$(mktemp -d)}"; mkdir -p "$WORK/server" "$WORK/dashboard"
# Apps Script files under the names the harness expects
cp "$SRC/apps-script/Code.js"            "$WORK/server/Code.js"
cp "$SRC/apps-script/goodscheckapi.js"   "$WORK/server/gc.js"
cp "$SRC/apps-script/LiveApi 7.2.js"     "$WORK/server/LiveApi.js"
cp "$SRC/apps-script/ShipmentApi.js"     "$WORK/server/ShipmentApi.js"
cp "$SRC/apps-script/BillApi.js"         "$WORK/server/BillApi.js"
cp "$SRC/apps-script/ProductsApi.js"     "$WORK/server/ProductsApi.js"
cp "$SRC/apps-script/ShipmentTools.js"   "$WORK/server/ShipmentTools.js"
cp "$SRC/apps-script/RegisterApi.js"     "$WORK/server/RegisterApi.js"
cp "$HERE"/server/*.js "$WORK/server/"
cp "$SRC/frontend/VT_Purchase_Intelligence_V1_1.html" "$WORK/dashboard/"
cp "$HERE"/dashboard/*.js "$WORK/dashboard/"
echo "== Server: self-tests (shipments 42, bills 54)";            (cd "$WORK/server" && node hconv.js | tail -2)
echo "== Server: product sync (Supabase + master fallback)";      (cd "$WORK/server" && node hprod.js 2>&1 | sed -n '1p;6,14p')
echo "== Server: lot conversion / correct product / undo";        (cd "$WORK/server" && node hconv5.js 2>&1 | grep -E "DRY RUN|APPLIED|IDENTICAL|NOT undone|recode:|tracking")
cd "$WORK/dashboard"; [ -d node_modules/jsdom ] || npm i -s jsdom@24 >/dev/null 2>&1
for t in t28 t29 t30 t31 t32 t33 t34 t35; do echo "== Dashboard: $t"; timeout 120 node $t.js 2>&1 | tail -4; done
echo "== Dashboard: press every button";                          timeout 900 node audit2.js | grep -E "TOTAL|✗"
