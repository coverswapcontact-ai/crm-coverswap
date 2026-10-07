// Mission 24 — chaque photo du lot cadrée comme le pipeline la donne au modèle (`cadrerPourGeneration`, mode rogner),
// plus une grille de 5 % pour dessiner les masques à la main.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { cadrerPourGeneration, tailleSelonRatio } from "../../src/lib/simulations/cadrage";
import { dimensionsImage } from "../../src/lib/simulations/generation";
import { CADRE, LOT, lireLot } from "./commun";

async function main() {
for (const p of lireLot()) {
  const octets = fs.readFileSync(path.join(LOT, `${p.id}.jpg`));
  const dims = dimensionsImage(octets)!;
  const c = await cadrerPourGeneration(octets, tailleSelonRatio(dims.width, dims.height), "rogner");
  fs.writeFileSync(path.join(CADRE, `${p.id}.png`), c.photo);
  const [L, H] = c.taille.split("x").map(Number);
  const lignes: string[] = [];
  for (let i = 5; i < 100; i += 5) {
    const fort = i % 10 === 0;
    const x = (i / 100) * L, y = (i / 100) * H;
    lignes.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${fort ? "#ff0" : "#0ff"}" stroke-width="${fort ? 2 : 1}" opacity="0.7"/>`);
    lignes.push(`<line x1="0" y1="${y}" x2="${L}" y2="${y}" stroke="${fort ? "#ff0" : "#0ff"}" stroke-width="${fort ? 2 : 1}" opacity="0.7"/>`);
    if (fort) lignes.push(`<text x="${x + 3}" y="22" font-size="22" fill="#ff0" font-family="Arial" stroke="#000" stroke-width="0.8">${i}</text><text x="3" y="${y - 4}" font-size="22" fill="#ff0" font-family="Arial" stroke="#000" stroke-width="0.8">${i}</text>`);
  }
  await sharp(c.photo).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}">${lignes.join("")}</svg>`) }]).jpeg({ quality: 80 }).toFile(path.join(CADRE, `${p.id}-grille.jpg`));
  console.log(p.id, c.taille);
}
}
void main();
