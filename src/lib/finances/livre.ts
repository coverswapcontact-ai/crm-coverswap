import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { versCentimes } from "@/lib/dossiers/montants";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import type { CleParametre, ValeurParametre } from "@/lib/parametres/definitions";
import { historiqueParametres } from "@/lib/parametres/service";

/**
 * Livre des recettes, calculé à chaque lecture depuis les encaissements : il
 * se reconstruit à l'identique, rien n'y est saisi à la main.
 *
 * - Une recette compte à sa date d'encaissement : la réception, ou pour un
 *   chèque la date que fixe le paramètre DATE_RECETTE_CHEQUE (réception ou
 *   crédit sur le compte) en vigueur à sa réception. Un chèque à compter au
 *   crédit et pas encore crédité n'y est pas encore.
 * - Rien ne s'efface : un encaissement déjà compté puis annulé (erreur de
 *   saisie) ou rejeté (chèque impayé) laisse sa ligne et reçoit une ligne
 *   négative à la date de l'annulation ou du rejet. Une période passée (donc
 *   peut-être déclarée) n'est jamais réécrite.
 */

export type MouvementLivre = "RECETTE" | "ANNULATION" | "REJET";

export type LigneLivre = {
  /** Jour de la ligne, AAAA-MM-JJ (heure de Paris). */
  jour: string;
  encaissementId: string;
  dossierId: string | null;
  client: string;
  /** Nature de la prestation : l'objet du chantier, à défaut la pièce réglée. */
  nature: string;
  /** Pièces justificatives : devis et factures réglés. */
  pieces: string;
  moyen: string;
  moyenRenseigne: boolean;
  reference: string | null;
  /** Euros, négatif pour une annulation ou un rejet. */
  montant: number;
  mouvement: MouvementLivre;
  motif: string | null;
};

export type EncaissementLivre = {
  id: string;
  createdAt: Date;
  dossierId: string | null;
  objetDossier: string | null;
  payeur: string;
  montant: number;
  moyen: string | null;
  reference: string | null;
  recuLe: Date;
  crediteLe: Date | null;
  statut: string;
  finLe: Date | null;
  motifFin: string | null;
  pieces: { numero: string; type: string }[];
};

export type ResultatLivre = { lignes: LigneLivre[]; manquants: CleParametre[] };

/** Lignes du livre pour ces encaissements (fonction pure : la règle des chèques est fournie). */
export function lignesDuLivre(
  encaissements: EncaissementLivre[],
  regleCheque: (recuLe: Date) => ValeurParametre | null
): ResultatLivre {
  // Une recette avant sa contre-passation, le même jour.
  const lignes: { ligne: LigneLivre; ordre: number }[] = [];
  let regleManquante = false;

  for (const encaissement of [...encaissements].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    let dateRecette: Date | null = encaissement.recuLe;
    if (encaissement.moyen === "CHEQUE") {
      const regle = regleCheque(encaissement.recuLe);
      if (regle === null) {
        regleManquante = true;
        continue;
      }
      if (regle === "CREDIT_BANCAIRE") dateRecette = encaissement.crediteLe;
    }
    if (!dateRecette) continue;

    const numeros = [...new Set(encaissement.pieces.map((piece) => `${piece.type === "DEVIS" ? "devis" : "facture"} ${piece.numero}`))];
    const premiereFacture = encaissement.pieces.find((piece) => piece.type === "FACTURE");
    const commun = {
      encaissementId: encaissement.id,
      dossierId: encaissement.dossierId,
      client: encaissement.payeur,
      nature: encaissement.objetDossier ?? (premiereFacture ? `Facture ${premiereFacture.numero}` : "Recette sans pièce rattachée"),
      pieces: numeros.join(", "),
      moyen: encaissement.moyen ? LIBELLES_MOYEN[encaissement.moyen as MoyenPaiement] : "Non renseigné",
      moyenRenseigne: encaissement.moyen !== null,
      reference: encaissement.reference,
    };
    lignes.push({ ligne: { ...commun, jour: jourParis(dateRecette), montant: encaissement.montant, mouvement: "RECETTE", motif: null }, ordre: 0 });

    if (encaissement.statut !== "VALIDE" && encaissement.finLe) {
      const fin = encaissement.finLe > dateRecette ? encaissement.finLe : dateRecette;
      lignes.push({
        ligne: {
          ...commun,
          jour: jourParis(fin),
          montant: -encaissement.montant,
          mouvement: encaissement.statut === "REJETE" ? "REJET" : "ANNULATION",
          motif: encaissement.motifFin,
        },
        ordre: 1,
      });
    }
  }

  lignes.sort((a, b) => a.ligne.jour.localeCompare(b.ligne.jour) || a.ordre - b.ordre);
  return { lignes: lignes.map(({ ligne }) => ligne), manquants: regleManquante ? ["DATE_RECETTE_CHEQUE"] : [] };
}

