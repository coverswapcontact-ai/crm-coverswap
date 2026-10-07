import { ZONES_SIMULATEUR, type IdZone } from "@/lib/simulateur/zones";

/**
 * Calibrage Sunburst (consigne du gérant du 07/10, mission 23, phase S0) — le MASQUE AUTOMATIQUE des façades, en deux
 * temps, pour remplacer les masques dessinés à la main de la mission 24 :
 *  1. un appel vision (demande construite ici, `demandeMasque` ; réponse lue par `lireReponseMasque`) détecte les
 *     façades de la zone demandée sur la photo cadrée, couverte d'une grille de 5 % numérotée (`grilleSvg`), et rend des
 *     polygones en % de l'image, comme ceux dessinés à la main ;
 *  2. le masque troué local de la mission 24 (`trouerMasque`, même algorithme que `scripts/sunburst-24/masques.ts ›
 *     masqueTroue`) : poignées, boutons, joints et rainures restent hors du repeint.
 * Le harnais (`comparerMasques`, `critereS1`) mesure le recouvrement (IoU) avec les 16 masques dessinés de la mission
 * 24, la part de façade manquée et la part débordée, et dit si le masque automatique passe la barre de S1 (IoU médian ≥
 * 0,8 et aucune façade manquée sur plus de 15 % de sa surface).
 * Aucun réseau ici : l'appel lui-même vit dans le script (`scripts/sunburst-23/masque-auto.ts`), derrière le plafond du
 * journal de la campagne ; `estimerCoutVision` chiffre un appel AVANT de le faire.
 */

export type Point = [number, number];
export type Polygone = Point[];
export type FacadeDetectee = { libelle: string; polygone: Polygone };

/** Le pas de la grille dessinée sur la photo (en % de la largeur et de la hauteur). */
export const PAS_GRILLE = 5;
/** Les sommets sont lus au demi-pour-cent près, comme les masques dessinés de la mission 24. */
export const PRECISION_SOMMET = 0.5;
/** Seuils de S1 (consigne) : IoU médian, part maximale d'une façade manquée. */
export const IOU_MEDIAN_MIN = 0.8;
export const MANQUEE_MAX = 0.15;
/** Côté de l'image envoyée au modèle vision (comme `imageEnDataUrl` du moteur). */
export const COTE_VISION = 1024;

/* ── La demande au modèle vision ─────────────────────────────────── */

export const SYSTEME_MASQUE =
  "You are a meticulous kitchen-fitting surveyor preparing a vinyl-wrap job. On a client's phone photograph you outline, as polygons, exactly the cabinet surfaces that will be covered. You never invent a surface that is not visible, and you never leave out a visible one.";

export function texteMasque(zone: IdZone): string {
  const z = ZONES_SIMULATEUR[zone];
  return [
    `The image is a phone photograph of a kitchen, overlaid with a measuring grid: thin lines every ${PAS_GRILLE} % of the width and of the height, thicker and numbered every 10 % (0 at the top-left corner, 100 at the right and bottom edges). Coordinates are [x, y] in percent of the image width and height.`,
    `ZONE TO COVER: ${z.nom}. It means ${z.cible}`,
    `Limits: ${z.limites}`,
    `Not covered (leave them out of the polygons when they are large; small handles and knobs inside a front may stay inside, they are cut out later): ${z.exclus}`,
    "Return JSON:",
    `- "facades": one entry per contiguous run of fronts of this zone (a run of base units, a tall unit, an island side, a group of wall units…). "libelle": a short English label ("base run left of the sink"). "polygone": the outline of the run, 3 to 12 [x, y] points in order around it, read on the grid, to the nearest ${PRECISION_SOMMET} %. Follow the visible outline of the fronts in perspective (top under the worktop edge, bottom above the plinth, the side edges), including fronts partly hidden by an object (the object is ignored, the front behind it is outlined) or cut by the frame (the polygon then runs along the image edge).`,
    '- "absente": true only if the zone does not appear in the photograph at all (then "facades" is empty).',
    "Leave out appliances in steel or glass, open shelves, the worktop, the backsplash, walls, windows, the floor and the plinth. Do not merge two runs separated by an appliance or a wall into one polygon.",
  ].join("\n");
}

export function schemaMasque(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      facades: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { libelle: { type: "string" }, polygone: { type: "array", items: { type: "array", items: { type: "number" } } } },
          required: ["libelle", "polygone"],
        },
      },
      absente: { type: "boolean" },
    },
    required: ["facades", "absente"],
  };
}

