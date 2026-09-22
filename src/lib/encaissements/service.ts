import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { dateDepuisJour, formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatCentimes, versCentimes } from "@/lib/dossiers/montants";
import { estEtape } from "@/lib/dossiers/regles";
import {
  appliquerChangementEtape,
  changerEtapeDansTransaction,
  effetsDuChangementEtape,
  type ChangementEtape,
  type EntreeChangementEtape,
} from "@/lib/dossiers/transitions";
import { LIBELLES_MOYEN, MOTIFS_ANNULATION, MOTIFS_REJET, libelleMotif, type MoyenPaiement } from "./constantes";
import type { CorrectionEncaissement, EntreePaiement } from "./schemas";
import { faitsPaiements, piecesDuDossier } from "./soldes";

/**
 * Encaissements : l'argent reçu, distinct de ce qui est facturé.
 *
 * - Un encaissement ne se modifie ni ne se supprime (la base le refuse) : une
 *   erreur de saisie s'annule avec son motif, un chèque impayé se rejette ;
 *   dans les deux cas ses affectations cessent de compter.
 * - Il est imputé sur des pièces du registre : un devis (acompte), une
 *   facture. À la génération de la facture, les acomptes du dossier lui sont
 *   imputés ; un avoir libère ce qui réglait la facture annulée.
 * - L'étape suit les faits : « Facturé » entièrement réglé passe à
 *   « Encaissé » ; « Encaissé » qui ne l'est plus (chèque rejeté, paiement
 *   annulé) revient à « Facturé ». Un dossier mis à « Encaissé » à la main
 *   sans que ses factures soient réglées n'est pas ramené en arrière : c'est
 *   signalé sur le dossier.
 */

type Imputation = { registreId: string; centimes: number };

export type EnregistrementPaiement = {
  paiement: EntreePaiement;
  dossierId?: string | null;
  /** Pièce choisie ; à défaut, imputation automatique sur les pièces du dossier. */
  numeroDocumentId?: string | null;
  payeur?: string | null;
  clientId?: string | null;
  origine?: "SAISIE" | "REPRISE_ANCIEN_ECRAN";
  cleReprise?: string;
};

const libelleMoyen = (moyen: string | null) => (moyen ? LIBELLES_MOYEN[moyen as MoyenPaiement].toLowerCase() : "moyen non renseigné");

function descriptionPaiement(paiement: { montant: number; moyen: string | null; reference: string | null; recuLe: Date }): string {
  const reference = paiement.reference ? ` n° ${paiement.reference}` : "";
  return `${formatCentimes(versCentimes(paiement.montant))} par ${libelleMoyen(paiement.moyen)}${reference}, reçu le ${formatDateCourte(paiement.recuLe)}`;
}

/** Imputation sur les pièces du dossier : factures actives non réglées, à défaut le devis en vigueur (acompte). */
async function imputationAutomatique(tx: Transaction, dossierId: string, centimes: number): Promise<Imputation[]> {
  const pieces = await piecesDuDossier(tx, dossierId);
  const factures = pieces.filter((piece) => piece.type === "FACTURE" && piece.active);
  const imputations: Imputation[] = [];
  let reste = centimes;
  for (const facture of factures) {
    const part = Math.min(reste, facture.resteCentimes ?? 0);
    if (part <= 0) continue;
    imputations.push({ registreId: facture.registreId, centimes: part });
    reste -= part;
  }
  if (factures.length === 0 && reste > 0) {
    const devis = pieces.filter((piece) => piece.type === "DEVIS" && piece.active);
    const cible = devis.find((piece) => piece.statutDocument === "ACCEPTE") ?? devis.at(-1);
    const capacite = cible ? Math.max(0, (cible.totalCentimes ?? 0) - cible.regleCentimes) : 0;
    const part = Math.min(reste, capacite);
    if (cible && part > 0) imputations.push({ registreId: cible.registreId, centimes: part });
  }
  return imputations;
}

