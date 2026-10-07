// Mission 24 — la correction de couleur APRÈS rendu, par famille de teintes, calculée sur les rendus Sunburst du prompt
// retenu (C1+C3), sans aucun appel payant.
//  - Mesure d'un rendu : balance des blancs prise hors de la zone (règles de `mesure-rendu.ts`), puis médiane Lab dans
//    le masque troué érodé ; écart à la cible (hex du catalogue) : rapport de clarté kL = L cible / L mesuré, et da, db.
//  - Correction d'une famille : médiane des kL, da, db de ses rendus.
//  - Application : dans le masque (bord adouci, σ 3 px), chaque pixel passe sous la balance de la scène, en Lab :
//    L × kL, a − da, b − db (l'écart de chaque pixel à la médiane est conservé : ombres, veinage, reflets), puis revient
//    sous la lumière de la scène.
//  - Évaluation honnête : chaque rendu est corrigé avec la correction calculée SANS lui (laisser-un-de-côté).
//   node --import tsx scripts/sunburst-24/correction.ts [--variante c1+c3] [--exclure p07]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Reference } from "../../src/lib/simulateur/catalogue";
import { balanceAutomatique, dilater, eroder, labImage } from "../../src/lib/simulations/mesure-rendu";
import { hexVersRgb, rgbVersLab, versLineaire, versSrgb, type Lab, type Rgb } from "../../src/lib/simulations/teintes";
import { CADRE, RACINE, RENDUS } from "./commun";
import { lireMasques, masqueBinaire, masqueTroue } from "./masques";
import { lireJournal, type Entree } from "./rendre";
import { scorer } from "./score";
import { familleDe } from "./variantes";

export type Correction = { kL: number; da: number; db: number; n: number };
const CORRIGES = path.join(RACINE, "corriges");
fs.mkdirSync(CORRIGES, { recursive: true });

const mediane = (v: number[]) => {
  const t = [...v].sort((x, y) => x - y);
  return t.length ? (t.length % 2 ? t[t.length >> 1] : (t[t.length / 2 - 1] + t[t.length / 2]) / 2) : 0;
};

