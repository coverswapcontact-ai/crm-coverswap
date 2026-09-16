import prisma from "@/lib/prisma";
import { dateDepuisJour, jourParis } from "@/lib/dossiers/dates";
import { versCentimes } from "@/lib/dossiers/montants";
import { lireDestinataire } from "@/lib/dossiers/documents";
import type { CleParametre } from "@/lib/parametres/definitions";
import { historiqueParametres } from "@/lib/parametres/service";
import { CLES_CALCULS, calculerSeuils, calculerUrssaf, trancheRetard, type Seuil, type TrancheRetard, type Urssaf } from "./calculs";
import { chargerLivre, totalCentimes, type LigneLivre } from "./livre";
import { ecartJours, periodeDe, periodePrecedente, type Periodicite } from "./periodes";

export type LigneEncours = {
  registreId: string;
  numero: string;
  origine: string;
  client: string;
  dossierId: string | null;
  emiseLe: string | null;
  echeance: string | null;
  montant: number;
  regle: number;
  reste: number;
  joursRetard: number | null;
  tranche: TrancheRetard;
};

export type ChequeACrediter = {
  id: string;
  payeur: string;
  montant: number;
  reference: string | null;
  recuLe: string;
  joursDepuisReception: number;
  dossierId: string | null;
};

export type PointQualite = { code: string; libelle: string; detail: string[]; lien: string | null };

type Section<T> = { etat: "OK"; donnees: T } | { etat: "PARAMETRES"; manquants: CleParametre[] };

export type TableauFinances = {
  annee: number;
  aujourdhui: string;
  recettes: Section<{
    lignes: LigneLivre[];
    parMois: number[];
    total: number;
    anneePrecedente: number;
  }>;
  urssaf: Section<{ periodicite: Periodicite; aDeclarer: Urssaf; enCours: Urssaf }>;
  seuils: Section<{ seuils: Seuil[]; anneePrecedente: number }>;
  encours: { lignes: LigneEncours[]; total: number };
  cheques: ChequeACrediter[];
  qualite: PointQualite[];
};

/** Créances ouvertes : factures actives non réglées, du CRM comme d'ailleurs (montant connu). */
async function chargerEncours(aujourdhui: string): Promise<LigneEncours[]> {
  const lignes = await prisma.numeroDocument.findMany({
    where: { type: "FACTURE" },
    include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
  });
  const documents = await prisma.document.findMany({
    where: { id: { in: lignes.map((ligne) => ligne.documentId).filter((id): id is string => Boolean(id)) } },
    select: { id: true, statut: true, totalHt: true, dateEmission: true, echeanceLe: true, destinataire: true, dossierId: true },
  });
  const documentDe = new Map(documents.map((document) => [document.id, document]));

  return lignes
    .flatMap((ligne): LigneEncours[] => {
      const document = ligne.documentId ? documentDe.get(ligne.documentId) : undefined;
      if (document?.statut === "ANNULEE") return [];
      const montant = document ? document.totalHt : ligne.montant;
      if (montant === null || montant === undefined) return [];
      const regle = ligne.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
      const reste = versCentimes(montant) - regle;
      if (reste <= 0) return [];
      const emise = document?.dateEmission ?? ligne.emisLe;
      // Particulier : paiement à réception, l'échéance est la date d'émission.
      const echeance = document?.echeanceLe ?? emise;
      const echeanceJour = echeance ? jourParis(echeance) : null;
      return [
        {
          registreId: ligne.id,
          numero: ligne.numero,
          origine: ligne.origine,
          client: (document ? lireDestinataire(document.destinataire)?.nom : null) ?? ligne.destinataire ?? "Client non renseigné",
          dossierId: document?.dossierId ?? null,
          emiseLe: emise ? jourParis(emise) : null,
          echeance: echeanceJour,
          montant,
          regle: regle / 100,
          reste: reste / 100,
          ...trancheRetard(echeanceJour, aujourdhui),
        },
      ];
    })
    .sort((a, b) => (b.joursRetard ?? -1) - (a.joursRetard ?? -1));
}

async function chargerCheques(aujourdhui: string): Promise<ChequeACrediter[]> {
  const cheques = await prisma.encaissement.findMany({
    where: { moyen: "CHEQUE", statut: "VALIDE", crediteLe: null },
    orderBy: { recuLe: "asc" },
  });
  return cheques.map((cheque) => ({
    id: cheque.id,
    payeur: cheque.payeur,
    montant: cheque.montant,
    reference: cheque.reference,
    recuLe: jourParis(cheque.recuLe),
    joursDepuisReception: ecartJours(jourParis(cheque.recuLe), aujourdhui),
    dossierId: cheque.dossierId,
  }));
}