/** Imputation sur une pièce choisie ; rend aussi le dossier de la pièce, s'il y en a un. */
async function imputationChoisie(
  tx: Transaction,
  registreId: string,
  centimes: number,
  dossierId: string | null
): Promise<{ imputations: Imputation[]; dossierId: string | null }> {
  const ligne = await tx.numeroDocument.findUnique({
    where: { id: registreId },
    include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
  });
  if (!ligne) throw new ErreurMetier("Pièce introuvable au registre des numéros.", 404);
  if (ligne.type !== "DEVIS" && ligne.type !== "FACTURE") {
    throw new ErreurMetier("Un paiement règle un devis (acompte) ou une facture.", 400);
  }
  const document = ligne.documentId
    ? await tx.document.findUnique({ where: { id: ligne.documentId }, select: { dossierId: true, statut: true, totalHt: true } })
    : null;
  if (dossierId && document?.dossierId !== dossierId) throw new ErreurMetier("Cette pièce n'appartient pas à ce dossier.", 400);
  if (document?.statut === "ANNULEE") {
    throw new ErreurMetier(`La facture ${ligne.numero} est annulée par un avoir : le paiement se rattache à la nouvelle facture.`, 409);
  }
  if (document?.statut === "REMPLACE") {
    throw new ErreurMetier(`Le devis ${ligne.numero} a été remplacé : rattacher l'acompte au devis en vigueur.`, 409);
  }
  const total = document ? versCentimes(document.totalHt) : ligne.montant !== null ? versCentimes(ligne.montant) : null;
  const regle = ligne.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
  // Au-delà de ce qui reste sur la pièce, le surplus est gardé non imputé (et signalé), pas refusé.
  const part = total === null ? centimes : Math.min(centimes, Math.max(0, total - regle));
  return { imputations: part > 0 ? [{ registreId, centimes: part }] : [], dossierId: document?.dossierId ?? dossierId };
}

/** Enregistre un encaissement et ses imputations, dans la transaction de l'appelant (sans effet sur l'étape). */
export async function enregistrerEncaissementDansTransaction(tx: Transaction, entree: EnregistrementPaiement) {
  const { paiement } = entree;
  const centimes = versCentimes(paiement.montant);
  let dossierId = entree.dossierId ?? null;
  let imputations: Imputation[];
  if (entree.numeroDocumentId) {
    const choisie = await imputationChoisie(tx, entree.numeroDocumentId, centimes, dossierId);
    imputations = choisie.imputations;
    dossierId = choisie.dossierId;
  } else if (dossierId) {
    imputations = await imputationAutomatique(tx, dossierId, centimes);
  } else {
    throw new ErreurMetier("Indique le dossier ou la facture que ce paiement règle.", 400);
  }

  const dossier = dossierId
    ? await tx.dossier.findUnique({ where: { id: dossierId }, select: { clientNom: true, clientId: true } })
    : null;
  if (dossierId && !dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  const pieces = await tx.numeroDocument.findMany({
    where: { id: { in: imputations.map((imputation) => imputation.registreId) } },
    select: { id: true, numero: true, type: true, destinataire: true },
  });
  const payeur = entree.payeur?.trim() || dossier?.clientNom || pieces.find((piece) => piece.destinataire)?.destinataire;
  if (!payeur) throw new ErreurMetier("Indique le nom du payeur.", 400);

  const encaissement = await tx.encaissement.create({
    data: {
      dossierId,
      clientId: entree.clientId ?? dossier?.clientId ?? null,
      payeur,
      montant: centimes / 100,
      moyen: paiement.moyen,
      reference: paiement.reference || null,
      recuLe: dateDepuisJour(paiement.recuLe),
      crediteLe: paiement.moyen === "CHEQUE" && paiement.crediteLe ? dateDepuisJour(paiement.crediteLe) : null,
      note: paiement.note || null,
      origine: entree.origine ?? "SAISIE",
      cleReprise: entree.cleReprise ?? null,
      affectations: {
        create: imputations.map((imputation) => ({ numeroDocumentId: imputation.registreId, montant: imputation.centimes / 100 })),
      },
    },
  });

  if (dossierId) {
    const surQuoi = imputations
      .map((imputation) => {
        const piece = pieces.find((candidate) => candidate.id === imputation.registreId);
        const libelle = piece?.type === "DEVIS" ? `acompte sur le devis ${piece.numero}` : `facture ${piece?.numero}`;
        return imputations.length > 1 ? `${libelle} (${formatCentimes(imputation.centimes)})` : libelle;
      })
      .join(", ");
    const imputeCentimes = imputations.reduce((somme, imputation) => somme + imputation.centimes, 0);
    await tx.dossierEvenement.create({
      data: {
        dossierId,
        type: "ENCAISSEMENT_ENREGISTRE",
        direction: "ENTRANT",
        contenu: `Paiement de ${descriptionPaiement(encaissement)}${surQuoi ? ` : ${surQuoi}` : ""}${
          imputeCentimes < centimes ? ` ; ${formatCentimes(centimes - imputeCentimes)} non imputés` : ""
        }`,
        metadata: JSON.stringify({ encaissementId: encaissement.id, montant: encaissement.montant, imputations }),
      },
    });
  }
  return { encaissement, dossierId, imputations };
}

/**
 * L'étape suit l'argent : « Facturé » entièrement réglé passe à « Encaissé » ;
 * « Encaissé » qui était réglé et ne l'est plus revient à « Facturé ».
 * `etaitSolde` : l'état d'avant l'écriture ; sans lui, l'étape ne recule pas
 * (un dossier déclaré « Encaissé » à la main garde son étape, l'écart est signalé).
 */
export async function suivreSoldeDossier(
  tx: Transaction,
  dossierId: string,
  raison: string,
  etaitSolde?: boolean
): Promise<ChangementEtape | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier || !estEtape(dossier.etape)) return null;
  const { soldeEncaisse, pieces } = await faitsPaiements(tx, dossierId);
  const factures = pieces.filter((piece) => piece.type === "FACTURE" && piece.active);
  if (dossier.etape === "FACTURE" && soldeEncaisse) {
    return appliquerChangementEtape(tx, { dossierId, de: "FACTURE", vers: "ENCAISSE", nature: "AUTOMATIQUE", raison });
  }
  if (dossier.etape === "ENCAISSE" && etaitSolde === true && factures.length > 0 && !soldeEncaisse) {
    return appliquerChangementEtape(tx, { dossierId, de: "ENCAISSE", vers: "FACTURE", nature: "RETOUR", raison });
  }
  return null;
}