// Lab ↔ sRGB (D65), pour l'application pixel à pixel.
const XN = 0.95047, ZN = 1.08883;
function labVersRgb([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = XN * f(fx), Y = f(fy), Z = ZN * f(fz);
  return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((v) => versSrgb(v)) as Rgb;
}

type Prepare = { L: number; H: number; rgb: Buffer; masque: Uint8Array; interieur: Uint8Array; gains: Rgb };

/** Le rendu ramené à la taille de la photo cadrée, son masque troué, l'intérieur érodé et la balance de la scène. */
async function preparer(e: Entree): Promise<Prepare> {
  const masques = lireMasques();
  const { binaire, largeur: L, hauteur: H } = await masqueTroue(e.photo, masques[e.photo]);
  const zone = (await masqueBinaire(e.photo, masques[e.photo])).data;
  const rgb = await sharp(path.join(RENDUS, e.fichier!)).resize(L, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const lab = await labImage(rgb, L, H);
  const m = Uint8Array.from(binaire, (v) => (v > 127 ? 1 : 0));
  const exterieur = dilater(Uint8Array.from(zone, (v) => (v > 127 ? 1 : 0)), L, H, Math.round(L * 0.03));
  const { gains } = balanceAutomatique(rgb, lab, exterieur, L * H);
  return { L, H, rgb, masque: m, interieur: eroder(m, L, H, Math.round(L * 0.012)), gains };
}

const sousBalance = (rgb: Buffer, i: number, g: Rgb): Rgb => [0, 1, 2].map((c) => versSrgb(versLineaire(rgb[3 * i + c]) * g[c])) as Rgb;

/** Écart du rendu à sa cible : kL, da, db (sous la balance de la scène). */
export async function ecartRendu(e: Entree, ref: Reference): Promise<Correction> {
  const p = await preparer(e);
  const labs: Lab[] = [];
  const pas = Math.max(1, Math.floor((p.L * p.H) / 80000));
  for (let i = 0; i < p.L * p.H; i += pas) if (p.interieur[i]) labs.push(rgbVersLab(sousBalance(p.rgb, i, p.gains)));
  const med: Lab = [mediane(labs.map((l) => l[0])), mediane(labs.map((l) => l[1])), mediane(labs.map((l) => l[2]))];
  const cible = rgbVersLab(hexVersRgb(ref.hex!));
  return { kL: cible[0] / Math.max(1, med[0]), da: med[1] - cible[1], db: med[2] - cible[2], n: 1 };
}

/** Applique une correction de famille au rendu, écrit le fichier corrigé et rend son chemin. */
export async function appliquer(e: Entree, c: Correction, suffixe: string): Promise<string> {
  const p = await preparer(e);
  // Bord adouci : le masque flouté (σ 3) sert de poids.
  const poids = await sharp(Buffer.from(p.masque.map((v) => v * 255)), { raw: { width: p.L, height: p.H, channels: 1 } }).blur(3).extractChannel(0).raw().toBuffer();
  const sortie = Buffer.from(p.rgb);
  const kL = Math.max(0.7, Math.min(1.4, c.kL));
  for (let i = 0; i < p.L * p.H; i++) {
    const w = poids[i] / 255;
    if (w < 0.01) continue;
    const lab = rgbVersLab(sousBalance(p.rgb, i, p.gains));
    const corrige = labVersRgb([Math.min(100, lab[0] * kL), lab[1] - c.da, lab[2] - c.db]);
    for (let k = 0; k < 3; k++) {
      const brut = versSrgb(versLineaire(Math.max(0, Math.min(255, corrige[k]))) / p.gains[k]);
      sortie[3 * i + k] = Math.round(Math.max(0, Math.min(255, (1 - w) * p.rgb[3 * i + k] + w * brut)));
    }
  }
  const fichier = path.join(CORRIGES, e.fichier!.replace(/\.jpg$/, `-${suffixe}.jpg`));
  await sharp(sortie, { raw: { width: p.L, height: p.H, channels: 3 } }).jpeg({ quality: 92 }).toFile(fichier);
  return fichier;
}

/** `--sans-L` : la clarté n'est pas corrigée (kL = 1), seulement la teinte et la saturation (a, b). */
const SANS_L = process.argv.includes("--sans-L");
export const moyenneFamille = (ecarts: Correction[]): Correction => ({ kL: SANS_L ? 1 : mediane(ecarts.map((x) => x.kL)), da: mediane(ecarts.map((x) => x.da)), db: mediane(ecarts.map((x) => x.db)), n: ecarts.length });

async function main() {
  const args = process.argv.slice(2);
  const variante = args.includes("--variante") ? args[args.indexOf("--variante") + 1] : "c1+c3";
  const exclues = args.includes("--exclure") ? args[args.indexOf("--exclure") + 1].split(",") : ["p07"];
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8")) as Reference[];
  const refDe = (id: string) => cat.find((r) => r.id === id)!;
  const masques = lireMasques();
  const rendus = lireJournal().filter((e) => e.fichier && e.variante === variante && e.phase !== "validation" && !exclues.includes(e.photo));
  const ecarts = new Map<number, Correction>();
  for (const e of rendus) ecarts.set(e.n, await ecartRendu(e, refDe(e.ref)));
  const parFamille = new Map<string, Entree[]>();
  for (const e of rendus) {
    const f = familleDe(e.ref)!;
    parFamille.set(f, [...(parFamille.get(f) ?? []), e]);
  }
  const bilan: Record<string, unknown> = {};
  for (const [famille, liste] of parFamille) {
    const finale = moyenneFamille(liste.map((e) => ecarts.get(e.n)!));
    console.log(`\n${famille} — correction (sur ${finale.n} rendus) : L × ${finale.kL.toFixed(3)}, a − (${finale.da.toFixed(1)}), b − (${finale.db.toFixed(1)})`);
    const lignes = [];
    for (const e of liste) {
      const autres = liste.filter((x) => x.n !== e.n).map((x) => ecarts.get(x.n)!);
      if (autres.length === 0) continue;
      const c = moyenneFamille(autres);
      const fichier = await appliquer(e, c, "corr-loo");
      const { binaire, largeur, hauteur } = await masqueTroue(e.photo, masques[e.photo]);
      const zone = (await masqueBinaire(e.photo, masques[e.photo])).data;
      const s = await scorer(path.join(CADRE, `${e.photo}.png`), fichier, binaire, largeur, hauteur, refDe(e.ref), zone);
      const avant = e.score!;
      lignes.push({ n: e.n, photo: e.photo, ref: e.ref, deltaEAvant: avant.couleur.deltaE, deltaEApres: s.couleur.deltaE, chromAvant: avant.couleur.chromatique, chromApres: s.couleur.chromatique, scoreAvant: avant.total, scoreApres: s.total });
      console.log(`  n°${e.n} ${e.photo} ${e.ref} : ΔE ${avant.couleur.deltaE} → ${s.couleur.deltaE} (chrom ${avant.couleur.chromatique} → ${s.couleur.chromatique}) ; score ${avant.total} → ${s.total}`);
    }
    bilan[famille] = { correction: finale, laisserUnDeCote: lignes };
  }
  fs.writeFileSync(path.join(RACINE, SANS_L ? "corrections-sans-L.json" : "corrections.json"), JSON.stringify(bilan, null, 1));
}
if (process.argv[1]?.endsWith("correction.ts")) void main();
