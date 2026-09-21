/**
 * Couleur mesurée d'un échantillon : ce que ChatGPT lit mal sur une image, il
 * le lit sans erreur dans une phrase (« beige chaud clair, #C9B28F »).
 *
 * Mesure sur l'image réduite (48 × 48) : moyenne des pixels, clarté L* et
 * saturation (chroma) dans l'espace Lab, teinte (angle), et contraste du décor
 * (écart type de la clarté : un uni est à 2-3, un bois veiné à 8-15, un marbre
 * contrasté au-delà de 15).
 */
export type AnalyseCouleur = {
  hex: string;
  /** Clarté L* (0 noir, 100 blanc). */
  clarte: number;
  /** Saturation (chroma Lab). */
  chroma: number;
  /** Teinte en degrés (angle Lab), 0-360. */
  teinte: number;
  /** Contraste du décor : écart type de la clarté. */
  contraste: number;
};

type Sharp = typeof import("sharp");
async function chargerSharp(): Promise<Sharp> {
  const charge = await import("sharp");
  return (charge.default ?? charge) as Sharp;
}

function versLineaire(canal: number): number {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0-255) → Lab (D65). */
export function rgbVersLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const [R, G, B] = [versLineaire(r), versLineaire(g), versLineaire(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0").toUpperCase();

export async function analyserCouleur(image: Buffer): Promise<AnalyseCouleur> {
  const sharp = await chargerSharp();
  const { data, info } = await sharp(image).rotate().resize(48, 48, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let [r, g, b] = [0, 0, 0];
  const clartes: number[] = [];
  for (let i = 0; i < pixels; i++) {
    const [pr, pg, pb] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    r += pr;
    g += pg;
    b += pb;
    clartes.push(rgbVersLab(pr, pg, pb).L);
  }
  [r, g, b] = [r / pixels, g / pixels, b / pixels];
  const lab = rgbVersLab(r, g, b);
  const moyenne = clartes.reduce((s, v) => s + v, 0) / clartes.length;
  const contraste = Math.sqrt(clartes.reduce((s, v) => s + (v - moyenne) ** 2, 0) / clartes.length);
  const chroma = Math.hypot(lab.a, lab.b);
  const teinte = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return {
    hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`,
    clarte: Math.round(lab.L * 10) / 10,
    chroma: Math.round(chroma * 10) / 10,
    teinte: Math.round((teinte + 360) % 360),
    contraste: Math.round(contraste * 10) / 10,
  };
}

/* ── La couleur en mots ───────────────────────────────────────────── */

function familleTeinte(teinte: number, chroma: number, clarte: number): { en: string; fr: string } {
  if (chroma < 5) {
    if (clarte > 90) return { en: "white", fr: "blanc" };
    if (clarte < 18) return { en: "black", fr: "noir" };
    return { en: "grey", fr: "gris" };
  }
  // Tons chauds : les bois, les sables, les beiges — « jaune » ou « orange » n'y conviennent qu'aux teintes vraiment vives.
  if (teinte >= 20 && teinte < 100 && chroma < 26) {
    if (clarte >= 75) return chroma < 9 ? { en: "warm off-white / greige", fr: "blanc cassé chaud" } : { en: "warm beige", fr: "beige" };
    if (clarte >= 55) return chroma < 9 ? { en: "greige (warm grey-beige)", fr: "grège" } : { en: "sand / light tan", fr: "sable" };
    if (clarte >= 35) return { en: "mid brown", fr: "brun moyen" };
    return { en: "dark brown", fr: "brun foncé" };
  }
  if (teinte >= 20 && teinte < 100 && chroma < 45) {
    if (teinte < 50) return clarte < 45 ? { en: "chestnut / reddish brown", fr: "châtaigne" } : { en: "warm tan / caramel", fr: "caramel" };
    if (clarte >= 68) return { en: "honey beige", fr: "beige miel" };
    if (clarte >= 48) return { en: "honey / light tan", fr: "miel" };
    if (clarte >= 32) return { en: "caramel brown", fr: "brun caramel" };
    return { en: "dark brown", fr: "brun foncé" };
  }
  if (chroma < 12) {
    // Neutres légèrement teintés : bétons, gris colorés.
    if (teinte >= 100 && teinte < 200) return { en: "green-grey", fr: "gris vert" };
    if (teinte >= 200 && teinte < 300) return { en: "cool blue-grey", fr: "gris bleuté" };
    return { en: "warm grey", fr: "gris chaud" };
  }
  if (teinte < 20 || teinte >= 345) return { en: "red", fr: "rouge" };
  if (teinte < 45) return clarte < 50 ? { en: "rust / reddish brown", fr: "rouille" } : { en: "terracotta / salmon", fr: "terracotta" };
  if (teinte < 70) return clarte < 55 ? { en: "ochre brown", fr: "ocre brun" } : { en: "orange ochre", fr: "ocre orangé" };
  if (teinte < 100) return clarte < 55 ? { en: "olive brown", fr: "brun olive" } : { en: "golden yellow / mustard", fr: "jaune moutarde" };
  if (teinte < 150) return { en: "olive green", fr: "vert olive" };
  if (teinte < 200) return { en: "green", fr: "vert" };
  if (teinte < 240) return { en: "teal / blue-green", fr: "bleu canard" };
  if (teinte < 290) return { en: "blue", fr: "bleu" };
  if (teinte < 320) return { en: "purple", fr: "violet" };
  return { en: "pink / plum", fr: "rose prune" };
}

function nuanceClarte(clarte: number): { en: string; fr: string } {
  if (clarte >= 88) return { en: "very light", fr: "très clair" };
  if (clarte >= 72) return { en: "light", fr: "clair" };
  if (clarte >= 50) return { en: "medium", fr: "moyen" };
  if (clarte >= 30) return { en: "dark", fr: "foncé" };
  return { en: "very dark", fr: "très foncé" };
}

/** « light warm beige (about #C9B28F) » */
export function couleurEnMots(analyse: AnalyseCouleur): { en: string; fr: string } {
  const famille = familleTeinte(analyse.teinte, analyse.chroma, analyse.clarte);
  if (famille.en === "white" || famille.en === "black") return { en: `${famille.en} (about ${analyse.hex})`, fr: `${famille.fr} (${analyse.hex})` };
  // Les bruns et beiges portent déjà leur clarté dans leur nom : pas de « clair » en plus, sauf l'extrême.
  if (/brown|beige|sand|greige|off-white|tan|honey|caramel|chestnut|rust/.test(famille.en)) {
    const tres = analyse.clarte >= 88 ? { en: "very light ", fr: " très clair" } : { en: "", fr: "" };
    return { en: `${tres.en}${famille.en} (about ${analyse.hex})`, fr: `${famille.fr}${tres.fr} (${analyse.hex})` };
  }
  const nuance = nuanceClarte(analyse.clarte);
  return { en: `${nuance.en} ${famille.en} (about ${analyse.hex})`, fr: `${famille.fr} ${nuance.fr} (${analyse.hex})` };
}

/** Contraste du décor en mots, pour un décor à motif (bois, pierre). */
export function contrasteEnMots(analyse: AnalyseCouleur): string {
  if (analyse.contraste < 4) return "very subtle, almost plain";
  if (analyse.contraste < 8) return "soft, low-contrast";
  if (analyse.contraste < 14) return "clearly visible, medium contrast";
  return "bold, high-contrast";
}