export const RAISON_ACOMPTE_ENCAISSE = "acompte encaissé";

/**
 * L'étape suit l'argent, côté acompte (22/09/2026). Un paiement reçu sur un
 * dossier dont le devis attend encore (« Devis envoyé », « Relance ») vaut
 * accord : le dossier passe « Signé », le devis « accepté » — et l'espace du
 * client le dit aussitôt (il lit les mêmes faits). À l'inverse, si ce paiement
 * est annulé ou rejeté, qu'il n'en reste aucun et qu'aucun bon pour accord
 * n'existe, le dossier revient à « Devis envoyé » : il n'avait avancé que pour ça.
 */
export async function suivreAcompteDossier(tx: Transaction, dossierId: string, sens: "AVANCE" | "RECUL"): Promise<ChangementEtape | null> {
  const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier || !estEtape(dossier.etape)) return null;
  const valides = await tx.encaissement.count({ where: { dossierId, statut: "VALIDE" } });
  if (sens === "AVANCE") {
    if (!["DEVIS_ENVOYE", "RELANCE"].includes(dossier.etape) || valides === 0) return null;
    const devis = await tx.document.findFirst({ where: { dossierId, type: "DEVIS", numero: { not: null }, statut: { in: ["GENERE", "ENVOYE", "ACCEPTE"] } }, orderBy: { createdAt: "desc" }, select: { id: true, statut: true } });
    if (!devis) return null;
    if (devis.statut !== "ACCEPTE") await tx.document.update({ where: { id: devis.id }, data: { statut: "ACCEPTE" } });
    return appliquerChangementEtape(tx, { dossierId, de: dossier.etape, vers: "SIGNE", nature: "AUTOMATIQUE", raison: RAISON_ACOMPTE_ENCAISSE, documentId: devis.id });
  }
  if (dossier.etape !== "SIGNE" || valides > 0) return null;
  if ((await tx.accordDevis.count({ where: { dossierId, retireLe: null } })) > 0) return null;
  const dernier = await tx.dossierEvenement.findFirst({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } });
  let raison: string | undefined;
  try {
    raison = (JSON.parse(dernier?.metadata || "{}") as { raison?: string }).raison;
  } catch {
    raison = undefined;
  }
  if (raison !== RAISON_ACOMPTE_ENCAISSE) return null;
  return appliquerChangementEtape(tx, { dossierId, de: "SIGNE", vers: "DEVIS_ENVOYE", nature: "RETOUR", raison: "acompte annulé ou rejeté, plus aucun paiement" });
}

