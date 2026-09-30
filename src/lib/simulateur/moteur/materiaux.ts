import { contrasteEnMots, couleurEnMots, rgbVersLab, type AnalyseCouleur } from "../couleur";
import { ZONES_SIMULATEUR, type FamillePose, type IdZone, type SensPose } from "../zones";
import type { ReferenceMoteur } from "./types";

/**
 * Réalisme des matériaux (mission 15, partie 2) : les seize profils de film
 * reformulés « studio » — essence probable d'un bois, largeur et rythme du fil,
 * pores, mat ou satiné, comment le décor prend la lumière ; veinage ou bandes
 * d'une pierre ; brossage d'un métal… —, la pose selon la zone (façades, plan,
 * crédence, murs, comptoir, îlot) et la couleur mesurée en toutes lettres.
 * Fonctions pures. `profilDe` remplace `profilRevetement` du site et
 * `profilDe` de `teintes.ts` (qui l'importe d'ici).
 */

export type Profil =
  | "uni-mat"
  | "uni-brillant"
  | "uni-raye"
  | "bois"
  | "bois-peint"
  | "marbre"
  | "pierre"
  | "terrazzo"
  | "beton"
  | "brique"
  | "metal-brosse"
  | "metal-poli"
  | "metal-patine"
  | "cuir"
  | "tissu"
  | "paillettes";

const contient = (texte: string, mots: string[]) => mots.some((m) => texte.includes(m));

export function profilDe(r: Pick<ReferenceMoteur, "nom" | "famille" | "categorie" | "tags">): Profil {
  const nom = ` ${r.nom} ${r.tags.join(" ")} ${r.categorie} `.toLowerCase();
  switch (r.famille) {
    case "couleur":
      if (contient(nom, ["stripe"])) return "uni-raye";
      return contient(nom, ["lacquer", "gloss", "shiny", "brillant"]) ? "uni-brillant" : "uni-mat";
    case "bois":
      return contient(nom, ["painted", "peint", "plain white", "turquoise", "dark blue"]) ? "bois-peint" : "bois";
    case "pierre":
      if (contient(nom, ["terrazzo", "multicolored", "spotted"])) return "terrazzo";
      if (contient(nom, ["marble", "marquina", "statuary", "onyx", "arabesque", "armani", "lombarda", "crema", "polished", "imperial", "opal", "calacatta", "carrara"])) return "marbre";
      return "pierre";
    case "beton":
      return contient(nom, ["brick"]) ? "brique" : "beton";
    case "metal":
      if (contient(nom, ["chrom", "glow", "aurora", "laser"])) return "metal-poli";
      if (contient(nom, ["patina", "corten", "antique", "iron", "copper", "bronze", "roseate"])) return "metal-patine";
      return "metal-brosse";
    case "textile":
      return r.tags.includes("cuir") || contient(nom, ["leather"]) ? "cuir" : "tissu";
    case "paillettes":
      return "paillettes";
    default:
      return "uni-mat";
  }
}

export const LIBELLES_PROFIL: Record<Profil, string> = {
  "uni-mat": "uni",
  "uni-brillant": "uni",
  "uni-raye": "uni rainuré",
  bois: "bois",
  "bois-peint": "bois peint",
  marbre: "marbre",
  pierre: "pierre",
  terrazzo: "terrazzo",
  beton: "béton",
  brique: "brique",
  "metal-brosse": "métal brossé",
  "metal-poli": "métal poli",
  "metal-patine": "métal patiné",
  cuir: "cuir",
  tissu: "textile",
  paillettes: "paillettes",
};

/* ── Couleur mesurée ─────────────────────────────────────────────── */

