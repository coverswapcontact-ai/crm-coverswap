// Fige le lot de la mission 24 : photos « avant » copiées hors dépôt sous des identifiants anonymes (p01…p16).
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import sharp from "sharp";
const B = path.join(os.homedir(), "coverswap-photos");
const J = path.join(B, "calibrage/jeu/jeu-essai-simulateur-2026-10-07");
const OUT = path.join(B, "sunburst-24/lot");
const d = JSON.parse(fs.readFileSync(path.join(B, "sunburst-24/photos-distinctes.json"), "utf8"));
const src = (i) => { const id = d[i].id; const m = JSON.parse(fs.readFileSync(path.join(J, id, "meta.json"))); return path.join(J, id, m.fichiers.avant); };
// Arguments : la capture d'écran (p02) et la photo en contre-jour (p01), lues dans le CRM en lecture seule et non présentes dans l'export.
const captureEcran = process.argv[2];
const LOT = [
  ["p01", process.argv[3], "contre-jour, U crème, fenêtre en face", "exploration"],
  ["p02", captureEcran, "capture d'écran de téléphone, cuisine rouge", "exploration"],
  ["p03", src(23), "îlot et péninsule gris brillant", "exploration"],
  ["p04", src(1), "cuisine noire mate, îlot bois, suspensions", "exploration"],
  ["p05", src(13), "petite cuisine, gris anthracite", "exploration"],
  ["p06", src(0), "grande cuisine linéaire, lumière froide, béton", "exploration"],
  ["p07", src(37), "lumière chaude du soir, noire", "exploration"],
  ["p08", src(12), "cuisine blanche à cadres, plan bois, encombrée", "exploration"],
  ["p09", src(6), "U blanc et bois, encombrée", "exploration"],
  ["p10", src(26), "petite cuisine bois clair, verticale", "exploration"],
  ["p11", src(3), "bas blancs, contre-jour léger, encombrée", "exploration"],
  ["p12", src(39), "L bleu nuit, fenêtres", "exploration"],
  ["v01", src(9), "capture d'écran (photo réduite dans l'écran)", "validation"],
  ["v02", src(24), "contre-jour fort, blanche", "validation"],
  ["v03", src(29), "îlot bois, bas blancs", "validation"],
  ["v04", src(5), "grande cuisine noire brillante", "validation"],
];
const manifeste = [];
for (const [id, f, desc, role] of LOT) {
  const dest = path.join(OUT, `${id}.jpg`);
  await sharp(f).rotate().jpeg({ quality: 95 }).toFile(dest);
  const m = await sharp(dest).metadata();
  manifeste.push({ id, description: desc, role, largeur: m.width, hauteur: m.height });
}
fs.writeFileSync(path.join(OUT, "lot.json"), JSON.stringify(manifeste, null, 1));
console.log(manifeste.map((m) => `${m.id} ${m.largeur}x${m.hauteur} ${m.role}`).join("\n"));
