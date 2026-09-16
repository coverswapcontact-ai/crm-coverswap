import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { definirProposition } from "@/lib/validation/definitions";
import {
  ETAPES,
  LIBELLES_ETAPE,
  LIBELLES_MOTIF_PERTE,
  MOTIFS_PERTE,
  type EtapeDossier,
} from "./constants";
import { dateDepuisJour, estJourValide } from "./dates";
import { ecrireNote } from "./dossiers";
import { ErreurMetier } from "./erreurs";
import { changerEtapeDansTransaction, effetsDuChangementEtape } from "./transitions";

// Propositions qui portent sur un dossier : formulées par l'agent mail (ou le
// système), exécutées seulement après validation.

/** Étapes qui engagent de l'argent : jamais sans décision humaine explicite, jamais en lot. */
export const ETAPES_ENGAGEANTES: readonly EtapeDossier[] = ["SIGNE", "FACTURE", "ENCAISSE", "PERDU"];

const idDossier = z.string("Dossier manquant.").min(1, "Dossier manquant.").max(40);

async function dossierVivant(dossierId: string): Promise<{ etape: string } | string> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true, archiveLe: true } });
  if (!dossier) return "le dossier n'existe plus";
  if (dossier.archiveLe) return "le dossier est archivé";
  return dossier;
}

export const propositionNoteDossier = definirProposition({
  type: "NOTE_DOSSIER",
  libelle: "Ajouter une note au dossier",
  schema: z.object({
    dossierId: idDossier,
    texte: z.string("La note est vide.").trim().min(1, "La note est vide.").max(4000, "Note trop longue."),
  }),
  sensible: false,
  validationGroupee: true,
  champs: [{ cle: "texte", libelle: "Note", nature: "texteLong", obligatoire: true }],
  execution: "IMMEDIATE",
  async executer(contenu, { tx }) {
    if (!tx) throw new Error("NOTE_DOSSIER s'exécute dans la transaction de la validation");
    const dossier = await tx.dossier.findUnique({ where: { id: contenu.dossierId }, select: { etape: true } });
    if (!dossier) throw new ErreurMetier("Dossier introuvable.", 404);
    const etape = (ETAPES as readonly string[]).includes(dossier.etape) ? (dossier.etape as EtapeDossier) : "QUALIFICATION";
    const note = await ecrireNote(tx, contenu.dossierId, { etape, contenu: contenu.texte });
    return { resultat: { noteId: note.id } };
  },
  async pertinente(contenu) {
    const dossier = await dossierVivant(contenu.dossierId);
    return typeof dossier === "string" ? dossier : null;
  },
});

export const propositionProchaineAction = definirProposition({
  type: "PROCHAINE_ACTION",
  libelle: "Fixer la prochaine action du dossier",
  schema: z.object({
    dossierId: idDossier,
    action: z.string("Action manquante.").trim().min(1, "Action manquante.").max(200, "Action trop longue."),
    date: z
      .string("Date invalide.")
      .refine(estJourValide, "Date invalide.")
      .nullable()
      .optional(),
  }),
  sensible: false,
  validationGroupee: true,
  champs: [
    { cle: "action", libelle: "Prochaine action", nature: "texte", obligatoire: true },
    { cle: "date", libelle: "Date", nature: "jour" },
  ],
  execution: "IMMEDIATE",
  async executer(contenu, { tx }) {
    if (!tx) throw new Error("PROCHAINE_ACTION s'exécute dans la transaction de la validation");
    await tx.dossier.update({
      where: { id: contenu.dossierId },
      data: { prochaineAction: contenu.action, prochaineActionDate: contenu.date ? dateDepuisJour(contenu.date) : null },
    });
  },
  async pertinente(contenu) {
    const dossier = await dossierVivant(contenu.dossierId);
    return typeof dossier === "string" ? dossier : null;
  },
});

export const propositionChangementEtape = definirProposition({
  type: "CHANGEMENT_ETAPE",
  libelle: "Changer l'étape du dossier",
  schema: z.object({
    dossierId: idDossier,
    vers: z.enum(ETAPES, "Étape invalide."),
    motifPerte: z.enum(MOTIFS_PERTE, "Motif de perte invalide.").optional(),
    dateChantier: z.string("Date de chantier invalide.").refine(estJourValide, "Date de chantier invalide.").optional(),
  }),
  sensible: (contenu) => ETAPES_ENGAGEANTES.includes(contenu.vers),
  validationGroupee: true,
  champs: [
    {
      cle: "vers",
      libelle: "Nouvelle étape",
      nature: "choix",
      obligatoire: true,
      options: ETAPES.map((etape) => ({ valeur: etape, libelle: LIBELLES_ETAPE[etape] })),
    },
    {
      cle: "motifPerte",
      libelle: "Motif de perte",
      nature: "choix",
      aide: "Obligatoire pour « Perdu ».",
      options: MOTIFS_PERTE.map((motif) => ({ valeur: motif, libelle: LIBELLES_MOTIF_PERTE[motif] })),
    },
    { cle: "dateChantier", libelle: "Date du chantier", nature: "jour", aide: "Obligatoire pour « Planifié »." },
  ],
  motifsRejet: [{ code: "MAUVAISE_ETAPE", libelle: "Ce n'est pas la bonne étape" }],
  execution: "IMMEDIATE",
  async executer(contenu, { tx }) {
    if (!tx) throw new Error("CHANGEMENT_ETAPE s'exécute dans la transaction de la validation");
    const changement = await changerEtapeDansTransaction(tx, contenu.dossierId, {
      vers: contenu.vers,
      motifPerte: contenu.motifPerte,
      dateChantier: contenu.dateChantier,
    });
    return { resultat: changement, apresValidation: () => effetsDuChangementEtape(changement) };
  },
  async pertinente(contenu) {
    const dossier = await dossierVivant(contenu.dossierId);
    if (typeof dossier === "string") return dossier;
    return dossier.etape === contenu.vers ? `le dossier est déjà à l'étape « ${LIBELLES_ETAPE[contenu.vers]} »` : null;
  },
});
