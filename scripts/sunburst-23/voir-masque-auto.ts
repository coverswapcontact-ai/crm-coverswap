// Calibrage Sunburst, S1 — pour l'œil : le masque automatique (rouge, rempli) sur le masque dessiné de la mission 24
// (vert, pointillé), à la pleine taille de la photo cadrée. Écrit dans `~/coverswap-photos/sunburst-23/masques-auto/
// surimpression/` (hors dépôt). Aucun appel.
//   node --import tsx scripts/sunburst-23/voir-masque-auto.ts p01 p02 [--suffixe -v2]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { lireMasques } from "../sunburst-24/masques";
import { MASQUES_AUTO, cheminCadre } from "./commun";

type Poly = [number, number][];

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--suffixe");
  const suffixe = i >= 0 ? args[i + 1] : "";
  const photos = args.filter((a, k) => !a.startsWith("--") && (i < 0 || k !== i + 1));
  const dessins = lireMasques() as Record<string, { polygones: Poly[] }>;
  const sortie = path.join(MASQUES_AUTO, "surimpression");
  fs.mkdirSync(sortie, { recursive: true });
  for (const p of photos) {
    const auto = JSON.parse(fs.readFileSync(path.join(MASQUES_AUTO, `${p}${suffixe}.json`), "utf8")).polygones as Poly[];
    const image = sharp(fs.readFileSync(cheminCadre(p)));
    const { width: l = 0, height: h = 0 } = await image.metadata();
    const pts = (q: Poly) => q.map(([x, y]) => `${(x / 100) * l},${(y / 100) * h}`).join(" ");
    const t = Math.max(3, Math.round(l / 300));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="${h}">${auto.map((q) => `<polygon points="${pts(q)}" fill="rgba(255,0,0,0.35)" stroke="#ff0000" stroke-width="${t}"/>`).join("")}${(dessins[p]?.polygones ?? []).map((q) => `<polygon points="${pts(q)}" fill="none" stroke="#00ff00" stroke-width="${t}" stroke-dasharray="${t * 4},${t * 2}"/>`).join("")}</svg>`;
    const f = path.join(sortie, `${p}${suffixe}.jpg`);
    await image.composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 88 }).toFile(f);
    console.log(`${p} : ${l} × ${h} → ${f}`);
  }
}
void main().catch((e) => {
  console.error("[sunburst-23]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
