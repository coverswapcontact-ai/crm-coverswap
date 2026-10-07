// Mission 24 — le score automatique d'un rendu, sur le masque DESSINÉ (pas deviné par différence, comme en mission 23) :
// Pondération finale : couleur 45, fidélité hors masque 25, structure 15, finition 15.
//  - couleur (45 pts) : ΔE 2000 entre la médiane du rendu dans le masque érodé (balance des blancs automatique hors masque,
//    règles de `mesure-rendu.ts`) et le hex du catalogue ; ΔE ≤ 1 → 50, ΔE ≥ 10 → 0 ; aussi le ΔE à clarté égale et la dérive ;
//  - fidélité hors masque (30 pts) : écart des contours (carte de bords de `planches.ts`) hors du masque dilaté, et dérive
//    de couleur médiane (ΔE76 pixel à pixel) hors masque — 15 + 15 ;
//  - structure (15 pts) : part des bords francs de la photo DANS la zone (poignées, joints, cadres) perdus dans le rendu ;
//    ≤ 10 % → 15, ≥ 60 % → 0 (ajoutée après l'essai C3 : le score ne voyait pas les façades redessinées) ;
//  - finition (15 pts) : texture (écart-type local de L*, 7 × 7) conforme à la classe (uni : lisse ; bois, pierre : présente)
//    12 pts ; brillance (part de reflets francs dans le masque) conforme au profil (mat : peu ; laqué : quelques-uns) 8 pts.
import sharp from "sharp";
import { balanceAutomatique, classeTexture, dilater, eroder, labImage, type ClasseTexture } from "../../src/lib/simulations/mesure-rendu";
import { carteBords, ecartCartes } from "../../src/lib/simulations/planches";
import { deltaE2000, hexVersRgb, rgbVersLab, versLineaire, versSrgb, type Lab, type Rgb } from "../../src/lib/simulations/teintes";
import { profilDe } from "../../src/lib/simulateur/moteur/materiaux";
import type { Reference } from "../../src/lib/simulateur/catalogue";

export type Score = {
  total: number;
  couleur: { points: number; deltaE: number; chromatique: number; mesure: string; derive: { L: number; a: number; b: number; C: number }; balance: string };
  fidelite: { points: number; contoursHors: number; deriveHors: number };
  structure: { points: number; perte: number };
  finition: { points: number; texture: number; classe: ClasseTexture; reflets: number; brillantAttendu: boolean };
};

