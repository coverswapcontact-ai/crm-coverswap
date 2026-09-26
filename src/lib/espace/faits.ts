import { montantsDocument, versCentimes } from "@/lib/dossiers/montants";
import { lireLignes } from "@/lib/dossiers/stockage";
import type { FaitsEspace } from "./etapes";

/**
 * LA lecture unique de ce qui est vrai pour un espace client : le devis en
 * vigueur et ses montants (devis repris compris), l'accord (donné dans
 * l'espace, ou constaté dans le CRM pour un devis signé sur papier), les
 * paiements réellement encaissés. L'espace du client, l'onglet Espaces
 * clients, le bloc « Espace client » du dossier et le contrôle de cohérence
 * lisent tous ICI : deux écrans ne peuvent plus dire deux choses différentes.
 *
 * Fonctions pures (aucune base) : testées telles quelles.
 */

export type DevisLu = {
  id: string;
  numero: string | null;
  objet: string;
  lignes: string;
  totalHt: number;
  acomptePct: number | null;
  statut: string;
  origine: string;
  dateEmission: Date | null;
  createdAt: Date;
  pdfPath: string | null;
  /** Mission 11 : libellé de variante et visibilité dans l'espace (absents sur d'anciens lecteurs). */
  libelleVariante?: string | null;
  visibleEspace?: boolean;
  /** Mission 13 (lot 5, B6) : lectures dans l'espace client, comptées par devis. */
  consultations?: number;
  consulteLe?: Date | null;
};

export type AccordLu = { id: string; documentId: string; createdAt: Date; nomSignataire: string; signature: string | null; retireLe: Date | null };
export type EncaissementLu = { montant: number; moyen: string | null; recuLe: Date; statut: string };

export const STATUTS_DEVIS_EN_VIGUEUR = ["GENERE", "ENVOYE", "ACCEPTE"] as const;