/** Les sommets ramenés dans [0, 100] et au demi-pour-cent ; un polygone de moins de 3 sommets ou d'aire nulle est écarté. */
export function lireReponseMasque(brut: unknown): { facades: FacadeDetectee[]; absente: boolean } | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as { facades?: unknown; absente?: unknown };
  if (!Array.isArray(o.facades)) return null;
  const facades: FacadeDetectee[] = [];
  for (const f of o.facades) {
    if (!f || typeof f !== "object" || !Array.isArray((f as { polygone?: unknown }).polygone)) continue;
    const points = ((f as { polygone: unknown[] }).polygone)
      .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && p.every((v) => typeof v === "number" && Number.isFinite(v)))
      .map(([x, y]) => [arrondirSommet(x), arrondirSommet(y)] as Point);
    if (points.length < 3 || aire(points) < 0.25) continue;
    facades.push({ libelle: String((f as { libelle?: unknown }).libelle ?? "").slice(0, 80), polygone: points });
  }
  return { facades, absente: o.absente === true };
}

const arrondirSommet = (v: number) => Math.max(0, Math.min(100, Math.round(v / PRECISION_SOMMET) * PRECISION_SOMMET));

/** Aire d'un polygone (formule du lacet), en %² de l'image. */
export function aire(p: Polygone): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** La grille de 5 % (traits fins), renforcée et numérotée tous les 10 %, à poser sur la photo envoyée au modèle. */
export function grilleSvg(largeur: number, hauteur: number): string {
  const traits: string[] = [];
  const corps = Math.max(12, Math.round(Math.min(largeur, hauteur) / 45));
  for (let i = PAS_GRILLE; i < 100; i += PAS_GRILLE) {
    const fort = i % 10 === 0;
    const x = (i / 100) * largeur;
    const y = (i / 100) * hauteur;
    const style = `stroke="${fort ? "#ffff00" : "#00ffff"}" stroke-width="${fort ? 2 : 1}" opacity="0.7"`;
    traits.push(`<line x1="${x}" y1="0" x2="${x}" y2="${hauteur}" ${style}/>`, `<line x1="0" y1="${y}" x2="${largeur}" y2="${y}" ${style}/>`);
    if (fort) {
      const texte = `font-size="${corps}" fill="#ffff00" font-family="Arial" stroke="#000000" stroke-width="0.8"`;
      traits.push(`<text x="${x + 3}" y="${corps + 2}" ${texte}>${i}</text>`, `<text x="3" y="${y - 4}" ${texte}>${i}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}">${traits.join("")}</svg>`;
}

/** L'image envoyée au modèle : la photo cadrée réduite à `COTE_VISION` de grand côté, grille posée, en JPEG. */
export async function imageAvecGrille(photo: Buffer): Promise<{ jpeg: Buffer; largeur: number; hauteur: number }> {
  const sharp = (await import("sharp")).default;
  const reduite = await sharp(photo).rotate().resize(COTE_VISION, COTE_VISION, { fit: "inside", withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width: largeur, height: hauteur } = reduite.info;
  const jpeg = await sharp(reduite.data).composite([{ input: Buffer.from(grilleSvg(largeur, hauteur)) }]).jpeg({ quality: 85 }).toBuffer();
  return { jpeg, largeur, hauteur };
}

/* ── Le coût d'un appel, estimé AVANT de le faire ────────────────── */

/** Prix publics (dollars par million de jetons) des modèles vision envisagés ; l'image est comptée en jetons d'entrée. */
export const PRIX_VISION: Record<string, { entree: number; sortie: number; methode: "patchs" | "tuiles"; multiplicateur?: number }> = {
  "gpt-4.1-mini": { entree: 0.4, sortie: 1.6, methode: "patchs", multiplicateur: 1.62 },
  "gpt-4.1": { entree: 2, sortie: 8, methode: "tuiles" },
};

/**
 * Jetons d'image d'après la règle publiée par OpenAI : pour les modèles « à patchs » (gpt-4.1-mini), des carrés de 32 px,
 * plafonnés à 1 536 (l'image est réduite au-delà), × le multiplicateur du modèle ; pour les modèles « à tuiles »
 * (gpt-4.1), 85 + 170 par tuile de 512 px, une fois l'image ramenée dans 2 048 px puis son petit côté à 768 px (85 en
 * détail « low »).
 */
export function jetonsImage(modele: string, largeur: number, hauteur: number, detail: "low" | "high" = "high"): number {
  const prix = PRIX_VISION[modele];
  if (!prix) throw new Error(`Modèle vision sans prix connu : ${modele}`);
  if (prix.methode === "patchs") {
    let l = largeur;
    let h = hauteur;
    const patchs = (a: number, b: number) => Math.ceil(a / 32) * Math.ceil(b / 32);
    if (patchs(l, h) > 1536) {
      const k = Math.sqrt((1536 * 32 * 32) / (l * h));
      l = Math.floor(l * k);
      h = Math.floor(h * k);
      while (patchs(l, h) > 1536) {
        l -= 1;
        h = Math.floor((l * hauteur) / largeur);
      }
    }
    return Math.ceil(patchs(l, h) * (prix.multiplicateur ?? 1));
  }
  if (detail === "low") return 85;
  let l = largeur;
  let h = hauteur;
  const k1 = Math.min(1, 2048 / Math.max(l, h));
  l *= k1;
  h *= k1;
  const k2 = Math.min(1, 768 / Math.min(l, h));
  l *= k2;
  h *= k2;
  return 85 + 170 * Math.ceil(l / 512) * Math.ceil(h / 512);
}

/** Jetons d'un texte, estimés à 1 pour 4 caractères (anglais), arrondis au-dessus. */
export const jetonsTexte = (texte: string) => Math.ceil(texte.length / 4);

export type EstimationVision = { modele: string; jetonsImage: number; jetonsTexte: number; jetonsSortie: number; dollars: number };

/**
 * Le coût estimé d'un appel de masque : image (grille comprise) + système + demande + schéma (+ 10 % et 20 jetons de
 * cadre de message), et une sortie de `jetonsSortie` (défaut 700 : 2 à 6 façades de 4 à 12 sommets).
 */
export function estimerCoutVision(modele: string, largeur: number, hauteur: number, zone: IdZone, jetonsSortie = 700, detail: "low" | "high" = "high"): EstimationVision {
  const prix = PRIX_VISION[modele];
  if (!prix) throw new Error(`Modèle vision sans prix connu : ${modele}`);
  const image = jetonsImage(modele, largeur, hauteur, detail);
  const texte = Math.ceil((jetonsTexte(SYSTEME_MASQUE) + jetonsTexte(texteMasque(zone)) + jetonsTexte(JSON.stringify(schemaMasque()))) * 1.1) + 20;
  const dollars = ((image + texte) * prix.entree + jetonsSortie * prix.sortie) / 1_000_000;
  return { modele, jetonsImage: image, jetonsTexte: texte, jetonsSortie, dollars: Math.round(dollars * 1_000_000) / 1_000_000 };
}

/** Coût réel d'un appel vision, depuis l'usage rendu par l'API (jetons d'entrée, image comprise, et de sortie). */
export function coutVision(modele: string, jetonsEntree: number, jetonsSortie: number): number {
  const prix = PRIX_VISION[modele];
  if (!prix) throw new Error(`Modèle vision sans prix connu : ${modele}`);
  return Math.round(((jetonsEntree * prix.entree + jetonsSortie * prix.sortie) / 1_000_000) * 1_000_000) / 1_000_000;
}

/* ── Des polygones au masque, puis le masque troué ───────────────── */

/** Un polygone en % → masque binaire (1 = dedans) à la taille donnée, par le test pair-impair au centre de chaque pixel. */
export function rasteriser(polygones: Polygone[], largeur: number, hauteur: number): Uint8Array {
  const m = new Uint8Array(largeur * hauteur);
  for (const p of polygones) {
    const pts = p.map(([x, y]) => [(x / 100) * largeur, (y / 100) * hauteur] as Point);
    const ys = pts.map((q) => q[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(hauteur - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if (ay <= cy !== by <= cy) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const debut = Math.max(0, Math.ceil(xs[k] - 0.5));
        const fin = Math.min(largeur - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = debut; x <= fin; x++) m[y * largeur + x] = 1;
      }
    }
  }
  return m;
}

/**
 * Le masque troué (variante C3 de la mission 24) : dans la zone, les pixels dont la clarté (gris 8 bits) s'écarte de
 * plus de `seuil` de la clarté locale (flou σ 8) forment des composantes ; celles d'au moins 40 px sont gardées, dilatées
 * de 2 px, et restent hors du repeint (poignées, boutons, joints, rainures). Rend le masque à peindre (1 = repeint).
 */
export function trouerMasque(zone: Uint8Array, gris: Uint8Array | Buffer, flou: Uint8Array | Buffer, largeur: number, hauteur: number, seuil = 14): { peindre: Uint8Array; trous: number } {
  const n = largeur * hauteur;
  const detail = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (zone[i] && Math.abs(gris[i] - flou[i]) > seuil) detail[i] = 1;
  const vu = new Uint8Array(n);
  const garde = new Uint8Array(n);
  const pile: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!detail[i] || vu[i]) continue;
    const comp: number[] = [];
    pile.push(i);
    vu[i] = 1;
    while (pile.length) {
      const p = pile.pop()!;
      comp.push(p);
      const x = p % largeur;
      const y = (p / largeur) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < largeur - 1 ? p + 1 : -1, y > 0 ? p - largeur : -1, y < hauteur - 1 ? p + largeur : -1]) {
        if (q >= 0 && detail[q] && !vu[q]) {
          vu[q] = 1;
          pile.push(q);
        }
      }
    }
    if (comp.length >= 40) for (const p of comp) garde[p] = 1;
  }
  const trou = new Uint8Array(n);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (!garde[y * largeur + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < largeur && yy < hauteur) trou[yy * largeur + xx] = 1;
        }
      }
    }
  }
  const peindre = new Uint8Array(n);
  let trous = 0;
  for (let i = 0; i < n; i++) {
    if (!zone[i]) continue;
    if (trou[i]) trous++;
    else peindre[i] = 1;
  }
  return { peindre, trous };
}

