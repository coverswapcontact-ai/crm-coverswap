// Mission 24 — contrôle visuel du masque troué (C3) : en magenta ce qui sera repeint, la photo visible dans les trous.
import path from "node:path";
import sharp from "sharp";
import { CADRE, MASQUES } from "./commun";
import { lireMasques, masqueTroue } from "./masques";

async function main() {
  const m = lireMasques();
  for (const id of process.argv.slice(2)) {
    const t = await masqueTroue(id, m[id]);
    const over = Buffer.alloc(t.largeur * t.hauteur * 4);
    for (let i = 0; i < t.largeur * t.hauteur; i++) if (t.binaire[i]) { over[i * 4] = 255; over[i * 4 + 2] = 200; over[i * 4 + 3] = 150; }
    const png = await sharp(over, { raw: { width: t.largeur, height: t.hauteur, channels: 4 } }).png().toBuffer();
    const sup = await sharp(path.join(CADRE, `${id}.png`)).composite([{ input: png }]).png().toBuffer();
    await sharp(sup).resize(1100).jpeg({ quality: 80 }).toFile(path.join(MASQUES, `${id}-troue.jpg`));
    console.log(id, "pixels gardés (trous) :", t.trous);
  }
}
void main();
