#!/bin/sh
# Mission 24 — lance des rendus « photo:ref » avec une variante et une phase, et affiche le score en une ligne.
# sh scripts/sunburst-24/lancer.sh <phase> <variante> p01:K4 p12:M7 …
phase=$1; v=$2; shift 2
for pr in "$@"; do
  p=${pr%%:*}; r=${pr##*:}
  node --import tsx scripts/sunburst-24/rendre.ts --photo $p --ref $r --phase $phase --variante $v --cle-depuis ../coverswap/.env.local 2>&1 | grep -E "^n°|ARRÊT|ÉCHEC|\[sunburst|   score"
  f=$(ls ~/coverswap-photos/sunburst-24/rendus | tail -1); npx tsx scripts/sunburst-24/comparer.ts "$f" >/dev/null 2>&1
done
