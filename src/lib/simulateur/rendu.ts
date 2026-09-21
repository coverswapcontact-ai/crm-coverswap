import { ZONES, type IdZone, type TypeSurface } from "./types-surface";

/**
 * Rendu d'un prompt de la bibliothèque : le modèle (texte de Lucas) + les
 * teintes choisies → le prompt à coller dans ChatGPT. Fonctions pures, sans
 * base ni réseau (testées telles quelles, utilisées aussi par l'aperçu de
 * l'éditeur).
 */

export type ZonePourPrompt = { zone: IdZone; etiquette: string; teinte: string };

const SECTION = /\[zone:([a-z0-9-]+)\]\s*\n?([\s\S]*?)\[\/zone\]\n?/g;
const VARIABLES_GLOBALES = ["nombre_echantillons", "format", "zones_inchangees"] as const;
const VARIABLES_SECTION = ["teinte", "etiquette"] as const;

/** Lettre de l'échantillon sur la planche : A, B, C… dans l'ordre des zones du type. */
export function etiquettes(type: TypeSurface, zones: IdZone[]): Map<IdZone, string> {
  const retenues = type.zones.filter((z) => zones.includes(z));
  return new Map(retenues.map((z, i) => [z, `${String.fromCharCode(65 + i)} · ${ZONES[z].libelle}`]));
}

function listeEnAnglais(elements: string[]): string {
  if (elements.length <= 1) return elements.join("");
  return `${elements.slice(0, -1).join(", ")} and ${elements[elements.length - 1]}`;
}

export function rendrePrompt(modele: string, entree: { type: TypeSurface; zones: ZonePourPrompt[]; format: string }): string {
  const parZone = new Map(entree.zones.map((z) => [z.zone, z]));
  const inchangees = entree.type.zones.filter((z) => !parZone.has(z));
  const texte = modele.replace(/\r\n/g, "\n").replace(SECTION, (_tout, zone: string, corps: string) => {
    const choisie = parZone.get(zone as IdZone);
    if (!choisie) return "";
    return `${corps.replace(/\{\{teinte\}\}/g, choisie.teinte).replace(/\{\{etiquette\}\}/g, choisie.etiquette).replace(/\s+$/, "")}\n`;
  });
  const variables: Record<(typeof VARIABLES_GLOBALES)[number], string> = {
    nombre_echantillons: String(entree.zones.length),
    format: entree.format,
    zones_inchangees: inchangees.length
      ? `• NOT COVERED: the ${listeEnAnglais(inchangees.map((z) => ZONES[z].anglais))}. ${inchangees.length > 1 ? "They keep their" : "It keeps its"} original material and colour exactly.`
      : "",
  };
  return texte
    .replace(/\{\{(\w+)\}\}/g, (tout, nom: string) => (nom in variables ? variables[nom as keyof typeof variables] : tout))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Le format de la photo dans les mots du prompt. */
export function formatDePhoto(largeur: number, hauteur: number): string {
  const ratio = largeur / hauteur;
  if (ratio > 1.15) return "landscape 3:2";
  if (ratio < 0.85) return "portrait 2:3";
  return "square 1:1";
}

/**
 * Contrôle d'un modèle avant de l'enregistrer : une section par zone du type,
 * {{teinte}} dans chacune, balises fermées, variables connues. Les erreurs
 * bloquent l'enregistrement ; les avertissements s'affichent seulement.
 */
export function verifierModele(modele: string, type: TypeSurface): { erreurs: string[]; avertissements: string[] } {
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  const texte = modele.replace(/\r\n/g, "\n");
  if (texte.trim().length < 200) erreurs.push("Le prompt est trop court pour verrouiller la scène (200 caractères au moins).");
  if (texte.length > 12_000) erreurs.push("Le prompt est trop long (12 000 caractères au plus).");
  const ouvertures = (texte.match(/\[zone:[a-z0-9-]+\]/g) ?? []).length;
  const fermetures = (texte.match(/\[\/zone\]/g) ?? []).length;
  if (ouvertures !== fermetures) erreurs.push(`Balises de zone déséquilibrées : ${ouvertures} [zone:…] pour ${fermetures} [/zone].`);
  const sections = new Map<string, string>();
  for (const [, zone, corps] of texte.matchAll(SECTION)) sections.set(zone, corps);
  for (const zone of type.zones) {
    const corps = sections.get(zone);
    if (corps === undefined) erreurs.push(`Il manque la section [zone:${zone}] (${ZONES[zone].libelle}).`);
    else if (!corps.includes("{{teinte}}")) erreurs.push(`La section ${ZONES[zone].libelle} doit contenir {{teinte}} : sans elle, la teinte choisie n'apparaît pas dans le prompt.`);
    else if (!corps.includes("{{etiquette}}")) avertissements.push(`La section ${ZONES[zone].libelle} ne cite pas {{etiquette}} : ChatGPT ne saura pas quel échantillon de la planche lui correspond.`);
  }
  for (const zone of sections.keys()) {
    if (!type.zones.includes(zone as IdZone)) avertissements.push(`La section [zone:${zone}] n'est pas une zone du type « ${type.libelle} » : elle ne sera jamais utilisée.`);
  }
  const horsSection = texte.replace(SECTION, "");
  for (const [, nom] of horsSection.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!(VARIABLES_GLOBALES as readonly string[]).includes(nom)) {
      ((VARIABLES_SECTION as readonly string[]).includes(nom) ? erreurs : avertissements).push(
        (VARIABLES_SECTION as readonly string[]).includes(nom) ? `{{${nom}}} ne s'emploie que dans une section de zone.` : `Variable inconnue : {{${nom}}} (restera telle quelle dans le prompt).`
      );
    }
  }
  if (!/image 1/i.test(texte) || !/image 2/i.test(texte)) avertissements.push("Le prompt ne désigne pas « Image 1 » (la photo) et « Image 2 » (la planche) : ChatGPT risque de les confondre.");
  return { erreurs: [...new Set(erreurs)], avertissements: [...new Set(avertissements)] };
}
