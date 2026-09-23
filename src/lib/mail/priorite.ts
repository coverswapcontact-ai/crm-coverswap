/**
 * Priorité par valeur d'« À traiter » (mission 9), calculée par le CRM, jamais
 * par Claude : les réclamations en haut ; puis les devis en attente, par
 * montant ; puis les dossiers actifs ; puis les leads ; puis l'administratif
 * qui a une échéance ; puis le reste. Un mail remis à plus tard et revenu
 * passe en tête, marqué « Revenu ». Pur : testé tel quel.
 */

export const RANGS_PRIORITE = {
  REVENU: 0,
  RECLAMATION: 1,
  DEVIS_EN_ATTENTE: 2,
  DOSSIER_ACTIF: 3,
  LEAD: 4,
  ECHEANCE: 5,
  RESTE: 6,
} as const;
export type RangPriorite = (typeof RANGS_PRIORITE)[keyof typeof RANGS_PRIORITE];

export const LIBELLES_PRIORITE: Record<RangPriorite, string> = {
  0: "Revenu",
  1: "Réclamation",
  2: "Devis en attente",
  3: "Dossier en cours",
  4: "Lead",
  5: "Échéance",
  6: "",
};

export type Priorite = { rang: RangPriorite; libelle: string; montant: number | null };

export type FaitsPriorite = {
  /** Remis à plus tard, et la date de retour est passée. */
  revenu: boolean;
  /** Mots d'une réclamation dans l'objet, l'extrait ou « ce qui est attendu ». */
  reclamation: boolean;
  /** Montant du devis en attente (le plus haut) sur les dossiers du contact, si un dossier attend une signature. */
  devisEnAttente: number | null;
  /** Le contact a un dossier ouvert (ni perdu, ni encaissé, ni archivé). */
  dossierActif: boolean;
  /** Le contact est un lead (sans dossier) ou le mail est une nouvelle demande. */
  lead: boolean;
  /** Mail administratif avec une échéance extraite. */
  administratifEcheance: boolean;
};

const MOTS_RECLAMATION = /r[ée]clam|probl[èe]me|d[ée]faut|d[ée]coll|m[ée]content|garantie|litige|rembours|malfa[çc]on|pas satisf|insatisf|bulle|ab[iî]m|ray[ée]|se d[ée]tache|d[ée]chir|mise en demeure|inadmissible|inacceptable/i;

/** Une réclamation se lit dans les mots du mail (objet, extrait, ce que Claude a noté comme attendu). */
export function estReclamation(textes: (string | null | undefined)[]): boolean {
  return textes.some((t) => t && MOTS_RECLAMATION.test(t));
}

export function prioriteDe(faits: FaitsPriorite): Priorite {
  const rang: RangPriorite = faits.revenu
    ? RANGS_PRIORITE.REVENU
    : faits.reclamation
      ? RANGS_PRIORITE.RECLAMATION
      : faits.devisEnAttente !== null
        ? RANGS_PRIORITE.DEVIS_EN_ATTENTE
        : faits.dossierActif
          ? RANGS_PRIORITE.DOSSIER_ACTIF
          : faits.lead
            ? RANGS_PRIORITE.LEAD
            : faits.administratifEcheance
              ? RANGS_PRIORITE.ECHEANCE
              : RANGS_PRIORITE.RESTE;
  return { rang, libelle: LIBELLES_PRIORITE[rang], montant: rang === RANGS_PRIORITE.DEVIS_EN_ATTENTE ? faits.devisEnAttente : null };
}

/** Ordre d'« À traiter » : rang, puis montant du devis (haut d'abord), puis le plus récent. */
export function comparerPriorite(a: { priorite: Priorite; recuLe: string }, b: { priorite: Priorite; recuLe: string }): number {
  if (a.priorite.rang !== b.priorite.rang) return a.priorite.rang - b.priorite.rang;
  const montant = (b.priorite.montant ?? 0) - (a.priorite.montant ?? 0);
  if (montant !== 0) return montant;
  return b.recuLe.localeCompare(a.recuLe);
}

export type DateExtraite = { date: string; heure?: string | null; nature: "DISPONIBILITE" | "ECHEANCE"; passage: string };

export function lireDatesExtraites(json: string | null | undefined): DateExtraite[] {
  try {
    const lu: unknown = JSON.parse(json ?? "[]");
    if (!Array.isArray(lu)) return [];
    return lu.filter((d): d is DateExtraite => Boolean(d && typeof d === "object" && typeof (d as DateExtraite).date === "string" && typeof (d as DateExtraite).passage === "string" && ["DISPONIBILITE", "ECHEANCE"].includes((d as DateExtraite).nature)));
  } catch {
    return [];
  }
}
