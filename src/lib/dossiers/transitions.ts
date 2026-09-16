import type { Prisma } from "@prisma/client";
import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { sendConversionEvent } from "@/lib/meta";
import {
  ETAPES,
  LIBELLES_ETAPE,
  LIBELLES_MOTIF_PERTE,
  MOTIFS_PERTE,
  type EtapeDossier,
} from "./constants";
import { dateDepuisJour, estJourValide } from "./dates";
import { ErreurMetier } from "./erreurs";
import {
  CRITERES_DECLARATIFS,
  estEtape,
  estEtapeActive,
  etapeAvantSortie,
  lireMetadataChangementEtape,
  rangEtape,
  verifierTransition,
  type DonneesTransition,
  type FaitsDossier,
  type MetadataChangementEtape,
} from "./regles";
import { lirePhotos } from "./stockage";

export type ChangementEtape = {
  dossierId: string;
  de: EtapeDossier;
  vers: EtapeDossier;
  nature: MetadataChangementEtape["nature"];
};

/** Lit un dossier et tout ce qu'il faut pour vérifier un changement d'étape. */
export async function chargerEtatEtape(tx: Transaction, dossierId: string) {
  const dossier = await tx.dossier.findUnique({
    where: { id: dossierId },
    include: {
      documents: {
        where: { statut: { not: "BROUILLON" } },
        select: { id: true, type: true, totalHt: true, statut: true },
        orderBy: { createdAt: "desc" },
      },
      evenements: {
        where: { type: "CHANGEMENT_ETAPE" },
        select: { metadata: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
  if (!estEtape(dossier.etape)) throw new Error(`Étape inconnue en base : ${dossier.etape}`);

  const faits: FaitsDossier = {
    etape: dossier.etape,
    clientNom: dossier.clientNom,
    clientAdresse: dossier.clientAdresse,
    clientCp: dossier.clientCp,
    clientVille: dossier.clientVille,
    clientTelephone: dossier.clientTelephone,
    objet: dossier.objet,
    nbPhotos: lirePhotos(dossier.photos).length,
    dateChantier: dossier.dateChantier,
    aDevisGenere: dossier.documents.some((document) => document.type === "DEVIS"),
    // Une facture annulée par un avoir ne compte plus : le dossier attend la nouvelle.
    aFactureGeneree: dossier.documents.some((document) => document.type === "FACTURE" && document.statut !== "ANNULEE"),
  };
  const avantSortie = etapeAvantSortie(
    dossier.evenements
      .map((evenement) => lireMetadataChangementEtape(evenement.metadata))
      .filter((metadata): metadata is MetadataChangementEtape => metadata !== null)
  );
  return { dossier, faits, avantSortie };
}

type Application = ChangementEtape & {
  donnees?: DonneesTransition;
  documentId?: string;
  /** Étape active de référence (celle quittée avant une pause), pour situer une perte. */
  etapeReference?: EtapeDossier | null;
};

/**
 * Écrit un changement d'étape déjà vérifié : l'étape du dossier et
 * l'événement CHANGEMENT_ETAPE, dans la transaction de l'appelant.
 */
export async function appliquerChangementEtape(
  tx: Transaction,
  application: Application
): Promise<ChangementEtape> {
  const { dossierId, de, vers, nature, donnees = {}, documentId } = application;

  const data: Prisma.DossierUpdateManyMutationInput = { etape: vers };
  let perte: Pick<MetadataChangementEtape, "perteEtape" | "perteMontantPropose"> = {};
  if (vers === "PERDU") {
    // La perte est figée maintenant : à quelle étape, contre qui, à quel prix.
    const [dernierDevis, dossier] = await Promise.all([
      tx.document.findFirst({
        where: { dossierId, type: "DEVIS", statut: { not: "BROUILLON" } },
        orderBy: { createdAt: "desc" },
        select: { totalHt: true },
      }),
      tx.dossier.findUnique({ where: { id: dossierId }, select: { montantEstime: true } }),
    ]);
    const etapePerdue = estEtapeActive(de) ? de : (application.etapeReference ?? null);
    perte = {
      ...(etapePerdue ? { perteEtape: etapePerdue } : {}),
      ...((dernierDevis?.totalHt ?? dossier?.montantEstime) != null
        ? { perteMontantPropose: dernierDevis?.totalHt ?? dossier!.montantEstime! }
        : {}),
    };
    Object.assign(data, {
      motifPerte: donnees.motifPerte ?? null,
      perteLe: new Date(),
      perteEtape: perte.perteEtape ?? null,
      perteConcurrent: donnees.perteConcurrent?.trim() || null,
      perteMontantConcurrent: donnees.perteMontantConcurrent ?? null,
      perteMontantPropose: perte.perteMontantPropose ?? null,
      perteCommentaire: donnees.perteCommentaire?.trim() || null,
    });
  } else if (de === "PERDU") {
    Object.assign(data, {
      motifPerte: null,
      perteLe: null,
      perteEtape: null,
      perteConcurrent: null,
      perteMontantConcurrent: null,
      perteMontantPropose: null,
      perteCommentaire: null,
    });
  }
  if (vers === "PLANIFIE" && donnees.dateChantier) data.dateChantier = dateDepuisJour(donnees.dateChantier);

  // Garde optimiste : si l'étape a bougé depuis la lecture, rien n'est écrit.
  const { count } = await tx.dossier.updateMany({ where: { id: dossierId, etape: de }, data });
  if (count === 0) {
    throw new ErreurMetier("Le dossier a changé entre-temps : recharge-le puis réessaie.", 409);
  }

  // Retour avant « Signé » : le devis accepté redevient un simple devis généré.
  if (estEtapeActive(vers) && rangEtape(vers) < rangEtape("SIGNE")) {
    await tx.document.updateMany({
      where: { dossierId, type: "DEVIS", statut: "ACCEPTE" },
      data: { statut: "GENERE" },
    });
  }

  const confirmations = CRITERES_DECLARATIFS.filter((critere) => donnees.confirmations?.[critere]);
  const metadata: MetadataChangementEtape = {
    de,
    vers,
    nature,
    ...(vers === "PERDU" && donnees.motifPerte ? { motifPerte: donnees.motifPerte } : {}),
    ...(vers === "PERDU" && donnees.perteConcurrent?.trim() ? { perteConcurrent: donnees.perteConcurrent.trim() } : {}),
    ...(vers === "PERDU" && donnees.perteMontantConcurrent != null ? { perteMontantConcurrent: donnees.perteMontantConcurrent } : {}),
    ...(vers === "PERDU" && donnees.perteCommentaire?.trim() ? { perteCommentaire: donnees.perteCommentaire.trim() } : {}),
    ...perte,
    ...(vers === "PLANIFIE" && donnees.dateChantier ? { dateChantier: donnees.dateChantier } : {}),
    ...(confirmations.length > 0 ? { confirmations } : {}),
    ...(documentId ? { documentId } : {}),
  };

  let contenu = `${LIBELLES_ETAPE[de]} → ${LIBELLES_ETAPE[vers]}`;
  if (metadata.motifPerte) contenu += ` (motif : ${LIBELLES_MOTIF_PERTE[metadata.motifPerte].toLowerCase()})`;
  if (metadata.perteConcurrent) contenu += `, remporté par ${metadata.perteConcurrent}`;
  if (nature === "AUTOMATIQUE") contenu += ", à la génération du document";
  if (nature === "RETOUR") contenu += " (retour en arrière)";
  if (nature === "REPRISE") contenu += " (reprise)";

  await tx.dossierEvenement.create({
    data: {
      dossierId,
      type: "CHANGEMENT_ETAPE",
      direction: "INTERNE",
      contenu,
      metadata: JSON.stringify(metadata),
    },
  });

  return { dossierId, de, vers, nature };
}

export const schemaChangementEtape = z.object({
  vers: z.enum(ETAPES, "Étape invalide."),
  motifPerte: z.enum(MOTIFS_PERTE, "Motif de perte invalide.").optional(),
  perteConcurrent: z.string().trim().max(160, "Nom du concurrent trop long.").optional(),
  perteMontantConcurrent: z
    .number("Prix du concurrent invalide.")
    .min(0, "Prix du concurrent invalide.")
    .max(10_000_000, "Prix du concurrent invalide.")
    .optional(),
  perteCommentaire: z.string().trim().max(2000, "Précision trop longue.").optional(),
  dateChantier: z.string("Date de chantier invalide.").refine(estJourValide, "Date de chantier invalide.").optional(),
  confirmations: z
    .object({
      BON_POUR_ACCORD: z.boolean().optional(),
      ACOMPTE_ENCAISSE: z.boolean().optional(),
      SOLDE_ENCAISSE: z.boolean().optional(),
    })
    .optional(),
  devisAccepteId: z.string().max(40).optional(),
});

export type EntreeChangementEtape = DonneesTransition & {
  vers: EtapeDossier;
  devisAccepteId?: string;
};

/**
 * Vérifie et écrit un changement d'étape dans la transaction de l'appelant.
 * Les effets (lead, Meta) restent à lancer après la transaction.
 */
export async function changerEtapeDansTransaction(
  tx: Transaction,
  dossierId: string,
  entree: EntreeChangementEtape
): Promise<ChangementEtape> {
  const { dossier, faits, avantSortie } = await chargerEtatEtape(tx, dossierId);
  const verification = verifierTransition(faits, entree.vers, entree, avantSortie);
  if (!verification.ok) throw new ErreurMetier(verification.erreur, 409);

  let documentId: string | undefined;
  if (entree.vers === "SIGNE" && verification.nature === "SUIVANTE") {
    const devis = dossier.documents.filter((document) => document.type === "DEVIS");
    const signe = entree.devisAccepteId ? devis.find((document) => document.id === entree.devisAccepteId) : devis[0];
    if (!signe) throw new ErreurMetier("Devis signé introuvable dans ce dossier.", 400);
    await tx.document.update({ where: { id: signe.id }, data: { statut: "ACCEPTE" } });
    documentId = signe.id;
  }

  return appliquerChangementEtape(tx, {
    dossierId,
    de: faits.etape,
    vers: entree.vers,
    nature: verification.nature,
    donnees: entree,
    documentId,
    etapeReference: avantSortie,
  });
}

/** Changement d'étape demandé depuis l'interface. */
export async function changerEtape(dossierId: string, entree: EntreeChangementEtape): Promise<ChangementEtape> {
  const changement = await prisma.$transaction((tx) => changerEtapeDansTransaction(tx, dossierId, entree));
  await effetsDuChangementEtape(changement);
  return changement;
}

// Statut du lead B2C (écran /leads) qui reflète l'étape du dossier.
// EN_PAUSE ne change rien.
const STATUT_LEAD_PAR_ETAPE: Partial<Record<EtapeDossier, string>> = {
  QUALIFICATION: "CONTACTE",
  SIMULATION: "CONTACTE",
  DEVIS_ENVOYE: "DEVIS_ENVOYE",
  RELANCE: "DEVIS_ENVOYE",
  SIGNE: "SIGNE",
  PLANIFIE: "CHANTIER_PLANIFIE",
  CHANTIER: "CHANTIER_PLANIFIE",
  FACTURE: "TERMINE",
  ENCAISSE: "TERMINE",
  PERDU: "PERDU",
};

/**
 * Effets hors transaction d'un changement d'étape, jamais bloquants :
 * - le statut du lead B2C d'origine suit l'étape du dossier ;
 * - Meta Conversions API reçoit « SubmitApplication » (devis envoyé) et
 *   « Purchase » (signé, avec le montant du devis accepté), comme le faisait
 *   l'ancien écran /devis. Sans META_PIXEL_ID ni META_ACCESS_TOKEN, rien ne part.
 */
export async function effetsDuChangementEtape(changement: ChangementEtape): Promise<void> {
  try {
    const dossier = await prisma.dossier.findUnique({
      where: { id: changement.dossierId },
      select: {
        lead: { select: { id: true, statut: true, prenom: true, nom: true, email: true, telephone: true, ville: true } },
        documents: {
          where: { type: "DEVIS", statut: "ACCEPTE" },
          select: { totalHt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    const lead = dossier?.lead;
    if (!lead) return;

    const statut = STATUT_LEAD_PAR_ETAPE[changement.vers];
    if (statut && statut !== lead.statut) {
      await prisma.lead.update({ where: { id: lead.id }, data: { statut } });
    }

    if (changement.nature === "RETOUR" || changement.nature === "REPRISE") return;
    const conversion =
      changement.vers === "DEVIS_ENVOYE" ? "SubmitApplication" : changement.vers === "SIGNE" ? "Purchase" : null;
    if (!conversion) return;
    void sendConversionEvent({
      eventName: conversion,
      email: lead.email ?? undefined,
      phone: lead.telephone || undefined,
      firstName: lead.prenom,
      lastName: lead.nom,
      city: lead.ville || undefined,
      value: conversion === "Purchase" ? dossier.documents[0]?.totalHt : undefined,
      eventId: `dossier-${changement.dossierId}-${changement.vers}`,
    }).catch(() => {});
  } catch (erreur) {
    console.error("[dossiers] effets du changement d'étape :", erreur);
  }
}
