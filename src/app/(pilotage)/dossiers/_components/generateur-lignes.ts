import type { LigneDocument, TypeDocument, Unite } from "@/lib/dossiers/constants";
import { formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";

/** Mission 13 (lot 7) : les lignes en cours de saisie du générateur de devis et factures — types, ligne vide, reprise d'un document existant, acompte, résultat. */

export type LigneSaisie =
  | {
      cle: string;
      type: "PRESTATION";
      designation: string;
      sousDesignation: string;
      quantite: string;
      unite: Unite;
      prixUnitaire: string;
    }
  | { cle: string; type: "SECTION"; libelle: string };

export type Erreurs = Record<string, string>;

export const nouvelleCle = () => crypto.randomUUID();

export const prestationVide = (): LigneSaisie => ({
  cle: nouvelleCle(),
  type: "PRESTATION",
  designation: "",
  sousDesignation: "",
  quantite: "1",
  unite: "ml",
  prixUnitaire: "",
});

export function saisieDepuis(lignes: LigneDocument[]): LigneSaisie[] {
  return lignes.map((ligne) =>
    ligne.type === "SECTION"
      ? { cle: nouvelleCle(), type: "SECTION", libelle: ligne.libelle }
      : {
          cle: nouvelleCle(),
          type: "PRESTATION",
          designation: ligne.designation,
          sousDesignation: ligne.sousDesignation ?? "",
          quantite: formatQuantite(ligne.quantite),
          unite: ligne.unite,
          prixUnitaire: formatQuantite(ligne.prixUnitaire),
        }
  );
}

/** Document de départ : le devis signé (ou le dernier devis) pour une facture, le dernier devis pour un devis. */
export function documentDeDepart(detail: DossierDetail, type: TypeDocument): DocumentVue | undefined {
  const devis = detail.documents.filter((document) => document.type === "DEVIS" && document.numero);
  return type === "FACTURE" ? (devis.find((document) => document.statut === "ACCEPTE") ?? devis[0]) : devis[0];
}

export function lireAcompte(saisie: string): number | null {
  const valeur = lireNombre(saisie);
  return valeur !== null && Number.isInteger(valeur) && valeur >= 0 && valeur <= 100 ? valeur : null;
}

export type Resultat = { type: TypeDocument; numero: string; pdfUrl: string; totalHtCentimes: number };
