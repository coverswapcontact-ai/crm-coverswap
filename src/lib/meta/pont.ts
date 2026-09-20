import { normaliserLeadMeta, type ChampMeta } from "./champs";
import type { LeadGraph } from "./graph";

/**
 * Pont : un lead Meta livré à plat par un intermédiaire (Zapier), traduit dans
 * la même forme que celle rendue par l'API Graph.
 *
 * Le chemin direct (webhook natif) et le pont aboutissent ainsi au MÊME
 * traitement : mêmes champs, même déduplication, mêmes notifications, même
 * relance, même visibilité dans l'écran Publicité. Une seule chaîne à tenir.
 *
 * Tout ce que l'intermédiaire envoie et que l'on ne sait pas nommer est
 * conservé comme réponse de formulaire : rien n'est jeté.
 */

/** Clés que l'on sait lire, avec leurs variantes courantes. */
const CONNUES: Record<string, string> = {
  full_name: "full_name",
  fullname: "full_name",
  nom_complet: "full_name",
  first_name: "first_name",
  firstname: "first_name",
  prenom: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  nom: "last_name",
  phone_number: "phone_number",
  phone: "phone_number",
  telephone: "phone_number",
  tel: "phone_number",
  email: "email",
  mail: "email",
  courriel: "email",
  city: "city",
  ville: "city",
  post_code: "post_code",
  postcode: "post_code",
  zip_code: "post_code",
  code_postal: "post_code",
  cp: "post_code",
  street_address: "street_address",
  adresse: "street_address",
};

/** Clés de rattachement et d'attribution : elles ne sont pas des réponses du formulaire. */
const ATTRIBUTION = new Set([
  "leadgen_id",
  "lead_id",
  "form_id",
  "form_name",
  "page_id",
  "page_name",
  "created_time",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "adgroup_id",
  "platform",
  "is_organic",
  "secret",
  "id",
]);

const texte = (valeur: unknown): string | null => {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur === "boolean") return valeur ? "Oui" : "Non";
  if (Array.isArray(valeur)) return valeur.map((v) => texte(v)).filter(Boolean).join(", ") || null;
  const brut = String(valeur).trim();
  return brut && brut.toLowerCase() !== "null" && brut.toLowerCase() !== "undefined" ? brut : null;
};

export type LeadDuPont = LeadGraph & {
  /** Identifiant Meta du lead, quand l'intermédiaire le transmet. */
  leadgenId: string | null;
  pageId: string | null;
};

/**
 * Lit une charge plate et en fait un lead identique à celui de l'API Graph.
 * Aucune valeur n'est inventée : ce qui manque reste vide.
 */
export function leadDepuisChargePlate(corps: Record<string, unknown>): LeadDuPont {
  const champs: ChampMeta[] = [];
  const vu = new Set<string>();
  for (const [cleBrute, valeurBrute] of Object.entries(corps ?? {})) {
    const cle = cleBrute.trim().toLowerCase();
    if (ATTRIBUTION.has(cle)) continue;
    const valeur = texte(valeurBrute);
    if (!valeur) continue;
    const nom = CONNUES[cle] ?? cleBrute.trim();
    if (vu.has(nom)) continue;
    vu.add(nom);
    champs.push({ name: nom, values: [valeur] });
  }

  const soumis = texte(corps.created_time);
  let soumisLe = new Date();
  if (soumis) {
    // ISO 8601, ou un horodatage en secondes.
    const date = /^\d{9,11}$/.test(soumis) ? new Date(Number(soumis) * 1000) : new Date(soumis);
    if (!Number.isNaN(date.getTime())) soumisLe = date;
  }

  return {
    normalise: normaliserLeadMeta(champs),
    soumisLe,
    leadgenId: texte(corps.leadgen_id) ?? texte(corps.lead_id),
    pageId: texte(corps.page_id),
    formId: texte(corps.form_id),
    formNom: texte(corps.form_name),
    adId: texte(corps.ad_id) ?? texte(corps.adgroup_id),
    adNom: texte(corps.ad_name),
    adsetId: texte(corps.adset_id),
    adsetNom: texte(corps.adset_name),
    campagneId: texte(corps.campaign_id),
    campagneNom: texte(corps.campaign_name),
    plateforme: texte(corps.platform),
    organique: corps.is_organic === true || texte(corps.is_organic) === "true",
  };
}
