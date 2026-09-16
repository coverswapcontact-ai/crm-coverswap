// Saisies d'encaissement, validées à l'identique par l'interface et le serveur.
// Aucune dépendance serveur.

import { z } from "zod/v4";
import { estJourValide, jourParis } from "@/lib/dossiers/dates";
import { MOTIFS_ANNULATION, MOTIFS_REJET, MOTIFS_SANS_ACOMPTE, MOYENS_PAIEMENT } from "./constantes";

const codes = (liste: readonly { code: string }[]) => liste.map((motif) => motif.code) as [string, ...string[]];

const jour = (message: string) => z.string(message).refine(estJourValide, message);

export const schemaPaiement = z
  .object({
    montant: z.number("Montant invalide.").gt(0, "Le montant doit être supérieur à zéro.").max(1_000_000, "Montant invalide."),
    moyen: z.enum(MOYENS_PAIEMENT, "Choisis le moyen de paiement."),
    recuLe: jour("Date de réception invalide."),
    reference: z.string().trim().max(120, "Référence trop longue : 120 caractères maximum.").nullable().optional(),
    /** Chèque déjà crédité au moment de la saisie. */
    crediteLe: jour("Date de crédit invalide.").nullable().optional(),
    note: z.string().trim().max(500, "Note trop longue : 500 caractères maximum.").nullable().optional(),
  })
  .refine((paiement) => paiement.recuLe <= jourParis(new Date()), { message: "La date de réception est à venir.", path: ["recuLe"] })
  .refine((paiement) => paiement.recuLe >= "2020-01-01", { message: "Date de réception invalide.", path: ["recuLe"] })
  .refine((paiement) => !paiement.crediteLe || paiement.moyen === "CHEQUE", { message: "Seul un chèque a une date de crédit.", path: ["crediteLe"] })
  .refine((paiement) => !paiement.crediteLe || (paiement.crediteLe >= paiement.recuLe && paiement.crediteLe <= jourParis(new Date())), {
    message: "Un chèque se crédite après sa réception, et pas dans le futur.",
    path: ["crediteLe"],
  });

export type EntreePaiement = z.output<typeof schemaPaiement>;

export const schemaEncaissement = z.object({
  paiement: schemaPaiement,
  /** Pièce réglée (ligne du registre : devis pour un acompte, facture) ; à défaut, imputation automatique sur le dossier. */
  numeroDocumentId: z.string().max(40).nullable().optional(),
  payeur: z.string().trim().max(160, "Nom du payeur trop long.").nullable().optional(),
});

export const schemaCredit = z.object({ crediteLe: jour("Date de crédit invalide.") });

const motifAvecPrecision = (liste: readonly { code: string }[], message: string) =>
  z
    .object({
      motif: z.enum(codes(liste), message),
      precision: z.string().trim().max(300, "Précision trop longue : 300 caractères maximum.").optional(),
    })
    .refine((entree) => entree.motif !== "AUTRE" || Boolean(entree.precision), { message: "Précise le motif.", path: ["precision"] });

export const schemaRejet = motifAvecPrecision(MOTIFS_REJET, "Choisis le motif du rejet.").and(z.object({ le: jour("Date du rejet invalide.") }));
export const schemaAnnulation = motifAvecPrecision(MOTIFS_ANNULATION, "Choisis le motif de l'annulation.");
export const schemaSansAcompte = motifAvecPrecision(MOTIFS_SANS_ACOMPTE, "Choisis pourquoi il n'y a pas d'acompte.");