/** Le masque troué d'une photo (octets de l'image cadrée) pour des polygones en %. */
export async function masqueTroueDepuisPolygones(photo: Buffer, polygones: Polygone[], seuil = 14): Promise<{ zone: Uint8Array; peindre: Uint8Array; largeur: number; hauteur: number; trous: number }> {
  const sharp = (await import("sharp")).default;
  const { data: gris, info } = await sharp(photo).greyscale().raw().toBuffer({ resolveWithObject: true });
  const flou = await sharp(photo).greyscale().blur(8).raw().toBuffer();
  const zone = rasteriser(polygones, info.width, info.height);
  const { peindre, trous } = trouerMasque(zone, gris, flou, info.width, info.height, seuil);
  return { zone, peindre, largeur: info.width, hauteur: info.height, trous };
}

/** Le masque pour `/images/edits` : PNG RGBA à la taille de la photo, transparent là où le modèle peint. */
export async function masqueOpenAI(peindre: Uint8Array, largeur: number, hauteur: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const rgba = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) rgba[i * 4 + 3] = peindre[i] ? 0 : 255;
  return sharp(rgba, { raw: { width: largeur, height: hauteur, channels: 4 } }).png().toBuffer();
}

/* ── Le harnais : masque automatique contre masque dessiné ───────── */