/** Une couleur du catalogue (`hex`) ramenée aux mesures Lab, sans contraste (il faut l'image pour le mesurer). */
export function couleurDepuisHex(hex: string): AnalyseCouleur | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lab = rgbVersLab(r, g, b);
  return {
    hex: `#${m[1].toUpperCase()}`,
    clarte: Math.round(lab.L * 10) / 10,
    chroma: Math.round(Math.hypot(lab.a, lab.b) * 10) / 10,
    teinte: Math.round(((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360),
    contraste: -1,
  };
}

/** La couleur connue d'une référence : mesurée par le CRM d'abord, sinon celle du catalogue du site. */
export function couleurDe(r: Pick<ReferenceMoteur, "hex" | "couleur">): AnalyseCouleur | null {
  if (r.couleur) return r.couleur;
  return r.hex ? couleurDepuisHex(r.hex) : null;
}

/** « light warm beige (about #C9B28F), low-contrast decor » — ou null si rien n'est mesuré. */
export function couleurEnPhrase(r: Pick<ReferenceMoteur, "hex" | "couleur">, profil: Profil): string | null {
  const couleur = couleurDe(r);
  if (!couleur) return null;
  const base = couleurEnMots(couleur).en;
  const aMotif = !["uni-mat", "uni-brillant", "uni-raye", "metal-poli"].includes(profil);
  if (!aMotif || couleur.contraste < 0) return base;
  return `${base}, ${contrasteEnMots(couleur)} decor`;
}

/* ── Les seize profils, en mots de studio ────────────────────────── */

/** L'essence probable d'un bois, d'après le nom Cover Styl'. */
export function essenceProbable(nom: string): string | null {
  const n = nom.toLowerCase();
  const table: [RegExp, string][] = [
    [/oak|chêne|chene/, "oak"],
    [/walnut|noyer/, "walnut"],
    [/wenge/, "wenge"],
    [/teak/, "teak"],
    [/ash\b|frêne/, "ash"],
    [/pine|pin\b/, "pine"],
    [/beech|hêtre/, "beech"],
    [/maple|érable/, "maple"],
    [/birch|bouleau/, "birch"],
    [/elm|orme/, "elm"],
    [/cherry|merisier/, "cherry"],
    [/mahogany|acajou/, "mahogany"],
    [/ebony|ébène/, "ebony"],
    [/larch|mélèze/, "larch"],
    [/cedar|cèdre/, "cedar"],
    [/bamboo/, "bamboo"],
    [/driftwood/, "weathered driftwood"],
    [/rustic|barn|reclaimed/, "reclaimed rustic wood"],
  ];
  return table.find(([motif]) => motif.test(n))?.[1] ?? null;
}

/** Largeur et rythme du fil d'un bois d'après le contraste mesuré (ou le nom, à défaut). */
function filDuBois(couleur: AnalyseCouleur | null, nom: string): string {
  const n = nom.toLowerCase();
  if (/plank|line|lined|stripe/.test(n)) return "a straight, tight grain with fine parallel lines a few millimetres apart";
  if (!couleur || couleur.contraste < 0) return "a natural grain at true scale, lines millimetres to a few centimetres apart, no visibly repeated knot";
  if (couleur.contraste < 4) return "a fine, discreet but clearly present straight grain (tight lines a few millimetres apart)";
  if (couleur.contraste < 8) return "a soft, low-contrast grain with gentle cathedral figures a few centimetres wide";
  if (couleur.contraste < 14) return "a clearly visible, medium-contrast grain with broad cathedral figures and occasional small knots";
  return "a bold, high-contrast grain with wide dark figures and marked knots";
}

/** La finition dans les mots du studio : mat profond, satiné, poli… */
function finitionDe(r: ReferenceMoteur, profil: Profil): string {
  if (profil === "uni-brillant") return "high-gloss lacquer look: soft, slightly blurred reflections of the lights already in the room, never a hard specular hotspot";
  if (profil === "metal-poli") return "polished, mirror-like finish that reflects only the existing room, blurred and plausible";
  if (profil === "paillettes") return "glossy ground where the flakes sparkle as tiny points of light, more where the room light hits";
  if (profil === "beton") return "deep, dead-matt mineral finish, fully diffuse, no reflection";
  if (profil.startsWith("metal")) return "satin metallic sheen with soft anisotropic highlights, no chrome effect";
  if (r.finition === "Structured") return "matt finish with a fine tactile emboss that catches grazing light";
  if (profil === "marbre") return "honed satin stone look: smooth, broad, soft reflections only";
  return "deep matt to soft-satin finish, no varnish shine, no hard specular reflection";
}

/**
 * Le film en une ligne de studio : matière, motif et son échelle, finition,
 * lumière, couleur mesurée. C'est la ligne « MATERIAL REALISM » de chaque film.
 */
export function decrireFilm(r: ReferenceMoteur, zone: IdZone | null): string {
  const profil = profilDe(r);
  const couleur = couleurDe(r);
  const phraseCouleur = couleurEnPhrase(r, profil);
  const sens = SENS_EN[zone ? ZONES_SIMULATEUR[zone].sens : "vertical"];
  const tete = `${r.ref} "${r.nom}"`;
  const finition = finitionDe(r, profil);
  const avecCouleur = (mot: string) => (phraseCouleur ? `${mot} ${phraseCouleur}` : `${mot} exactly as on the sample`);
  switch (profil) {
    case "uni-mat":
    case "uni-brillant":
      return `${tete}: solid colour with no pattern at all (no grain, no speckle, no gradient of its own); ${avecCouleur("colour")}, kept exact under the room's white balance (a white stays neutral, a deep colour stays deep); ${finition}.`;
    case "uni-raye":
      return `${tete}: solid colour with fine tone-on-tone embossed stripes a few millimetres apart, running ${sens}, reading as a fine texture from room distance; ${avecCouleur("colour")}; matt, the stripes only catch a faint directional sheen.`;
    case "bois": {
      const essence = essenceProbable(r.nom);
      return `${tete}: ${essence ? `${essence}-look` : "wood-grain"} decor with ${filDuBois(couleur, r.nom)}, running ${sens}, continuous over each panel, with a fine open-pore emboss; true-to-life scale (never enlarged into stripes, never shrunk into noise), neighbouring panels alike but not identical; ${avecCouleur("base tone")}; ${finition}.`;
    }
    case "bois-peint":
      return `${tete}: painted-wood decor, an opaque colour through which a faint tone-on-tone grain shows, running ${sens}; ${avecCouleur("colour")}; matt, the grain only reads in grazing light.`;
    case "marbre":
      return `${tete}: marble decor with irregular, organic, branching veins flowing diagonally or ${sens} across the whole panel, at large true-to-life scale (a main vein may cross a whole door or a metre of worktop), no mirrored repetition; ${avecCouleur("ground")}; ${finition}.`;
    case "pierre":
      return `${tete}: natural-stone decor (travertine, slate or granite type) with a fine irregular mineral structure — pits, clouds or soft layered bands running ${sens} — no tile joints, no repetition, true scale; ${avecCouleur("ground")}; matt mineral surface, soft diffuse shading.`;
    case "terrazzo":
      return `${tete}: terrazzo decor, a ground scattered with irregular stone chips (millimetres to a few centimetres), random, never aligned; ${avecCouleur("ground")}; smooth satin-matt surface.`;
    case "beton":
      return `${tete}: concrete decor with large, soft, irregular mottling and trowel movements, no joints, no cracks, no stains, true scale; ${avecCouleur("tone")}; ${finition}.`;
    case "brique":
      return `${tete}: brick decor printed on a flat film — horizontal courses in running bond at true scale (a brick about 22 × 6 cm) following the perspective of the surface, the surface itself staying flat; ${avecCouleur("overall tone")}; matt.`;
    case "metal-brosse":
      return `${tete}: brushed-metal decor with hair-fine straight brushing lines running ${sens}; highlights stretch across the brushing as soft bands, only from the lights already in the room; ${avecCouleur("metal tone")}; ${finition}.`;
    case "metal-poli":
      return `${tete}: polished, iridescent metallic film; ${avecCouleur("tone")}; ${finition} — it never invents an object, a window or a lamp in its reflection.`;
    case "metal-patine":
      return `${tete}: patinated metal decor (copper, bronze, corten or blackened iron type) with irregular clouds of oxidation, no direction, no repetition, true scale; ${avecCouleur("tone")}; ${finition}.`;
    case "cuir":
      return `${tete}: leather-look film with a tiny uniform grain that reads as an almost plain, soft surface from room distance; no seams, no stitching, no padding (a flat film); ${avecCouleur("colour")}; soft satin sheen with broad gentle highlights.`;
    case "tissu":
      return `${tete}: textile-look film (linen or weave) with a fine regular weave, threads about a millimetre, running ${sens} and across, reading as a soft heathered plain from room distance; flat, no folds, no seams; ${avecCouleur("colour")}; matt, fully diffuse.`;
    case "paillettes":
      return `${tete}: glitter film densely covered with minute random flakes (about a millimetre), no large sequins, no pattern; ${avecCouleur("ground")}; ${finition}.`;
  }
}

const SENS_EN: Record<SensPose, string> = {
  vertical: "vertically (bottom to top) on this surface",
  longueur: "along the length of this surface",
  horizontal: "horizontally (left to right) on this surface",
};

/* ── La pose selon la zone ───────────────────────────────────────── */

const POSE_PAR_FAMILLE: Record<FamillePose, string> = {
  facades: "the decor runs vertically and restarts on every door and drawer front; each front is wrapped separately, so the pattern never flows across a gap; reliefs, frames and grooves keep their shadow lines under the film",
  ilot: "the decor runs vertically and restarts on every front — the island fronts, back panel and end panels are wrapped one by one, so the pattern never flows across a gap; reliefs keep their shadow lines under the film",
  plan: "the decor runs along the length of the top and continues over the front edge and the returns, matched at the fold as if one slab had been cut and mitred; thickness and edge profile unchanged",
  credence: "one continuous flat panel laid horizontally over the whole backsplash: the tile grid and grout lines disappear; sockets and switches are cut out cleanly",
  murs: "large continuous vertical lengths of film with invisible seams over the whole surface; the light gradient across it and the cast shadows of objects stay where they were",
  comptoir: "large continuous vertical panels over the full height of the front and its returns; on a curved front the decor follows the curve without changing scale; existing panel joints stay visible",
  meuble: "each panel or front is wrapped separately up to its edges: the decor restarts at every seam; the top, if covered, is one continuous panel folded onto its front edge",
};

/** Comment le film se pose sur cette zone (phrase « how it is laid »). */
export function poseDeZone(zone: IdZone): string {
  return POSE_PAR_FAMILLE[ZONES_SIMULATEUR[zone].famillePose];
}

/** Règles d'échelle, de tension et de lumière communes à tous les films (bloc MATERIAL REALISM). */
export const REGLES_REALISME: readonly string[] = [
  "Scale is true to life: the samples are close-ups of the film; at room distance, grain lines, veins, chips or brushing read at their real size — never enlarged into bold bands, never shrunk into noise.",
  "The film is laid taut and flat: no bubbles, no wrinkles, no folds, no visible seams; it follows every existing relief without adding thickness.",
  "Light on the new material is physically right: the original pattern of light and shadow of Image 1 falls on it; only the way the surface answers light (matt, satin, gloss, metallic) changes, as described per film. Reflections show only what already exists in the room.",
  "Colour stays exact under the room's white balance: warm bulbs do not turn a white film cream, daylight does not turn it bluish; nothing is muted, pastelised or harmonised with the room.",
];