/** Paiement saisi : imputé, tracé sur le dossier, étape suivie. */
export async function enregistrerEncaissement(entree: EnregistrementPaiement) {
  const { resultat, changement } = await prisma.$transaction(async (tx) => {
    const resultat = await enregistrerEncaissementDansTransaction(tx, entree);
    const changement = resultat.dossierId ? ((await suivreSoldeDossier(tx, resultat.dossierId, "factures réglées")) ?? (await suivreAcompteDossier(tx, resultat.dossierId, "AVANCE"))) : null;
    return { resultat, changement };
  });
  if (changement) await effetsDuChangementEtape(changement);
  // Mission 7 : « paiement bien reçu », par mail, automatiquement (une fois par paiement).
  if (resultat.dossierId) await (await import("@/lib/mail/notifications")).notifierPaiementsRecents(resultat.dossierId);
  return resultat;
}

async function encaissementValide(id: string) {
  const encaissement = await prisma.encaissement.findUnique({ where: { id } });
  if (!encaissement) throw new ErreurMetier("Encaissement introuvable.", 404);
  if (encaissement.statut === "ANNULE") throw new ErreurMetier("Cet encaissement est déjà annulé.", 409);
  if (encaissement.statut === "REJETE") throw new ErreurMetier("Ce chèque est déjà rejeté.", 409);
  return encaissement;
}

function jourPasse(jour: string, recuLe: Date, quoi: string): Date {
  if (jour > jourParis(new Date())) throw new ErreurMetier(`La date ${quoi} est à venir.`, 400);
  if (jour < jourParis(recuLe)) throw new ErreurMetier(`La date ${quoi} précède la réception (${formatDateCourte(recuLe)}).`, 400);
  return dateDepuisJour(jour);
}

/** Chèque crédité sur le compte (date lue sur le relevé). */
export async function crediterCheque(id: string, entree: { crediteLe: string }): Promise<string | null> {
  const encaissement = await encaissementValide(id);
  if (encaissement.moyen !== "CHEQUE") throw new ErreurMetier("Seul un chèque se crédite après sa réception.", 400);
  if (encaissement.crediteLe) {
    throw new ErreurMetier(`Ce chèque est déjà crédité (le ${formatDateCourte(encaissement.crediteLe)}).`, 409);
  }
  const crediteLe = jourPasse(entree.crediteLe, encaissement.recuLe, "de crédit");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.encaissement.updateMany({ where: { id, statut: "VALIDE", crediteLe: null }, data: { crediteLe } });
    if (count !== 1) throw new ErreurMetier("Cet encaissement vient de changer : recharge la page.", 409);
    if (encaissement.dossierId) {
      await tx.dossierEvenement.create({
        data: {
          dossierId: encaissement.dossierId,
          type: "ENCAISSEMENT_CREDITE",
          direction: "INTERNE",
          contenu: `Chèque${encaissement.reference ? ` n° ${encaissement.reference}` : ""} de ${formatCentimes(versCentimes(encaissement.montant))} crédité le ${formatDateCourte(crediteLe)}`,
          metadata: JSON.stringify({ encaissementId: id }),
        },
      });
    }
  });
  return encaissement.dossierId;
}

