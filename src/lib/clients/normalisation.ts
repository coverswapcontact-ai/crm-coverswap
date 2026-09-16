// Normalisation des coordonnées et lecture des anciennes notes d'acquisition.
// Fonctions pures, testées : c'est ici que se décide si deux saisies désignent
// la même personne.

import type { CategorieClient, SourceClient } from "./constantes";

export function normaliserEmail(saisie: string | null | undefined): string | null {
  const adresse = (saisie ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse) ? adresse : null;
}

/**
 * Numéro comparable : +33612345678 pour la France (06…, +33 6…, 0033 6…,
 * 6 12 34 56 78), +<indicatif><numéro> pour l'étranger. Rend null si la
 * saisie ne contient pas assez de chiffres pour identifier quelqu'un.
 */
export function normaliserTelephone(saisie: string | null | undefined): string | null {
  const brut = (saisie ?? "").trim();
  if (!brut) return null;
  let chiffres = brut.replace(/[^\d+]/g, "");
  if (chiffres.startsWith("00")) chiffres = `+${chiffres.slice(2)}`;

  if (chiffres.startsWith("+")) {
    let international = `+${chiffres.slice(1).replace(/\D/g, "")}`;
    // « +33 0 6 … » : le zéro national en trop
    if (international.startsWith("+330")) international = `+33${international.slice(4)}`;
    return international.length >= 9 ? international : null;
  }

  const seuls = chiffres.replace(/\D/g, "");
  if (seuls.length === 10 && seuls.startsWith("0")) return `+33${seuls.slice(1)}`;
  if (seuls.length === 9 && /^[1-9]/.test(seuls)) return `+33${seuls}`;
  if (seuls.length === 11 && seuls.startsWith("33")) return `+${seuls}`;
  return seuls.length >= 9 ? seuls : null;
}

/**
 * SIRET plausible : 14 chiffres dont la clé de Luhn est juste. Exception
 * connue : les établissements de La Poste (SIREN 356 000 000), dont la somme
 * des chiffres est un multiple de 5. Attrape la faute de frappe, pas le
 * SIRET inventé.
 */
export function siretValide(saisie: string | null | undefined): boolean {
  const siret = (saisie ?? "").replace(/\s/g, "");
  if (!/^\d{14}$/.test(siret)) return false;
  const chiffres = [...siret].map(Number);
  const luhn = chiffres.reduce((somme, chiffre, rang) => {
    const pondere = rang % 2 === 0 ? chiffre * 2 : chiffre;
    return somme + (pondere > 9 ? pondere - 9 : pondere);
  }, 0);
  if (luhn % 10 === 0) return true;
  return siret.startsWith("356000000") && chiffres.reduce((somme, chiffre) => somme + chiffre, 0) % 5 === 0;
}

/** Message sous un champ SIRET en cours de saisie ; null s'il est vide ou plausible. `complet` : la saisie est finie. */
export function erreurSaisieSiret(saisie: string, complet: boolean): string | null {
  const chiffres = saisie.replace(/\s/g, "");
  if (!chiffres) return null;
  if (!/^\d*$/.test(chiffres) || chiffres.length > 14) return "14 chiffres attendus.";
  if (chiffres.length < 14) return complet ? "14 chiffres attendus." : null;
  return siretValide(chiffres) ? null : "Un chiffre est faux (clé de contrôle).";
}

/** « 353 033 764 00021 » : SIREN en trois groupes, puis le numéro d'établissement. */
export function formaterSiret(siret: string): string {
  const chiffres = siret.replace(/\s/g, "");
  return /^\d{14}$/.test(chiffres) ? `${chiffres.slice(0, 3)} ${chiffres.slice(3, 6)} ${chiffres.slice(6, 9)} ${chiffres.slice(9)}` : siret;
}

/** « 06 12 34 56 78 » pour un numéro français normalisé ; sinon tel quel. */
export function formaterTelephone(numero: string): string {
  const francais = /^\+33(\d{9})$/.exec(numero);
  if (!francais) return numero;
  return `0${francais[1]}`.replace(/(\d{2})(?=\d)/g, "$1 ");
}

const MARQUEURS_SANS_NOM = new Set(["", "inconnu", "inconnue", "non renseigne", "non renseigné", "-"]);

function nomUtile(valeur: string | null | undefined): string | null {
  const nettoye = (valeur ?? "").trim().replace(/\s+/g, " ");
  return MARQUEURS_SANS_NOM.has(nettoye.toLowerCase()) ? null : nettoye;
}

