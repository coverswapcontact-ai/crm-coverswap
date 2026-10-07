// Mission 24 — contrôle gratuit du score : la photo contre elle-même, puis la photo dont le masque est peint au hex
// exact (avec l'ombrage de la photo conservé) : couleur proche de 50, fidélité 30.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CADRE, RACINE } from "./commun";
import { lireMasques, masqueBinaire } from "./masques";
import { scorer } from "./score";
import { hexVersRgb, versLineaire, versSrgb } from "../../src/lib/simulations/teintes";
import { balanceAutomatique, dilater, labImage } from "../../src/lib/simulations/mesure-rendu";

async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8"));
  const masques = lireMasques();
  for (const [id, refId] of [["p06", "RM30"], ["p09", "K1"], ["p10", "AA17"], ["p02", "J4"]]) {
    const ref = cat.find((r: { id: string }) => r.id === refId);
    const avant = path.join(CADRE, `${id}.png`);
    const { data, largeur, hauteur } = await masqueBinaire(id, masques[id]);
    const s0 = await scorer(avant, avant, data, largeur, hauteur, ref);
    // Peinture : couleur cible × (luminance locale / luminance médiane du masque), l'ombrage reste.
    const rgb = await sharp(avant).removeAlpha().raw().toBuffer();
    const lum = (i: number) => 0.3 * rgb[3 * i] + 0.59 * rgb[3 * i + 1] + 0.11 * rgb[3 * i + 2];
    const dans: number[] = [];
    for (let i = 0; i < largeur * hauteur; i++) if (data[i] > 127) dans.push(lum(i));
    dans.sort((a, b) => a - b);
    const med = dans[dans.length >> 1] || 1;
    // La teinte sous la lumière de la scène : l'inverse des gains de la balance des blancs prise hors masque.
    const ext = dilater(Uint8Array.from(data, (v) => (v > 127 ? 1 : 0)), largeur, hauteur, Math.round(largeur * 0.03));
    const bal = balanceAutomatique(rgb, await labImage(rgb, largeur, hauteur), ext, largeur * hauteur);
    const c = hexVersRgb(ref.hex).map((v, k) => versSrgb(versLineaire(v) / bal.gains[k]));
    for (let i = 0; i < largeur * hauteur; i++) if (data[i] > 127) { const f = Math.min(1.3, lum(i) / med); for (let k = 0; k < 3; k++) rgb[3 * i + k] = Math.max(0, Math.min(255, versSrgb(versLineaire(c[k]) * f))); }
    const peint = path.join(RACINE, `essai-peint-${id}.png`);
    await sharp(rgb, { raw: { width: largeur, height: hauteur, channels: 3 } }).png().toFile(peint);
    const s1 = await scorer(avant, peint, data, largeur, hauteur, ref);
    console.log(id, refId, "identique", JSON.stringify(s0.couleur), s0.fidelite, "| peint", s1.total, JSON.stringify(s1.couleur), JSON.stringify(s1.fidelite), JSON.stringify(s1.finition));
  }
}
void main();