/** Fin d'un encaissement (rejet ou annulation) : ses affectations cessent de compter, l'étape suit. */
async function terminerEncaissement(
  id: string,
  fin: { statut: "REJETE" | "ANNULE"; finLe: Date; motifFin: string; evenement: string; type: "ENCAISSEMENT_REJETE" | "ENCAISSEMENT_ANNULE" }
): Promise<string | null> {
  const encaissement = await encaissementValide(id);
  const changement = await prisma.$transaction(async (tx) => {
    const etaitSolde = encaissement.dossierId ? (await faitsPaiements(tx, encaissement.dossierId)).soldeEncaisse : false;
    const { count } = await tx.encaissement.updateMany({
      where: { id, statut: "VALIDE" },
      data: { statut: fin.statut, finLe: fin.finLe, motifFin: fin.motifFin },
    });
    if (count !== 1) throw new ErreurMetier("Cet encaissement vient de changer : recharge la page.", 409);
    const liberees = await tx.affectationEncaissement.findMany({
      where: { encaissementId: id, statut: "ACTIVE" },
      select: { numeroDocument: { select: { type: true } } },
    });
    await tx.affectationEncaissement.updateMany({
      where: { encaissementId: id, statut: "ACTIVE" },
      data: { statut: "LIBEREE", finLe: new Date(), motifFin: fin.statut === "REJETE" ? "Chèque rejeté" : "Encaissement annulé" },
    });
    if (!encaissement.dossierId) return null;

    await tx.dossierEvenement.create({
      data: {
        dossierId: encaissement.dossierId,
        type: fin.type,
        direction: "INTERNE",
        contenu: `${fin.evenement} : ${descriptionPaiement(encaissement)} (${fin.motifFin})`,
        metadata: JSON.stringify({ encaissementId: id }),
      },
    });
    // Un acompte qui revient impayé est à réclamer : c'est la prochaine action.
    if (fin.statut === "REJETE" && liberees.some((affectation) => affectation.numeroDocument.type === "DEVIS")) {
      await tx.dossier.update({
        where: { id: encaissement.dossierId },
        data: {
          prochaineAction: "Chèque d'acompte rejeté : réclamer un nouveau paiement",
          prochaineActionDate: dateDepuisJour(jourParis(new Date())),
        },
      });
    }
    return (
      (await suivreSoldeDossier(
        tx,
        encaissement.dossierId,
        fin.statut === "REJETE" ? "chèque rejeté, facture à nouveau due" : "paiement annulé, facture à nouveau due",
        etaitSolde
      )) ?? (await suivreAcompteDossier(tx, encaissement.dossierId, "RECUL"))
    );
  });
  if (changement) await effetsDuChangementEtape(changement);
  return encaissement.dossierId;
}

export async function rejeterEncaissement(id: string, entree: { le: string; motif: string; precision?: string }): Promise<string | null> {
  const encaissement = await encaissementValide(id);
  if (encaissement.moyen !== "CHEQUE") {
    throw new ErreurMetier("Seul un chèque se rejette. Pour une erreur de saisie, annuler l'encaissement.", 400);
  }
  const finLe = jourPasse(entree.le, encaissement.recuLe, "du rejet");
  return terminerEncaissement(id, {
    statut: "REJETE",
    finLe,
    motifFin: libelleMotif(MOTIFS_REJET, entree.motif, entree.precision),
    evenement: "Chèque rejeté",
    type: "ENCAISSEMENT_REJETE",
  });
}

export async function annulerEncaissement(id: string, entree: { motif: string; precision?: string }): Promise<string | null> {
  return terminerEncaissement(id, {
    statut: "ANNULE",
    finLe: new Date(),
    motifFin: libelleMotif(MOTIFS_ANNULATION, entree.motif, entree.precision),
    evenement: "Paiement annulé",
    type: "ENCAISSEMENT_ANNULE",
  });
}

/* ── Correction ──────────────────────────────────────────────────── */

/**
 * Corrige un paiement enregistré (montant, date de réception, moyen,
 * référence, payeur, crédit du chèque, note) au lieu de l'annuler et de le
 * ressaisir. Un montant corrigé libère les imputations et les refait sur les
 * mêmes pièces, jusqu'à ce qui y reste dû (le surplus reste non imputé). Le
 * livre des recettes suit la nouvelle date : l'écran prévient quand un mois
 * passé change. L'étape suit l'argent, sans reculer un dossier qui n'était
 * pas réglé.
 */
