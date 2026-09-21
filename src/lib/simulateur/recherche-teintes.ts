/**
 * Recherche dans le catalogue Cover Styl' en français : les noms du catalogue
 * sont en anglais (« Walnut Ash », « Raw Grey »), Lucas tape « noyer » ou
 * « béton gris ». Chaque mot tapé doit commencer un mot de la référence, du
 * nom, du résumé français (« bois · brun foncé · mat ») ou de sa traduction.
 * Sans accents, sans majuscules ; un début de mot suffit (« noy » → noyer),
 * mais « vert » ne trouve pas « travertine ».
 * Fichier pur, sans base : utilisé par l'écran (composant client).
 * (Le site a la même recherche pour son simulateur : src/lib/recherche-finitions.ts.)
 */

const SYNONYMES: Record<string, string[]> = {
  chene: ["oak"],
  noyer: ["walnut"],
  frene: ["ash"],
  pin: ["pine"],
  erable: ["maple"],
  cerisier: ["cherry"],
  hetre: ["beech"],
  bouleau: ["birch"],
  teck: ["teak"],
  ebene: ["ebony"],
  bambou: ["bamboo"],
  orme: ["elm"],
  olivier: ["olive"],
  marbre: ["marble", "statuary", "marquina", "calacatta", "carrara", "onyx"],
  pierre: ["stone", "slate", "granite", "travertine"],
  ardoise: ["slate"],
  granit: ["granite"],
  travertin: ["travertine"],
  beton: ["concrete", "cement"],
  ciment: ["cement", "concrete"],
  brique: ["brick"],
  blanc: ["white"],
  noir: ["black"],
  gris: ["grey", "gray"],
  creme: ["cream"],
  bleu: ["blue", "navy"],
  vert: ["green", "sage", "olive"],
  sauge: ["sage"],
  kaki: ["khaki", "olive"],
  anthracite: ["anthracite", "graphite", "charcoal"],
  ivoire: ["ivory"],
  rouge: ["red", "bordeaux"],
  jaune: ["yellow"],
  rose: ["pink"],
  marron: ["brown"],
  brun: ["brown"],
  dore: ["gold"],
  argent: ["silver"],
  cuivre: ["copper"],
  laiton: ["brass"],
  acier: ["steel"],
  inox: ["stainless", "steel"],
  rouille: ["rust", "corten"],
  brillant: ["gloss", "lacquer", "shiny"],
  laque: ["lacquer", "gloss"],
  cuir: ["leather"],
  lin: ["linen"],
  tissu: ["fabric", "textile"],
  paillettes: ["glitter", "disco"],
  clair: ["light", "pale"],
  fonce: ["dark"],
};

/** « mat » : presque tout le catalogue l'est — tout ce qui ne brille pas. */
const MOTS_MAT = new Set(["mat", "mate", "matte", "mats"]);
const BRILLANT = /gloss|lacquer|shiny|brillant|chrom|mirror|miroir|glitter|disco|paillet/;

export function sansAccents(texte: string): string {
  return texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Les formes à chercher pour un mot tapé : lui-même, et les traductions des mots français qu'il commence. */
function formes(mot: string): string[] {
  const liste = [mot];
  for (const [francais, anglais] of Object.entries(SYNONYMES)) {
    if (francais === mot || (mot.length >= 3 && francais.startsWith(mot))) liste.push(...anglais);
  }
  return liste;
}

export function correspondRecherche(r: { ref: string; nom: string; resume: string; famille?: string }, recherche: string): boolean {
  const mots = sansAccents(recherche).split(/[^a-z0-9]+/).filter(Boolean);
  if (mots.length === 0) return true;
  const texte = sansAccents(`${r.ref} ${r.nom} ${r.resume} ${r.famille ?? ""}`);
  const motsDuTexte = texte.split(/[^a-z0-9]+/).filter(Boolean);
  return mots.every((mot) => (MOTS_MAT.has(mot) ? !BRILLANT.test(texte) : formes(mot).some((forme) => motsDuTexte.some((m) => m.startsWith(forme)))));
}
