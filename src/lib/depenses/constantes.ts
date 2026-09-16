// Dépenses : catégories, moyens et saisies, partagés entre le serveur et
// l'interface. Aucune dépendance serveur.

import { z } from "zod/v4";
import { estJourValide, jourParis } from "@/lib/dossiers/dates";

export const CATEGORIES_DEPENSE = [
  { code: "MATIERE", libelle: "Matière (films, adhésifs)", chantier: true },
  { code: "FOURNITURES", libelle: "Fournitures et consommables", chantier: true },
  { code: "SOUS_TRAITANCE", libelle: "Sous-traitance", chantier: true },
  { code: "DEPLACEMENT", libelle: "Déplacement (carburant, péage, parking)", chantier: true },
  { code: "OUTILLAGE", libelle: "Outillage", chantier: false },
  { code: "PUBLICITE", libelle: "Publicité", chantier: false },
  { code: "LOGICIELS", libelle: "Logiciels et abonnements", chantier: false },
  { code: "ASSURANCE", libelle: "Assurance", chantier: false },
  { code: "BANQUE", libelle: "Frais bancaires", chantier: false },
  { code: "FORMATION", libelle: "Formation", chantier: false },
  { code: "AUTRE", libelle: "Autre", chantier: false },
] as const;
export type CategorieDepense = (typeof CATEGORIES_DEPENSE)[number]["code"];

export const CODES_CATEGORIE = CATEGORIES_DEPENSE.map((categorie) => categorie.code) as [CategorieDepense, ...CategorieDepense[]];

export function libelleCategorie(code: string): string {
  return CATEGORIES_DEPENSE.find((categorie) => categorie.code === code)?.libelle ?? code;
}

/** Catégorie qui se rattache d'ordinaire à un chantier (sinon : frais généraux). */
export function categorieDeChantier(code: string): boolean {
  return CATEGORIES_DEPENSE.find((categorie) => categorie.code === code)?.chantier ?? false;
}

export const MOYENS_DEPENSE = ["CARTE", "VIREMENT", "PRELEVEMENT", "ESPECES", "CHEQUE", "AUTRE"] as const;
export const LIBELLES_MOYEN_DEPENSE: Record<(typeof MOYENS_DEPENSE)[number], string> = {
  CARTE: "Carte",
  VIREMENT: "Virement",
  PRELEVEMENT: "Prélèvement",
  ESPECES: "Espèces",
  CHEQUE: "Chèque",
  AUTRE: "Autre",
};

const champsDepense = {
  payeeLe: z
    .string("Date invalide.")
    .refine(estJourValide, "Date invalide.")
    .refine((jour) => jour <= jourParis(new Date()), "La date de la dépense est à venir."),
  montant: z.number("Montant invalide.").gt(0, "Le montant doit être supérieur à zéro.").max(1_000_000, "Montant invalide."),
  fournisseur: z.string("Fournisseur manquant.").trim().min(1, "Indique le fournisseur.").max(120, "Nom du fournisseur trop long."),
  categorie: z.enum(CODES_CATEGORIE, "Choisis une catégorie."),
  libelle: z.string().trim().max(200, "Libellé trop long.").nullable().optional(),
  moyen: z.enum(MOYENS_DEPENSE, "Moyen de paiement invalide.").nullable().optional(),
  dossierId: z.string().max(40).nullable().optional(),
  horsChantier: z.boolean().optional(),
  note: z.string().trim().max(1000, "Note trop longue.").nullable().optional(),
};

const rattachementCoherent = (entree: { dossierId?: string | null; horsChantier?: boolean }) => !(entree.dossierId && entree.horsChantier);
const MESSAGE_RATTACHEMENT = { message: "Une dépense est rattachée à un chantier ou hors chantier, pas les deux.", path: ["horsChantier"] };

export const schemaCreationDepense = z
  .object({
    ...champsDepense,
    /** Saisie faite sur le téléphone : la même dépense renvoyée après une coupure n'est pas dupliquée. */
    identifiantHorsLigne: z.string().trim().min(8).max(64).nullable().optional(),
    /** Enregistrer malgré un justificatif déjà attaché à une autre dépense. */
    forcer: z.boolean().optional(),
  })
  .refine(rattachementCoherent, MESSAGE_RATTACHEMENT);

export const schemaModificationDepense = z.object(champsDepense).partial().refine(rattachementCoherent, MESSAGE_RATTACHEMENT);

export const schemaArchivageDepense = z.object({
  motif: z.string("Indique pourquoi.").trim().min(3, "Indique pourquoi cette dépense est retirée.").max(300, "Motif trop long."),
});

export type EntreeDepense = z.output<typeof schemaCreationDepense>;

export type DepenseVue = {
  id: string;
  payeeLe: string;
  montant: number;
  fournisseur: string;
  categorie: CategorieDepense;
  libelle: string | null;
  moyen: (typeof MOYENS_DEPENSE)[number] | null;
  dossier: { id: string; clientNom: string; objet: string } | null;
  horsChantier: boolean;
  justificatif: { url: string; typeMime: string } | null;
  note: string | null;
  archiveLe: string | null;
  archiveMotif: string | null;
};

/** Chantier proposé à la saisie : ceux où l'on travaille en premier. */
export type ChantierPropose = { id: string; clientNom: string; objet: string; etape: string; dateChantier: string | null };