export async function modifierEncaissement(id: string, entree: CorrectionEncaissement): Promise<string | null> {
  const encaissement = await prisma.encaissement.findUnique({ where: { id } });
  if (!encaissement) throw new ErreurMetier("Encaissement introuvable.", 404);
  const touchePaiement = entree.montant !== undefined || entree.recuLe !== undefined || entree.moyen !== undefined || entree.crediteLe !== undefined;
  if (encaissement.statut !== "VALIDE" && touchePaiement) {
    throw new ErreurMetier("Ce paiement est annulé ou rejeté : il ne se corrige plus, enregistre le bon paiement.", 409);
  }

  const recuLe = entree.recuLe ? dateDepuisJour(entree.recuLe) : encaissement.recuLe;
  const moyen = entree.moyen !== undefined ? entree.moyen : encaissement.moyen;
  const crediteLe = entree.crediteLe !== undefined ? (entree.crediteLe ? dateDepuisJour(entree.crediteLe) : null) : encaissement.crediteLe;
  if (crediteLe && moyen !== "CHEQUE") throw new ErreurMetier("Seul un chèque a une date de crédit.", 400);
  if (crediteLe && jourParis(crediteLe) < jourParis(recuLe)) throw new ErreurMetier("Un chèque se crédite après sa réception.", 400);

  const ancienCentimes = versCentimes(encaissement.montant);
  const nouveauCentimes = entree.montant !== undefined ? versCentimes(entree.montant) : ancienCentimes;

  const changement = await prisma.$transaction(async (tx) => {
    const etaitSolde = encaissement.dossierId ? (await faitsPaiements(tx, encaissement.dossierId)).soldeEncaisse : false;
    const { count } = await tx.encaissement.updateMany({
      where: { id, updatedAt: encaissement.updatedAt },
      data: {
        montant: nouveauCentimes / 100,
        recuLe,
        moyen,
        crediteLe: moyen === "CHEQUE" ? crediteLe : null,
        ...(entree.reference !== undefined ? { reference: entree.reference || null } : {}),
        ...(entree.payeur !== undefined ? { payeur: entree.payeur } : {}),
        ...(entree.note !== undefined ? { note: entree.note || null } : {}),
      },
    });
    if (count !== 1) throw new ErreurMetier("Ce paiement vient de changer : recharge la page.", 409);

    if (nouveauCentimes !== ancienCentimes) await reimputer(tx, id, ancienCentimes, nouveauCentimes);
    if (!encaissement.dossierId) return null;

    const avant = { montant: encaissement.montant, moyen: encaissement.moyen, reference: encaissement.reference, recuLe: encaissement.recuLe };
    const apres = { montant: nouveauCentimes / 100, moyen, reference: entree.reference !== undefined ? entree.reference || null : encaissement.reference, recuLe };
    const differences = [
      ...(nouveauCentimes !== ancienCentimes ? [`montant ${formatCentimes(nouveauCentimes)} (au lieu de ${formatCentimes(ancienCentimes)})`] : []),
      ...(jourParis(recuLe) !== jourParis(encaissement.recuLe) ? [`reçu le ${formatDateCourte(recuLe)} (au lieu du ${formatDateCourte(encaissement.recuLe)})`] : []),
      ...(moyen !== encaissement.moyen ? [`par ${libelleMoyen(moyen)} (au lieu de ${libelleMoyen(encaissement.moyen)})`] : []),
    ];
    await tx.dossierEvenement.create({
      data: {
        dossierId: encaissement.dossierId,
        type: "ENCAISSEMENT_CORRIGE",
        direction: "INTERNE",
        contenu: `Paiement corrigé : ${differences.length ? differences.join(", ") : descriptionPaiement(apres)}`,
        metadata: JSON.stringify({ encaissementId: id, avant, apres }),
      },
    });
    return suivreSoldeDossier(tx, encaissement.dossierId, "paiement corrigé", etaitSolde);
  });
  if (changement) await effetsDuChangementEtape(changement);
  return encaissement.dossierId;
}