/** Le devis que voit le client : le devis accepté s'il y en a un, sinon le dernier émis encore en vigueur. */
export function devisEnVigueur<T extends Pick<DevisLu, "statut" | "createdAt" | "numero">>(devis: T[]): T | null {
  const vivants = devis.filter((d) => d.numero && (STATUTS_DEVIS_EN_VIGUEUR as readonly string[]).includes(d.statut)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return vivants.find((d) => d.statut === "ACCEPTE") ?? vivants[0] ?? null;
}

/**
 * Mission 11 : tous les devis proposés au client (en vigueur), du plus ancien au plus récent — il n'en signera qu'un.
 * `avecNonRetenus` : aussi ceux qu'il n'a pas retenus (pour Lucas : l'historique ; jamais pour le client).
 */
export function devisProposes<T extends Pick<DevisLu, "statut" | "createdAt" | "numero">>(devis: T[], options: { avecNonRetenus?: boolean } = {}): T[] {
  const statuts: readonly string[] = options.avecNonRetenus ? [...STATUTS_DEVIS_EN_VIGUEUR, "NON_RETENU"] : STATUTS_DEVIS_EN_VIGUEUR;
  return devis.filter((d) => d.numero && statuts.includes(d.statut)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export type AccordEffectif = {
  le: Date;
  nom: string;
  /** ESPACE : bon pour accord donné par le client dans son espace. CRM : devis noté « accepté » par Lucas (signé sur papier, repris). */
  source: "ESPACE" | "CRM";
  accordId: string | null;
  signature: boolean;
};

/**
 * L'accord qui vaut aujourd'hui sur ce devis. Un accord retiré ne vaut plus.
 * Un devis « accepté » sans accord en ligne (dossier repris, signature papier)
 * est signé lui aussi : `signeLe` est la date du passage en « Signé ».
 */
export function accordEffectif(devis: Pick<DevisLu, "id" | "statut"> | null, accords: AccordLu[], repli: { nom: string; signeLe: Date | null }): AccordEffectif | null {
  if (!devis) return null;
  const enLigne = accords.filter((a) => a.documentId === devis.id && !a.retireLe).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (enLigne) return { le: enLigne.createdAt, nom: enLigne.nomSignataire, source: "ESPACE", accordId: enLigne.id, signature: Boolean(enLigne.signature) };
  if (devis.statut === "ACCEPTE" && repli.signeLe) return { le: repli.signeLe, nom: repli.nom, source: "CRM", accordId: null, signature: false };
  return null;
}

export type LignePaiement = {
  montant: number;
  /** PAYE : entièrement reçu ; PARTIEL : une partie ; A_REGLER : rien encore. */
  statut: "PAYE" | "PARTIEL" | "A_REGLER";
  recu: number;
  /** Date et moyen du paiement qui a fini de régler cette ligne. */
  payeLe: string | null;
  moyen: string | null;
};

export type PaiementEspace = {
  total: number;
  recu: number;
  reste: number;
  acompte: (LignePaiement & { pct: number | null }) | null;
  solde: LignePaiement;
  encaissements: { montant: number; le: string; moyen: string | null }[];
  /** Tout est encaissé : « Réglé, merci ». */
  regle: boolean;
};

const euros = (centimes: number) => Math.round(centimes) / 100;

/**
 * Ce que le client doit et ce qu'il a payé, à partir des encaissements VALIDES
 * du dossier (un chèque rejeté ou un paiement annulé ne compte plus : la ligne
 * redevient « à régler »). Les paiements règlent l'acompte d'abord, puis le solde.
 */
export function paiementEspace(montants: { totalTtcCentimes: number; acompteCentimes: number }, acomptePct: number | null, encaissements: EncaissementLu[]): PaiementEspace {
  const valides = encaissements.filter((e) => e.statut === "VALIDE").sort((a, b) => a.recuLe.getTime() - b.recuLe.getTime());
  const total = montants.totalTtcCentimes;
  const acompte = montants.acompteCentimes;
  const recu = valides.reduce((s, e) => s + versCentimes(e.montant), 0);
  // À quel paiement chaque seuil (acompte, total) a-t-il été atteint ?
  const atteint = (seuil: number): EncaissementLu | null => {
    let cumul = 0;
    for (const e of valides) {
      cumul += versCentimes(e.montant);
      if (cumul >= seuil - 50) return e;
    }
    return null;
  };
  const ligne = (du: number, recuPourCetteLigne: number, seuil: number): LignePaiement => {
    const paye = du > 0 && recuPourCetteLigne >= du - 50;
    const fin = paye ? atteint(seuil) : null;
    return { montant: euros(du), statut: paye ? "PAYE" : recuPourCetteLigne > 0 ? "PARTIEL" : "A_REGLER", recu: euros(Math.min(du, Math.max(0, recuPourCetteLigne))), payeLe: fin?.recuLe.toISOString() ?? null, moyen: fin?.moyen ?? null };
  };
  const soldeDu = total - acompte;
  return {
    total: euros(total),
    recu: euros(recu),
    reste: euros(Math.max(0, total - recu)),
    acompte: acompte > 0 ? { ...ligne(acompte, recu, acompte), pct: acomptePct } : null,
    solde: ligne(soldeDu, recu - acompte, total),
    encaissements: valides.map((e) => ({ montant: e.montant, le: e.recuLe.toISOString(), moyen: e.moyen })),
    regle: total > 0 && recu >= total - 50,
  };
}

export type LectureDevis = {
  devis: DevisLu | null;
  /** Mission 11 : tous les devis proposés (en vigueur), du plus ancien au plus récent. */
  proposes: DevisLu[];
  montants: ReturnType<typeof montantsDocument> | null;
  accord: AccordEffectif | null;
  paiement: PaiementEspace | null;
  acompteRecu: boolean;
};

/** Devis en vigueur, accord et paiements d'un dossier, d'un seul geste. */
export function lireDevisEtPaiements(entree: { devis: DevisLu[]; accords: AccordLu[]; encaissements: EncaissementLu[]; clientNom: string; signeLe: Date | null }): LectureDevis {
  const devis = devisEnVigueur(entree.devis);
  const proposes = devisProposes(entree.devis);
  if (!devis) return { devis: null, proposes, montants: null, accord: null, paiement: null, acompteRecu: false };
  const montants = montantsDocument({ lignes: lireLignes(devis.lignes), totalHt: devis.totalHt, acomptePct: devis.acomptePct });
  const accord = accordEffectif(devis, entree.accords, { nom: entree.clientNom, signeLe: entree.signeLe ?? devis.dateEmission ?? devis.createdAt });
  const paiement = paiementEspace(montants, devis.acomptePct, entree.encaissements);
  return { devis, proposes, montants, accord, paiement, acompteRecu: Boolean(accord && (!paiement.acompte || paiement.acompte.statut === "PAYE")) };
}

/** Date du passage en « Signé » lue dans les changements d'étape (date réelle si elle a été saisie). */
export function dateSignature(evenements: { metadata: string; createdAt: Date; survenuLe: Date | null }[]): Date | null {
  const passages = evenements
    .filter((e) => {
      try {
        return (JSON.parse(e.metadata || "{}") as { vers?: string }).vers === "SIGNE";
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const dernier = passages[0];
  return dernier ? (dernier.survenuLe ?? dernier.createdAt) : null;
}

/* ── Quota des simulations ─────────────────────────────────────────── */

export const SIMULATIONS_OFFERTES_PAR_DEFAUT = 5;

/**
 * Ce qu'il reste au client : les simulations offertes (paramètre, 5 par défaut)
 * et celles accordées en plus, moins celles qu'il a faites — sur le site comme
 * dans son espace — et celles en cours.
 */
export function restantes(q: { gratuites: number; accordees: number; faitesEspace: number; faitesSite: number; enCours: number }): number {
  return Math.max(0, q.gratuites + q.accordees - q.faitesEspace - q.faitesSite - q.enCours);
}

/* ── Les faits, pour la règle d'étape ──────────────────────────────── */

export function composerFaits(entree: {
  photos: number;
  projetPrecise: boolean;
  projetValide: boolean;
  simulationsCrm: number;
  simulationsSite: number;
  simulationsClient: number;
  choix: boolean;
  lecture: LectureDevis;
  etapeDossier: string;
}): FaitsEspace {
  return {
    photos: entree.photos,
    projet: entree.projetPrecise,
    projetValide: entree.projetValide,
    simulationsCrm: entree.simulationsCrm,
    simulationsSite: entree.simulationsSite,
    simulationsClient: entree.simulationsClient,
    choix: entree.choix,
    devis: Boolean(entree.lecture.devis),
    accord: Boolean(entree.lecture.accord),
    acompteRecu: entree.lecture.acompteRecu,
    solde: Boolean(entree.lecture.paiement?.regle),
    etapeDossier: entree.etapeDossier,
  };
}
