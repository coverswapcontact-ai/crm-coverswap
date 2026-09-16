import { ErreurMetier } from "@/lib/commun/erreurs";
import type { EntrepriseAnnuaire } from "./types";

/**
 * Annuaire des entreprises de l'État (recherche-entreprises.api.gouv.fr,
 * données Insee et registre national des entreprises) : API publique,
 * gratuite, sans clé ni compte. Sert à remplir la fiche d'un client pro
 * (raison sociale, SIRET, adresse) ; rien n'est enregistré tant que la fiche
 * n'est pas créée. Seul le texte cherché part vers l'annuaire.
 */

const URL_ANNUAIRE = "https://recherche-entreprises.api.gouv.fr/search";
const NON_DIFFUSIBLE = "[NON-DIFFUSIBLE]";
const DELAI_MS = 6000;
const MAX_RESULTATS = 8;
const ETABLISSEMENTS_PAR_ENTREPRISE = 3;

type Transport = (url: string) => Promise<Response>;
const CLE_TRANSPORT = "__coverswapTransportAnnuaireEssai";
const globalEssai = globalThis as unknown as Record<string, Transport | undefined>;

/** Essais seulement : remplace les appels réseau vers l'annuaire. */
export function definirTransportAnnuaireEssai(transport: Transport | null): void {
  globalEssai[CLE_TRANSPORT] = transport ?? undefined;
}

type Brut = Record<string, unknown>;

function objet(valeur: unknown): Brut | null {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur) ? (valeur as Brut) : null;
}

/** Texte utile ; les champs que l'entreprise a rendus non diffusibles valent null. */
function texte(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const nettoye = valeur.replace(/\s+/g, " ").trim();
  return nettoye && !nettoye.includes(NON_DIFFUSIBLE) ? nettoye : null;
}

/** « 265 AVENUE DES ETATS DU LANGUEDOC 34000 MONTPELLIER » : la voie, sans code postal ni commune. */
function voie(adresse: string | null, codePostal: string | null): string | null {
  if (!adresse || !codePostal) return adresse;
  if (adresse.startsWith(`${codePostal} `) || adresse === codePostal) return null;
  const position = adresse.lastIndexOf(` ${codePostal}`);
  return position > 0 ? adresse.slice(0, position).trim() : adresse;
}

function enseigne(etablissement: Brut): string | null {
  const enseignes = Array.isArray(etablissement.liste_enseignes) ? etablissement.liste_enseignes.map(texte) : [];
  return texte(etablissement.nom_commercial) ?? enseignes.find((nom): nom is string => nom !== null) ?? null;
}

/**
 * Établissements d'une réponse de l'annuaire : pour chaque entreprise, ceux
 * qui correspondent à la recherche (une enseigne, une ville), à défaut son
 * siège. Ouverts d'abord, dans l'ordre de pertinence de l'annuaire.
 */
export function lireReponseAnnuaire(reponse: unknown): EntrepriseAnnuaire[] {
  const resultats = objet(reponse)?.results;
  if (!Array.isArray(resultats)) return [];
  const lus: EntrepriseAnnuaire[] = [];
  const vus = new Set<string>();
  for (const brut of resultats) {
    const entreprise = objet(brut);
    const siren = texte(entreprise?.siren);
    if (!entreprise || !siren || !/^\d{9}$/.test(siren)) continue;
    const raisonSociale = texte(entreprise.nom_raison_sociale) ?? texte(entreprise.nom_complet);
    const correspondants = Array.isArray(entreprise.matching_etablissements)
      ? entreprise.matching_etablissements.map(objet).filter((etablissement): etablissement is Brut => etablissement !== null)
      : [];
    const siege = objet(entreprise.siege);
    const etablissements = correspondants.length > 0 ? correspondants.slice(0, ETABLISSEMENTS_PAR_ENTREPRISE) : siege ? [siege] : [];
    for (const etablissement of etablissements) {
      const siretLu = texte(etablissement.siret);
      const siret = siretLu && /^\d{14}$/.test(siretLu) ? siretLu : null;
      if (vus.has(siret ?? siren)) continue;
      vus.add(siret ?? siren);
      const codePostalLu = texte(etablissement.code_postal);
      const nomCommercial = enseigne(etablissement);
      lus.push({
        siren,
        siret,
        raisonSociale,
        enseigne: nomCommercial && nomCommercial !== raisonSociale ? nomCommercial : null,
        adresse: voie(texte(etablissement.adresse), codePostalLu),
        codePostal: codePostalLu && /^\d{5}$/.test(codePostalLu) ? codePostalLu : null,
        ville: texte(etablissement.libelle_commune) ?? texte(etablissement.libelle_commune_etranger),
        siege: etablissement.est_siege === true,
        ferme: entreprise.etat_administratif === "C" || etablissement.etat_administratif === "F",
      });
    }
  }
  return lus.sort((a, b) => Number(a.ferme) - Number(b.ferme)).slice(0, MAX_RESULTATS);
}

/** Ce qui part vers l'annuaire : un SIREN ou un SIRET sans espaces, sinon au moins trois caractères. */
export function termeAnnuaire(saisie: string): string | null {
  const nettoye = saisie.replace(/\s+/g, " ").trim().slice(0, 120);
  const chiffres = nettoye.replace(/[\s.]/g, "");
  if (/^(\d{9}|\d{14})$/.test(chiffres)) return chiffres;
  return nettoye.length >= 3 ? nettoye : null;
}

export async function rechercherEntreprises(saisie: string): Promise<EntrepriseAnnuaire[]> {
  const terme = termeAnnuaire(saisie);
  if (!terme) return [];
  const parametres = new URLSearchParams({
    q: terme,
    page: "1",
    per_page: "5",
    minimal: "true",
    include: "siege,matching_etablissements",
    limite_matching_etablissements: String(ETABLISSEMENTS_PAR_ENTREPRISE),
  });
  const transport: Transport =
    globalEssai[CLE_TRANSPORT] ??
    ((url) => fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(DELAI_MS) }));

  let reponse: Response;
  try {
    reponse = await transport(`${URL_ANNUAIRE}?${parametres}`);
  } catch {
    throw new ErreurMetier("Annuaire des entreprises injoignable : remplis la fiche à la main.", 503);
  }
  if (reponse.status === 429) throw new ErreurMetier("Annuaire des entreprises saturé : réessaie dans quelques secondes.", 503);
  if (!reponse.ok) throw new ErreurMetier(`Annuaire des entreprises indisponible (erreur ${reponse.status}) : remplis la fiche à la main.`, 502);
  try {
    return lireReponseAnnuaire(await reponse.json());
  } catch {
    throw new ErreurMetier("Réponse de l'annuaire illisible : remplis la fiche à la main.", 502);
  }
}