export type Comparaison = {
  /** Intersection sur union des deux zones. */
  iou: number;
  /** Part de la zone dessinée absente du masque automatique. */
  manquee: number;
  /** Surface du masque automatique hors de la zone dessinée, rapportée à la zone dessinée. */
  debordee: number;
  /** Par polygone dessiné (une façade ou une suite de façades) : la part manquée. */
  manqueeParFacade: number[];
  pireFacade: number;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Compare deux masques binaires de même taille ; `facades` : un masque par polygone dessiné (pour la part manquée). */
export function comparerMasques(auto: Uint8Array, dessine: Uint8Array, facades: Uint8Array[] = []): Comparaison {
  let inter = 0;
  let union = 0;
  let nDessine = 0;
  let hors = 0;
  for (let i = 0; i < dessine.length; i++) {
    const a = auto[i] ? 1 : 0;
    const d = dessine[i] ? 1 : 0;
    if (a && d) inter++;
    if (a || d) union++;
    if (d) nDessine++;
    if (a && !d) hors++;
  }
  const manqueeParFacade = facades.map((f) => {
    let n = 0;
    let rate = 0;
    for (let i = 0; i < f.length; i++) {
      if (!f[i]) continue;
      n++;
      if (!auto[i]) rate++;
    }
    return n ? r3(rate / n) : 0;
  });
  return {
    iou: union ? r3(inter / union) : 1,
    manquee: nDessine ? r3((nDessine - inter) / nDessine) : 0,
    debordee: nDessine ? r3(hors / nDessine) : 0,
    manqueeParFacade,
    pireFacade: manqueeParFacade.length ? Math.max(...manqueeParFacade) : 0,
  };
}

/** La barre de S1 : IoU médian ≥ 0,8 et aucune façade manquée sur plus de 15 % de sa surface. */
export function critereS1(comparaisons: Comparaison[]): { passe: boolean; iouMedian: number; pireFacade: number; raisons: string[] } {
  const t = comparaisons.map((c) => c.iou).sort((a, b) => a - b);
  const m = t.length >> 1;
  const iouMedian = t.length === 0 ? 0 : r3(t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2);
  const pireFacade = comparaisons.length ? Math.max(...comparaisons.map((c) => c.pireFacade)) : 1;
  const raisons: string[] = [];
  if (comparaisons.length === 0) raisons.push("aucune comparaison");
  if (iouMedian < IOU_MEDIAN_MIN) raisons.push(`IoU médian ${iouMedian} < ${IOU_MEDIAN_MIN}`);
  if (pireFacade > MANQUEE_MAX) raisons.push(`une façade manquée à ${Math.round(pireFacade * 100)} % (> ${MANQUEE_MAX * 100} %)`);
  return { passe: raisons.length === 0, iouMedian, pireFacade, raisons };
}