/** Ce qui rend les chiffres incomplets ou douteux : à corriger, pas à cacher. */
async function chargerQualite(cheques: ChequeACrediter[]): Promise<PointQualite[]> {
  const [moyensInconnus, anciensSansDate, horsCrmSansMontant, encaisses, valides] = await Promise.all([
    prisma.encaissement.findMany({ where: { moyen: null, statut: "VALIDE" }, select: { payeur: true, montant: true, recuLe: true } }),
    prisma.facture.findMany({
      where: { OR: [{ acompteRecu: true, acompteDate: null }, { soldeRecu: true, soldeDate: null }] },
      select: { numero: true },
    }),
    prisma.numeroDocument.findMany({ where: { type: "FACTURE", documentId: null, montant: null }, select: { numero: true } }),
    prisma.dossier.findMany({ where: { etape: "ENCAISSE", encaissements: { none: { statut: "VALIDE" } } }, select: { id: true, clientNom: true } }),
    prisma.encaissement.findMany({
      where: { statut: "VALIDE" },
      select: { payeur: true, montant: true, dossierId: true, affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
    }),
  ]);
  const nonImputes = valides.filter(
    (encaissement) => versCentimes(encaissement.montant) - encaissement.affectations.reduce((somme, a) => somme + versCentimes(a.montant), 0) > 0
  );
  const vieuxCheques = cheques.filter((cheque) => cheque.joursDepuisReception > 15);

  const points: PointQualite[] = [
    {
      code: "MOYEN_INCONNU",
      libelle: "Paiements repris sans mode de règlement (à compléter pour le livre des recettes)",
      detail: moyensInconnus.map((e) => `${e.payeur} · ${e.montant.toFixed(2).replace(".", ",")} € · ${jourParis(e.recuLe)}`),
      lien: null,
    },
    {
      code: "ANCIEN_SANS_DATE",
      libelle: "Paiements cochés dans l'ancien écran sans date : à saisir à la main",
      detail: anciensSansDate.map((facture) => facture.numero),
      lien: null,
    },
    {
      code: "HORS_CRM_SANS_MONTANT",
      libelle: "Factures émises hors CRM sans montant au registre : leur encaissement ne peut pas être suivi",
      detail: horsCrmSansMontant.map((ligne) => ligne.numero),
      lien: "/numeros",
    },
    {
      code: "ENCAISSE_SANS_PAIEMENT",
      libelle: "Dossiers « Encaissé » sans paiement enregistré (encaissés avant le suivi des paiements)",
      detail: encaisses.map((dossier) => dossier.clientNom),
      lien: "/dossiers",
    },
    {
      code: "NON_IMPUTE",
      libelle: "Sommes reçues non imputées sur une facture (trop-perçu, facture à refaire)",
      detail: nonImputes.map((e) => `${e.payeur} · ${e.montant.toFixed(2).replace(".", ",")} €`),
      lien: null,
    },
    {
      code: "CHEQUE_NON_CREDITE",
      libelle: "Chèques reçus depuis plus de 15 jours et pas encore crédités",
      detail: vieuxCheques.map((cheque) => `${cheque.payeur} · ${cheque.recuLe}`),
      lien: null,
    },
  ];
  return points.filter((point) => point.detail.length > 0);
}

export async function chargerTableauFinances(annee: number, maintenant: Date = new Date()): Promise<TableauFinances> {
  const aujourdhui = jourParis(maintenant);
  const lire = await historiqueParametres(CLES_CALCULS);

  const [livre, livrePrecedent, encoursLignes, cheques] = await Promise.all([
    chargerLivre(`${annee}-01-01`, `${annee}-12-31`),
    chargerLivre(`${annee - 1}-01-01`, `${annee - 1}-12-31`),
    chargerEncours(aujourdhui),
    chargerCheques(aujourdhui),
  ]);
  const qualite = await chargerQualite(cheques);
  const encours = { lignes: encoursLignes, total: encoursLignes.reduce((somme, ligne) => somme + versCentimes(ligne.reste), 0) / 100 };

  const manquantsLivre = [...new Set([...livre.manquants, ...livrePrecedent.manquants])];
  if (manquantsLivre.length > 0) {
    const bloque = { etat: "PARAMETRES" as const, manquants: manquantsLivre };
    return { annee, aujourdhui, recettes: bloque, urssaf: bloque, seuils: bloque, encours, cheques, qualite };
  }

  const parMois = Array.from({ length: 12 }, (_, index) =>
    totalCentimes(livre.lignes.filter((ligne) => Number(ligne.jour.slice(5, 7)) === index + 1)) / 100
  );
  const total = totalCentimes(livre.lignes) / 100;
  const anneePrecedente = totalCentimes(livrePrecedent.lignes) / 100;

  // URSSAF : la période en cours et celle qui la précède (à déclarer), selon la périodicité du jour.
  let urssaf: TableauFinances["urssaf"];
  const periodicite = lire("PERIODICITE_DECLARATION", dateDepuisJour(aujourdhui)) as Periodicite | null;
  if (!periodicite) {
    urssaf = { etat: "PARAMETRES", manquants: ["PERIODICITE_DECLARATION"] };
  } else {
    const enCours = periodeDe(aujourdhui, periodicite);
    const aDeclarer = periodePrecedente(enCours, periodicite);
    const debut = aDeclarer.debut < `${annee}-01-01` ? aDeclarer.debut : `${annee}-01-01`;
    const lignesUtiles = debut < `${annee}-01-01` ? (await chargerLivre(debut, aujourdhui)).lignes : livre.lignes;
    const calculEnCours = calculerUrssaf(lignesUtiles, enCours, lire);
    const calculADeclarer = calculerUrssaf(lignesUtiles, aDeclarer, lire);
    const manquants = [...new Set([...calculEnCours.manquants, ...calculADeclarer.manquants])];
    urssaf =
      manquants.length > 0 || !calculEnCours.urssaf || !calculADeclarer.urssaf
        ? { etat: "PARAMETRES", manquants }
        : { etat: "OK", donnees: { periodicite, aDeclarer: calculADeclarer.urssaf, enCours: calculEnCours.urssaf } };
  }

  const calculSeuils = calculerSeuils({ annee, aujourdhui, chiffreAffaires: total }, lire);
  const seuils: TableauFinances["seuils"] =
    calculSeuils.manquants.length > 0
      ? { etat: "PARAMETRES", manquants: calculSeuils.manquants }
      : { etat: "OK", donnees: { seuils: calculSeuils.seuils, anneePrecedente } };

  return {
    annee,
    aujourdhui,
    recettes: { etat: "OK", donnees: { lignes: livre.lignes, parMois, total, anneePrecedente } },
    urssaf,
    seuils,
    encours,
    cheques,
    qualite,
  };
}