const borne = (x: number) => Math.max(0, Math.min(1, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const mediane = (v: number[]) => {
  const t = [...v].sort((x, y) => x - y);
  return t.length ? t[t.length >> 1] : 0;
};

async function brut(fichier: string, L: number, H: number): Promise<Buffer> {
  return sharp(fichier).rotate().flatten({ background: "#ffffff" }).resize(L, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
}

/** Écart-type local de L* (fenêtre 7 × 7) médian sur les pixels du masque (échantillonnés). */
function textureLocale(Lc: Float32Array, m: Uint8Array, L: number, H: number): number {
  const valeurs: number[] = [];
  for (let y = 3; y < H - 3; y += 3) {
    for (let x = 3; x < L - 3; x += 3) {
      if (!m[y * L + x]) continue;
      let s = 0, s2 = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const v = Lc[(y + dy) * L + x + dx];
        s += v;
        s2 += v * v;
      }
      valeurs.push(Math.sqrt(Math.max(0, s2 / 49 - (s / 49) ** 2)));
    }
  }
  return mediane(valeurs);
}

export async function scorer(avant: string, rendu: string, masque: Uint8Array, largeur: number, hauteur: number, ref: Reference, zone?: Uint8Array): Promise<Score> {
  // Travail à 1024 px de grand côté.
  const k = 1024 / Math.max(largeur, hauteur);
  const L = Math.round(largeur * k), H = Math.round(hauteur * k), n = L * H;
  const m = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) m[y * L + x] = masque[Math.min(hauteur - 1, Math.floor(y / k)) * largeur + Math.min(largeur - 1, Math.floor(x / k))] > 127 ? 1 : 0;
  // La zone entière (masque dessiné, détails compris) pour la structure ; le masque troué pour la couleur et la finition.
  const structure = new Uint8Array(n);
  const src = zone ?? masque;
  for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) structure[y * L + x] = src[Math.min(hauteur - 1, Math.floor(y / k)) * largeur + Math.min(largeur - 1, Math.floor(x / k))] > 127 ? 1 : 0;
  const interieur = eroder(m, L, H, Math.round(L * 0.012));
  const exterieur = dilater(m, L, H, Math.round(L * 0.03));
  const rgbA = await brut(avant, L, H);
  const rgbR = await brut(rendu, L, H);
  const labR = await labImage(rgbR, L, H);
  const labA = await labImage(rgbA, L, H);

  // Couleur : balance des blancs du rendu prise hors du masque dilaté, puis médiane Lab dans le masque érodé.
  const balance = balanceAutomatique(rgbR, labR, exterieur, n);
  const lin = (c: number) => versLineaire(c);
  const corrige: Rgb[] = [];
  const pas = Math.max(1, Math.floor(n / 60000));
  for (let i = 0; i < n; i += pas) {
    if (!interieur[i]) continue;
    corrige.push([0, 1, 2].map((c) => versSrgb(lin(rgbR[3 * i + c]) * balance.gains[c])) as Rgb);
  }
  const labs = corrige.map(rgbVersLab);
  const med: Lab = [mediane(labs.map((l) => l[0])), mediane(labs.map((l) => l[1])), mediane(labs.map((l) => l[2]))];
  const cible = rgbVersLab(hexVersRgb(ref.hex ?? "#808080"));
  const dE = deltaE2000(med, cible);
  const chromatique = deltaE2000([cible[0], med[1], med[2]], cible);
  const C = (l: Lab) => Math.hypot(l[1], l[2]);
  const versHex = (lab: Lab) => {
    // Lab → sRGB (D65) pour l'affichage.
    const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    const X = 0.95047 * f(fx), Y = 1 * f(fy), Z = 1.08883 * f(fz);
    const rgb = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
    return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, versSrgb(v)))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  };
  const pointsCouleur = 45 * borne(1 - (dE - 1) / 9);

  // Fidélité hors masque : contours (masque dilaté retiré des deux cartes) et dérive de couleur pixel à pixel.
  const W = 768, Hc = Math.round((768 * H) / L);
  const [bA, bR] = await Promise.all([carteBords(avant, W, Hc), carteBords(rendu, W, Hc)]);
  for (let y = 0; y < Hc; y++) for (let x = 0; x < W; x++) {
    if (exterieur[Math.min(H - 1, Math.floor((y * H) / Hc)) * L + Math.min(L - 1, Math.floor((x * L) / W))]) {
      bA[y * W + x] = 0;
      bR[y * W + x] = 0;
    }
  }
  const contoursHors = ecartCartes(bA, bR, W, Hc);
  // Structure dans la zone : bords francs de chaque image pris PAR RAPPORT À LA ZONE (les 15 % des gradients de L* les
  // plus forts dans la zone, image par image : un film sombre sur une façade blanche garde des contours plus doux mais
  // présents), puis la part des bords de la photo absents du rendu, à 2 px près.
  const bordsZone = (lab: Float32Array): Uint8Array => {
    const g = new Float32Array(n);
    const v: number[] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < L - 1; x++) {
      const i = y * L + x;
      if (!structure[i]) continue;
      const gx = lab[i + 1 - L] + 2 * lab[i + 1] + lab[i + 1 + L] - lab[i - 1 - L] - 2 * lab[i - 1] - lab[i - 1 + L];
      const gy = lab[i - 1 + L] + 2 * lab[i + L] + lab[i + 1 + L] - lab[i - 1 - L] - 2 * lab[i - L] - lab[i + 1 - L];
      g[i] = Math.hypot(gx, gy);
      v.push(g[i]);
    }
    v.sort((x, y) => x - y);
    const seuil = Math.max(v[Math.floor(v.length * 0.85)] ?? 0, 6);
    return Uint8Array.from(g, (x) => (x >= seuil ? 1 : 0));
  };
  const sA = bordsZone(labA.L), sR = bordsZone(labR.L);
  let bordsAvant = 0, perdus = 0;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < L - 2; x++) {
    const i = y * L + x;
    if (!sA[i]) continue;
    bordsAvant++;
    let trouve = false;
    for (let dy = -2; dy <= 2 && !trouve; dy++) for (let dx = -2; dx <= 2 && !trouve; dx++) if (sR[i + dy * L + dx]) trouve = true;
    if (!trouve) perdus++;
  }
  const perte = bordsAvant ? (100 * perdus) / bordsAvant : 0;
  // Dérive de couleur hors masque par blocs de 24 px (moyennes Lab comparées) : insensible à un décalage d'un ou deux
  // pixels sur un carrelage ou un sol texturé, sensible à une pièce rééclairée ou reteintée.
  const ecarts: number[] = [];
  const B = 24;
  for (let by = 0; by + B <= H; by += B) {
    for (let bx = 0; bx + B <= L; bx += B) {
      let c = 0, lA = 0, aA = 0, bA2 = 0, lR = 0, aR = 0, bR2 = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) {
        const i = y * L + x;
        if (exterieur[i]) continue;
        c++;
        lA += labA.L[i]; aA += labA.a[i]; bA2 += labA.b[i];
        lR += labR.L[i]; aR += labR.a[i]; bR2 += labR.b[i];
      }
      if (c < (B * B) / 2) continue;
      ecarts.push(Math.hypot((lR - lA) / c, (aR - aA) / c, (bR2 - bA2) / c));
    }
  }
  const deriveHors = mediane(ecarts);
  const pointsFidelite = 12.5 * borne(1 - contoursHors / 40) + 12.5 * borne(1 - (deriveHors - 2) / 10);
  const pointsStructure = 15 * borne(1 - (perte - 10) / 50);

  // Finition : texture et reflets dans le masque érodé.
  const classe = classeTexture(ref);
  const texture = textureLocale(labR.L, interieur, L, H);
  const pointsTexture = classe === "uni" ? 9 * borne(1 - (texture - 1.5) / 2.5) : 9 * borne((texture - 0.4) / 0.8);
  const Ls: number[] = [];
  for (let i = 0; i < n; i += pas) if (interieur[i]) Ls.push(labR.L[i]);
  const mL = mediane(Ls);
  const reflets = Ls.length ? Ls.filter((v) => v > mL + 20).length / Ls.length : 0;
  const brillantAttendu = profilDe(ref) === "uni-brillant";
  const pointsReflets = brillantAttendu ? (reflets >= 0.003 ? 6 : 3) : 6 * borne(1 - (reflets - 0.01) / 0.07);

  const total = pointsCouleur + pointsFidelite + pointsStructure + pointsTexture + pointsReflets;
  return {
    total: r1(total),
    couleur: { points: r1(pointsCouleur), deltaE: r1(dE), chromatique: r1(chromatique), mesure: versHex(med), derive: { L: r1(med[0] - cible[0]), a: r1(med[1] - cible[1]), b: r1(med[2] - cible[2]), C: r1(C(med) - C(cible)) }, balance: `${balance.mode} ${balance.blanc ?? "—"}` },
    fidelite: { points: r1(pointsFidelite), contoursHors: r1(contoursHors), deriveHors: r1(deriveHors) },
    structure: { points: r1(pointsStructure), perte: r1(perte) },
    finition: { points: r1(pointsTexture + pointsReflets), texture: r1(texture), classe, reflets: Math.round(reflets * 1000) / 10, brillantAttendu },
  };
}
