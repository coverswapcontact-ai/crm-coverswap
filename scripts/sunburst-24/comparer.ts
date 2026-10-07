// Mission 24 — avant / après côte à côte (pour l'œil), hors dépôt : planches/<rendu>.jpg ; avec --zoom, la zone masquée agrandie.
import path from "node:path";
import sharp from "sharp";
import { CADRE, PLANCHES, RENDUS } from "./commun";

async function main() {
  const [fichier] = process.argv.slice(2);
  const photo = fichier.split("-")[1];
  const L = 760;
  const a = await sharp(path.join(CADRE, `${photo}.png`)).resize(L).jpeg().toBuffer();
  const r = await sharp(path.join(RENDUS, fichier)).resize(L).jpeg().toBuffer();
  const h = (await sharp(a).metadata()).height!;
  await sharp({ create: { width: 2 * L + 8, height: h, channels: 3, background: "#111" } }).composite([{ input: a, left: 0, top: 0 }, { input: r, left: L + 8, top: 0 }]).jpeg({ quality: 85 }).toFile(path.join(PLANCHES, fichier));
  console.log(path.join(PLANCHES, fichier));
}
void main();
