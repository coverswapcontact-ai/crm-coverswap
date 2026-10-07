// Mission 24 — mosaïque de planches avant / après (pour l'œil), hors dépôt.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PLANCHES } from "./commun";

async function main() {
  const [sortie, ...fichiers] = process.argv.slice(2);
  const L = 1528, h = 380;
  const tuiles = await Promise.all(fichiers.map(async (f) => {
    const img = await sharp(path.join(PLANCHES, f)).resize(L, h, { fit: "contain", background: "#111" }).toBuffer();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="30"><rect width="100%" height="100%" fill="#000"/><text x="8" y="22" font-size="20" font-family="Arial" fill="#ff0">${f}</text></svg>`;
    return sharp({ create: { width: L, height: h + 30, channels: 3, background: "#111" } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }, { input: img, top: 30, left: 0 }]).jpeg().toBuffer();
  }));
  await sharp({ create: { width: L, height: fichiers.length * (h + 30), channels: 3, background: "#111" } }).composite(tuiles.map((t, i) => ({ input: t, top: i * (h + 30), left: 0 }))).jpeg({ quality: 80 }).toFile(path.join(PLANCHES, sortie));
  console.log(path.join(PLANCHES, sortie), fs.existsSync(path.join(PLANCHES, sortie)));
}
void main();