/** Livre des recettes entre deux jours inclus (AAAA-MM-JJ). */
export async function chargerLivre(du: string, au: string): Promise<ResultatLivre> {
  const encaissements = await prisma.encaissement.findMany({
    // Une ligne d'une période ne vient que d'un encaissement reçu au plus tard à sa fin.
    // (fin de journée en UTC : couvre toute la journée à Paris)
    where: { recuLe: { lte: new Date(`${au}T23:59:59.999Z`) } },
    include: {
      dossier: { select: { objet: true } },
      affectations: { orderBy: { createdAt: "asc" }, select: { numeroDocument: { select: { numero: true, type: true } } } },
    },
  });
  const lire = await historiqueParametres(["DATE_RECETTE_CHEQUE"]);
  const resultat = lignesDuLivre(
    encaissements.map((encaissement) => ({
      ...encaissement,
      objetDossier: encaissement.dossier?.objet ?? null,
      pieces: encaissement.affectations.map((affectation) => affectation.numeroDocument),
    })),
    (recuLe) => lire("DATE_RECETTE_CHEQUE", recuLe)
  );
  return { ...resultat, lignes: resultat.lignes.filter((ligne) => ligne.jour >= du && ligne.jour <= au) };
}

export function totalCentimes(lignes: LigneLivre[]): number {
  return lignes.reduce((somme, ligne) => somme + versCentimes(ligne.montant), 0);
}

// Marque d'ordre des octets : Excel lit alors le fichier en UTF-8.
const BOM = String.fromCharCode(0xfeff);

const CHAMP_CSV = (valeur: string | number | null) => {
  const texte = valeur === null ? "" : String(valeur);
  return /[;"\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
};

/** Export pour le comptable : CSV séparé par des points-virgules, montants à la française, BOM pour Excel. */
export function livreEnCsv(lignes: LigneLivre[]): string {
  const entete = ["Date d'encaissement", "Client", "Nature de la prestation", "Pièces justificatives", "Mode de règlement", "Référence", "Montant (€)", "Mouvement", "Motif"];
  const libelleMouvement: Record<MouvementLivre, string> = { RECETTE: "Recette", ANNULATION: "Annulation", REJET: "Chèque rejeté" };
  const corps = lignes.map((ligne) =>
    [
      `${ligne.jour.slice(8, 10)}/${ligne.jour.slice(5, 7)}/${ligne.jour.slice(0, 4)}`,
      ligne.client,
      ligne.nature,
      ligne.pieces,
      ligne.moyen,
      ligne.reference,
      (versCentimes(ligne.montant) / 100).toFixed(2).replace(".", ","),
      libelleMouvement[ligne.mouvement],
      ligne.motif,
    ]
      .map(CHAMP_CSV)
      .join(";")
  );
  return `${BOM}${[entete.join(";"), ...corps].join("\r\n")}\r\n`;
}