/** Nom d'affichage : raison sociale, sinon « Prénom Nom » (sans répéter un nom saisi deux fois). */
export function nomAffichage(parties: {
  prenom?: string | null;
  nomFamille?: string | null;
  raisonSociale?: string | null;
}): string | null {
  const raisonSociale = nomUtile(parties.raisonSociale);
  if (raisonSociale) return raisonSociale;
  const prenom = nomUtile(parties.prenom);
  const nomFamille = nomUtile(parties.nomFamille);
  if (prenom && nomFamille) return prenom.toLowerCase() === nomFamille.toLowerCase() ? prenom : `${prenom} ${nomFamille}`;
  return prenom ?? nomFamille;
}

/** Nom comparable : minuscules, sans accents ni ponctuation, mots triés (« Durand Alice » = « alice durand »). */
export function cleNom(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function distanceEdition(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let precedente = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    for (let j = 1; j <= b.length; j++) {
      courante[j] = Math.min(
        precedente[j] + 1,
        courante[j - 1] + 1,
        precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    precedente = courante;
  }
  return precedente[b.length];
}

export type AcquisitionLue = {
  formulaire?: string;
  publicite?: string;
  campagne?: string;
  formulaireId?: string;
  pageId?: string;
  metaLeadgenId?: string;
  via?: string;
};

const CLES_NOTES: Record<string, keyof AcquisitionLue> = {
  formulaire: "formulaire",
  form: "formulaire",
  pub: "publicite",
  campagne: "campagne",
  formid: "formulaireId",
  pageid: "pageId",
  leadgenid: "metaLeadgenId",
  via: "via",
};

/**
 * Lit les données d'acquisition que les webhooks écrivaient dans `notes` :
 * « Formulaire: X | Pub: Y | Campagne: Z » (site, n8n) ou
 * « Form: X | FormID: … | PageID: … | LeadgenID: … » (Meta, Zapier).
 * Un morceau qui ne suit pas ce format est ignoré.
 */
export function lireNotesAcquisition(notes: string | null | undefined): AcquisitionLue {
  const lue: AcquisitionLue = {};
  for (const morceau of (notes ?? "").split("|")) {
    const separation = morceau.indexOf(":");
    if (separation <= 0) continue;
    const cle = CLES_NOTES[morceau.slice(0, separation).trim().toLowerCase().replace(/\s+/g, "")];
    const valeur = morceau.slice(separation + 1).trim();
    if (cle && valeur && !lue[cle]) lue[cle] = valeur.slice(0, 200);
  }
  return lue;
}

/** Source du client déduite de la source d'un ancien lead. */
export function sourceDepuisLead(source: string): { source: SourceClient; sourceDetail?: string } {
  switch (source) {
    case "META_ADS":
    case "SITE_SIMULATEUR":
    case "SITE_DEVIS":
    case "SITE_CONTACT":
      return { source };
    case "TIKTOK":
      return { source: "RESEAUX_SOCIAUX", sourceDetail: "TikTok" };
    case "INSTAGRAM":
      return { source: "RESEAUX_SOCIAUX", sourceDetail: "Instagram" };
    case "ORGANIQUE":
      return { source: "ORGANIQUE" };
    case "REFERENCE":
      return { source: "RECOMMANDATION" };
    case "AUTRE":
      return { source: "AUTRE" };
    default:
      return { source: "INCONNUE", sourceDetail: source ? `Ancienne source : ${source}` : undefined };
  }
}

/** Source du client déduite de la source d'un dossier ouvert sans lead. */
export function sourceDepuisDossier(source: string): { source: SourceClient; sourceDetail?: string } {
  switch (source) {
    case "PROSPECTION":
    case "RECOMMANDATION":
    case "SOUS_TRAITANCE":
    case "AUTRE":
      return { source };
    case "ENTRANT":
      return { source: "INCONNUE", sourceDetail: "Contact entrant (canal non précisé)" };
    default:
      return { source: "INCONNUE" };
  }
}

export function categorieDepuisLead(typeProjet: string): CategorieClient {
  return typeProjet === "PRO" ? "PROFESSIONNEL" : "PARTICULIER";
}

export function categorieDepuisDossier(source: string): CategorieClient {
  if (source === "SOUS_TRAITANCE") return "DONNEUR_ORDRE";
  if (source === "PROSPECTION") return "PROFESSIONNEL";
  return "PARTICULIER";
}
