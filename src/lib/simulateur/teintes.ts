import type { Reference } from "./catalogue";
import { contrasteEnMots, couleurEnMots, type AnalyseCouleur } from "./couleur";
import type { IdZone } from "./types-surface";
import { ZONES } from "./types-surface";

/**
 * Une teinte du catalogue décrite en toutes lettres, pour le générateur de
 * prompts ChatGPT : nom et référence Cover Styl', couleur mesurée, veinage ou
 * motif, sens de pose sur la zone, finition. Si ChatGPT lit mal l'échantillon
 * de la planche, la description compense.
 *
 * (Le mode API n'utilise pas ce fichier : sa consigne est construite par le
 * site, avec ses propres profils de revêtement.)
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

export function profilDe(r: Pick<Reference, "nom" | "famille" | "categorie" | "tags">): Profil {
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

const LIBELLES_PROFIL: Record<Profil, string> = {
  "uni-mat": "uni mat",
  "uni-brillant": "uni brillant",
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

const SENS_EN: Record<"vertical" | "longueur" | "horizontal", string> = {
  vertical: "vertically (bottom to top) on this surface",
  longueur: "along the length of this surface",
  horizontal: "horizontally on this surface",
};

function finitionEn(r: Reference, profil: Profil): string {
  if (profil === "uni-brillant") return "high-gloss lacquer-look finish: soft reflections of the lights already in the room, nothing invented";
  if (profil === "metal-poli") return "polished metallic finish, reflecting only the existing room, blurred";
  if (profil === "paillettes") return "glossy ground with tiny sparkling flakes";
  if (profil === "beton") return "dead-matt finish, fully diffuse, no reflection";
  if (profil.startsWith("metal")) return "satin metallic sheen, no mirror reflection";
  if (r.finition === "Structured") return "matt finish with a fine tactile emboss";
  if (profil === "marbre") return "honed satin stone look, soft broad reflections only";
  return "matt soft-touch finish, no gloss, no varnish shine";
}

/** La teinte en une phrase anglaise, pour une zone donnée (le sens du veinage dépend de la surface). */
export function decrireTeintePourPrompt(r: Reference, analyse: AnalyseCouleur | null, zone: IdZone | null): string {
  const profil = profilDe(r);
  const couleur = analyse ? couleurEnMots(analyse).en : null;
  const sens = SENS_EN[zone ? ZONES[zone].sens : "vertical"];
  const motif = analyse ? contrasteEnMots(analyse) : null;
  const tete = `Cover Styl' ${r.id} "${r.nom}"`;
  const avecCouleur = (texte: string) => (couleur ? `${texte} ${couleur}` : texte);
  switch (profil) {
    case "uni-mat":
    case "uni-brillant":
      return `${tete} — solid colour with NO pattern at all (no grain, no speckle, no gradient of its own): ${avecCouleur("colour")}; ${finitionEn(r, profil)}.`;
    case "uni-raye":
      return `${tete} — solid colour with fine tone-on-tone embossed stripes, a few millimetres apart, running ${sens}: ${avecCouleur("colour")}; ${finitionEn(r, profil)}.`;
    case "bois":
      return `${tete} — wood-grain decor${r.tags.length ? ` (${r.tags.filter((t) => t !== "bois").join(", ") || "wood"})` : ""}: ${avecCouleur("base tone")}; grain ${motif ?? "as on the sample"}, running ${sens}, continuous over each panel, true-to-life scale (grain lines millimetres to a few centimetres apart — never enlarged into stripes, never shrunk into noise), no visibly repeated knot; ${finitionEn(r, profil)}.`;
    case "bois-peint":
      return `${tete} — painted-wood decor: opaque ${avecCouleur("colour")} with a faint tone-on-tone wood grain running ${sens}; ${finitionEn(r, profil)}.`;
    case "marbre":
      return `${tete} — marble decor: ${avecCouleur("ground")}; veins ${motif ?? "as on the sample"}, irregular and organic (never parallel stripes, never a grid), large true-to-life scale, flowing diagonally or ${sens}, no mirrored repetition; ${finitionEn(r, profil)}.`;
    case "pierre":
      return `${tete} — natural-stone decor (travertine, slate or granite type): ${avecCouleur("ground")}; fine irregular mineral structure, ${motif ?? "as on the sample"}, no tile joints, no repetition; matt stone finish.`;
    case "terrazzo":
      return `${tete} — terrazzo / speckled stone decor: ${avecCouleur("ground")} scattered with irregular stone chips (millimetres to a few centimetres), random, no alignment; satin-matt finish.`;
    case "beton":
      return `${tete} — concrete / cement decor: ${avecCouleur("tone")}; soft cloudy mottling ${motif ? `(${motif})` : ""}, no joints, no cracks, no stains; ${finitionEn(r, profil)}.`;
    case "brique":
      return `${tete} — brick decor printed on a FLAT film: ${avecCouleur("overall tone")}; horizontal courses in running bond, true scale (a brick ≈ 22 × 6 cm); the surface stays flat and keeps its outline; matt.`;
    case "metal-brosse":
      return `${tete} — brushed-metal decor: ${avecCouleur("metal tone")}; hair-fine straight brushing lines running ${sens}; ${finitionEn(r, profil)}.`;
    case "metal-poli":
      return `${tete} — polished / iridescent metallic film: ${avecCouleur("tone")}; ${finitionEn(r, profil)}.`;
    case "metal-patine":
      return `${tete} — patinated metal decor (copper, bronze, corten or blackened iron type): ${avecCouleur("tone")}; irregular clouds of oxidation, no repetition; ${finitionEn(r, profil)}.`;
    case "cuir":
      return `${tete} — leather-look film: ${avecCouleur("colour")}; tiny uniform leather grain, no seams, no stitching, no padding (it is a flat film); soft satin sheen.`;
    case "tissu":
      return `${tete} — textile-look film (linen or weave): ${avecCouleur("colour")}; fine regular weave, threads about a millimetre, running ${sens} and across; flat, no folds; matt.`;
    case "paillettes":
      return `${tete} — glitter film: ${avecCouleur("ground")}; densely covered with minute random sparkling flakes; ${finitionEn(r, profil)}.`;
  }
}

