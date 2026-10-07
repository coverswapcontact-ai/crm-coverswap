// Mission 24 — les masques dessinés à la main (polygones en % de l'image cadrée, `masques.json` hors dépôt) :
// masque binaire (blanc = surface à changer), masque OpenAI (PNG RGBA, transparent = à modifier) et contrôle visuel.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CADRE, MASQUES, RACINE } from "./commun";

export type DefMasque = { zone: string; polygones: [number, number][][] };
export const lireMasques = (): Record<string, DefMasque> => JSON.parse(fs.readFileSync(path.join(RACINE, "masques.json"), "utf8"));

const svgPolygones = (d: DefMasque, L: number, H: number, remplissage: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}">${d.polygones.map((p) => `<polygon points="${p.map(([x, y]) => `${(x / 100) * L},${(y / 100) * H}`).join(" ")}" fill="${remplissage}"/>`).join("")}</svg>`;

/** Masque binaire (1 octet par pixel, 255 = dans la surface) à la taille de l'image cadrée. */
export async function masqueBinaire(id: string, d: DefMasque): Promise<{ data: Buffer; largeur: number; hauteur: number }> {
  const { width: L, height: H } = await sharp(path.join(CADRE, `${id}.png`)).metadata();
  const data = await sharp({ create: { width: L!, height: H!, channels: 3, background: "#000" } }).composite([{ input: Buffer.from(svgPolygones(d, L!, H!, "#fff")) }]).greyscale().raw().toBuffer();
  return { data, largeur: L!, hauteur: H! };
}

/** Masque pour /images/edits : même taille que l'image, alpha 0 là où le modèle doit peindre. */
export async function masqueOpenAI(id: string, d: DefMasque): Promise<Buffer> {
  const { data, largeur, hauteur } = await masqueBinaire(id, d);
  const rgba = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    rgba[i * 4 + 3] = data[i] > 127 ? 0 : 255;
  }
  return sharp(rgba, { raw: { width: largeur, height: hauteur, channels: 4 } }).png().toBuffer();
}

async function main() {
  const masques = lireMasques();
  for (const [id, d] of Object.entries(masques)) {
    const { width: L, height: H } = await sharp(path.join(CADRE, `${id}.png`)).metadata();
    fs.writeFileSync(path.join(MASQUES, `${id}.png`), await masqueOpenAI(id, d));
    const superpose = await sharp(path.join(CADRE, `${id}.png`)).composite([{ input: Buffer.from(svgPolygones(d, L!, H!, "rgba(255,0,200,0.45)")) }]).png().toBuffer();
    await sharp(superpose).resize(768).jpeg({ quality: 75 }).toFile(path.join(MASQUES, `${id}-controle.jpg`));
  }
  // Planche de contrôle.
  const ids = Object.keys(masques);
  const tuiles = await Promise.all(ids.map((id) => sharp(path.join(MASQUES, `${id}-controle.jpg`)).resize(400, 400, { fit: "contain", background: "#222" }).toBuffer()));
  await sharp({ create: { width: 1600, height: Math.ceil(ids.length / 4) * 400, channels: 3, background: "#222" } }).composite(tuiles.map((t, i) => ({ input: t, left: (i % 4) * 400, top: Math.floor(i / 4) * 400 }))).jpeg({ quality: 80 }).toFile(path.join(MASQUES, "planche-controle.jpg"));
  console.log("masques :", ids.join(" "));
}
if (process.argv[1]?.endsWith("masques.ts")) void main();

/**
 * Variante C3 : le masque « troué » sur les détails de la photo — poignées, boutons, rainures, moulures, joints : les
 * pixels du masque dont la clarté s'écarte de plus de `seuil` de la clarté locale (flou σ 8) restent opaques (non
 * repeints), dilatés de 2 px ; les détails de moins de 40 px sont ignorés (grain, bruit).
 */
export async function masqueTroue(id: string, d: DefMasque, seuil = 14): Promise<{ png: Buffer; binaire: Uint8Array; largeur: number; hauteur: number; trous: number }> {
  const { data, largeur: L, hauteur: H } = await masqueBinaire(id, d);
  const gris = await sharp(path.join(CADRE, `${id}.png`)).greyscale().raw().toBuffer();
  const flou = await sharp(path.join(CADRE, `${id}.png`)).greyscale().blur(8).raw().toBuffer();
  const detail = new Uint8Array(L * H);
  for (let i = 0; i < L * H; i++) if (data[i] > 127 && Math.abs(gris[i] - flou[i]) > seuil) detail[i] = 1;
  // Composantes de plus de 40 px seulement.
  const vu = new Uint8Array(L * H);
  const garde = new Uint8Array(L * H);
  const pile: number[] = [];
  for (let i = 0; i < L * H; i++) {
    if (!detail[i] || vu[i]) continue;
    const comp: number[] = [];
    pile.push(i);
    vu[i] = 1;
    while (pile.length) {
      const p = pile.pop()!;
      comp.push(p);
      const x = p % L, y = (p / L) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < L - 1 ? p + 1 : -1, y > 0 ? p - L : -1, y < H - 1 ? p + L : -1]) if (q >= 0 && detail[q] && !vu[q]) { vu[q] = 1; pile.push(q); }
    }
    if (comp.length >= 40) for (const p of comp) garde[p] = 1;
  }
  // Dilatation de 2 px.
  const trou = new Uint8Array(L * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) {
    if (!garde[y * L + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < L && yy < H) trou[yy * L + xx] = 1;
    }
  }
  const binaire = new Uint8Array(L * H);
  const rgba = Buffer.alloc(L * H * 4);
  let trous = 0;
  for (let i = 0; i < L * H; i++) {
    const peindre = data[i] > 127 && !trou[i];
    if (data[i] > 127 && trou[i]) trous++;
    binaire[i] = peindre ? 255 : 0;
    rgba[i * 4 + 3] = peindre ? 0 : 255;
  }
  const png = await sharp(rgba, { raw: { width: L, height: H, channels: 4 } }).png().toBuffer();
  return { png, binaire, largeur: L, hauteur: H, trous };
}