/** Montant corrigé : les imputations actives cessent de compter et se refont sur les mêmes pièces, dans la limite de ce qui y reste dû. */
async function reimputer(tx: Transaction, encaissementId: string, ancienCentimes: number, nouveauCentimes: number): Promise<void> {
  const actives = await tx.affectationEncaissement.findMany({
    where: { encaissementId, statut: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { numeroDocumentId: true },
  });
  if (actives.length === 0) return;
  await tx.affectationEncaissement.updateMany({
    where: { encaissementId, statut: "ACTIVE" },
    data: { statut: "LIBEREE", finLe: new Date(), motifFin: `Montant corrigé : ${formatCentimes(nouveauCentimes)} au lieu de ${formatCentimes(ancienCentimes)}` },
  });
  let reste = nouveauCentimes;
  for (const numeroDocumentId of [...new Set(actives.map((affectation) => affectation.numeroDocumentId))]) {
    if (reste <= 0) break;
    const ligne = await tx.numeroDocument.findUnique({
      where: { id: numeroDocumentId },
      include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
    });
    if (!ligne) continue;
    const document = ligne.documentId ? await tx.document.findUnique({ where: { id: ligne.documentId }, select: { totalHt: true } }) : null;
    const total = document ? versCentimes(document.totalHt) : ligne.montant !== null ? versCentimes(ligne.montant) : null;
    const regle = ligne.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
    const part = total === null ? reste : Math.min(reste, Math.max(0, total - regle));
    if (part <= 0) continue;
    await tx.affectationEncaissement.create({ data: { encaissementId, numeroDocumentId, montant: part / 100 } });
    reste -= part;
  }
}

/* ── Facturation ─────────────────────────────────────────────────── */

export type LigneImputation = {
  encaissementId: string;
  recuLe: Date;
  moyen: string | null;
  centimes: number;
  /** Acompte imputé sur un devis du dossier, transféré sur la facture. */
  depuisAffectationId: string | null;
};

/**
 * Ce qui réglera la facture à sa génération : les acomptes imputés sur les
 * devis du dossier, puis les sommes reçues non imputées (après un avoir),
 * dans la limite du montant de la facture.
 */
export async function planImputationFacture(lecteur: Transaction, dossierId: string, totalCentimes: number): Promise<LigneImputation[]> {
  const pieces = await piecesDuDossier(lecteur, dossierId);
  const devis = pieces.filter((piece) => piece.type === "DEVIS").map((piece) => piece.registreId);
  const [acomptes, valides] = await Promise.all([
    lecteur.affectationEncaissement.findMany({
      where: { numeroDocumentId: { in: devis }, statut: "ACTIVE", encaissement: { statut: "VALIDE" } },
      include: { encaissement: { select: { id: true, recuLe: true, moyen: true } } },
      orderBy: { createdAt: "asc" },
    }),
    lecteur.encaissement.findMany({
      where: { dossierId, statut: "VALIDE" },
      include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
      orderBy: [{ recuLe: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const lignes: LigneImputation[] = [];
  let reste = totalCentimes;
  for (const acompte of acomptes) {
    if (reste <= 0) break;
    const part = Math.min(reste, versCentimes(acompte.montant));
    lignes.push({ encaissementId: acompte.encaissement.id, recuLe: acompte.encaissement.recuLe, moyen: acompte.encaissement.moyen, centimes: part, depuisAffectationId: acompte.id });
    reste -= part;
  }
  for (const encaissement of valides) {
    if (reste <= 0) break;
    const impute = encaissement.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
    const libre = versCentimes(encaissement.montant) - impute;
    if (libre <= 0) continue;
    const part = Math.min(reste, libre);
    lignes.push({ encaissementId: encaissement.id, recuLe: encaissement.recuLe, moyen: encaissement.moyen, centimes: part, depuisAffectationId: null });
    reste -= part;
  }
  return lignes;
}

const signaturePlan = (plan: LigneImputation[]) =>
  JSON.stringify(plan.map((ligne) => [ligne.encaissementId, ligne.centimes, ligne.depuisAffectationId]));

/** Mentions imprimées sur la facture : paiements déjà reçus et reste à payer. */
export function mentionsReglements(plan: LigneImputation[], totalCentimes: number): string[] {
  if (plan.length === 0) return [];
  const regle = plan.reduce((somme, ligne) => somme + ligne.centimes, 0);
  return [
    ...plan.map(
      (ligne) =>
        `${ligne.depuisAffectationId ? "Acompte reçu" : "Règlement reçu"} le ${formatDateCourte(ligne.recuLe)}${
          ligne.moyen ? ` (${libelleMoyen(ligne.moyen)})` : ""
        } : ${formatCentimes(ligne.centimes)}`
    ),
    regle >= totalCentimes ? "Facture entièrement réglée" : `Reste à payer : ${formatCentimes(totalCentimes - regle)}`,
  ];
}

/** Dans la transaction de la facture : applique le plan imprimé, ou refuse s'il a changé entre-temps. */
export async function imputerSurFacture(
  tx: Transaction,
  facture: { dossierId: string; registreId: string; numero: string; totalCentimes: number },
  planImprime: LigneImputation[]
): Promise<void> {
  const plan = await planImputationFacture(tx, facture.dossierId, facture.totalCentimes);
  if (signaturePlan(plan) !== signaturePlan(planImprime)) {
    throw new ErreurMetier("Un paiement de ce dossier vient de changer : relance la génération de la facture.", 409);
  }
  for (const ligne of plan) {
    if (ligne.depuisAffectationId) {
      await tx.affectationEncaissement.update({
        where: { id: ligne.depuisAffectationId },
        data: { statut: "TRANSFEREE", finLe: new Date(), motifFin: `Imputé sur la facture ${facture.numero}` },
      });
    }
    await tx.affectationEncaissement.create({
      data: { encaissementId: ligne.encaissementId, numeroDocumentId: facture.registreId, montant: ligne.centimes / 100 },
    });
  }
}

/** Avoir : ce qui réglait la facture annulée redevient disponible pour la facture corrigée. */
export async function libererReglementsFacture(tx: Transaction, factureDocumentId: string, avoirNumero: string): Promise<void> {
  const ligne = await tx.numeroDocument.findUnique({ where: { documentId: factureDocumentId }, select: { id: true } });
  if (!ligne) return;
  await tx.affectationEncaissement.updateMany({
    where: { numeroDocumentId: ligne.id, statut: "ACTIVE" },
    data: { statut: "LIBEREE", finLe: new Date(), motifFin: `Facture annulée par l'avoir ${avoirNumero}` },
  });
}

/* ── Changement d'étape avec paiement ────────────────────────────── */

/**
 * Changement d'étape avec le paiement reçu (acompte à la signature, solde à
 * l'encaissement) : le paiement et le changement d'étape s'écrivent ensemble,
 * ou pas du tout. Un solde qui ne règle pas tout passe quand même : le reste
 * dû est dit dans l'événement et sur le dossier.
 */
export async function changerEtapeAvecPaiement(
  dossierId: string,
  entree: EntreeChangementEtape & { acompte?: EntreePaiement; solde?: EntreePaiement }
): Promise<ChangementEtape> {
  const changement = await prisma.$transaction(async (tx) => {
    if (entree.solde) {
      await enregistrerEncaissementDansTransaction(tx, { dossierId, paiement: entree.solde });
      return changerEtapeDansTransaction(tx, dossierId, { ...entree, solde: undefined });
    }

    const change = await changerEtapeDansTransaction(tx, dossierId, entree);
    if (entree.acompte) {
      // Sur le devis accepté quand il y en a un ; sinon sur le dossier, imputé plus tard (facture).
      const devis = change.documentId
        ? await tx.numeroDocument.findUnique({ where: { documentId: change.documentId }, select: { id: true } })
        : null;
      await enregistrerEncaissementDansTransaction(tx, { dossierId, numeroDocumentId: devis?.id ?? null, paiement: entree.acompte });
    }
    return change;
  });
  await effetsDuChangementEtape(changement);
  if (entree.acompte || entree.solde) await (await import("@/lib/mail/notifications")).notifierPaiementsRecents(dossierId);
  return changement;
}