/** La teinte en quelques mots, pour l'écran et l'espace client : « bois · beige chaud clair · mat ». */
export function resumerTeinte(r: Reference, analyse: AnalyseCouleur | null): string {
  const profil = profilDe(r);
  const couleur = analyse ? couleurEnMots(analyse).fr.replace(/\s*\(#[0-9A-F]{6}\)$/, "") : null;
  const finition = profil === "uni-brillant" ? "brillant" : profil.startsWith("metal") ? "métallisé" : profil === "paillettes" ? "pailleté" : r.finition === "Structured" ? "mat texturé" : "mat";
  return [LIBELLES_PROFIL[profil], couleur, finition].filter(Boolean).join(" · ");
}

/* ── Goûts du client → teintes à proposer en premier ─────────────── */

/** La référence correspond-elle à ce goût exprimé par le client ? (sans mesure : d'après le nom et la famille) */
export function correspondAuStyle(r: Reference, style: string, analyse: AnalyseCouleur | null): boolean {
  const profil = profilDe(r);
  const nom = `${r.nom} ${r.tags.join(" ")} ${r.categorie}`.toLowerCase();
  switch (style) {
    case "bois-clair":
      if (profil !== "bois") return false;
      return analyse ? analyse.clarte >= 62 : /(light|white|blanc|pale|natural|nordic|birch|ash|maple|scandi|beige|crème|cream)/.test(nom);
    case "bois-fonce":
      if (profil !== "bois") return false;
      return analyse ? analyse.clarte < 45 : /(dark|walnut|wenge|ebony|smoked|foncé|ébène|noyer|fumé)/.test(nom);
    case "blanc":
      if (profil !== "uni-mat" && profil !== "uni-brillant" && profil !== "bois-peint") return false;
      return analyse ? analyse.clarte >= 86 && analyse.chroma < 8 : /(white|blanc|ivory|snow|milk)/.test(nom);
    case "uni-colore":
      if (profil !== "uni-mat" && profil !== "uni-brillant" && profil !== "uni-raye") return false;
      return analyse ? analyse.chroma >= 12 || (analyse.clarte < 86 && analyse.clarte > 20 && analyse.chroma >= 6) : !/(white|black|blanc|noir|grey|gray)/.test(nom);
    case "marbre":
      return profil === "marbre" || profil === "terrazzo";
    case "beton":
      return profil === "beton" || (profil === "pierre" && /(concrete|cement|stucco|slate|basalt)/.test(nom));
    default:
      return false;
  }
}
