// Synthèse d'une période, sous forme structurée. Aucune dépendance serveur.
//
// Elle ne contient AUCUN nom de personne : les clients et dossiers y sont
// désignés par leur identifiant, et leurs noms sont résolus au moment de
// l'affichage (ou remplacés par des pseudonymes en mode anonymisé). Une
// synthèse figée (instantané mensuel) reste ainsi compatible avec
// l'anonymisation d'un client (RGPD).

import type { CleParametre } from "@/lib/parametres/definitions";

export const VERSION_SYNTHESE = 1;

export type Repartition = { cle: string; libelle: string; valeur: number };

export type Synthese = {
  version: number;
  periode: { du: string; au: string; libelle: string };
  calculeLe: string;

  commercial: {
    /** Cohorte : dossiers ouverts dans la période, suivis jusqu'à aujourd'hui. */
    cohorte: {
      ouverts: number;
      devisEnvoyes: number;
      signes: number;
      encaisses: number;
      perdus: number;
      enCours: number;
      tauxSignatureDevis: number | null;
      parSource: { cle: string; libelle: string; ouverts: number; signes: number }[];
    };
    /** Ce qui s'est passé dans la période, quel que soit l'âge du dossier. */
    activite: {
      devisEmis: number;
      montantDevis: number;
      signatures: number;
      montantSigne: number;
      facturesEmises: number;
      montantFacture: number;
      avoirs: number;
      montantAvoirs: number;
      pertes: number;
    };
    delais: { cle: string; libelle: string; medianeJours: number | null; nombre: number }[];
    /** Écart moyen entre le premier devis et le devis signé, pour les signatures de la période. */
    ecartPrixMoyenPct: number | null;
    pertes: {
      parMotif: Repartition[];
      parEtape: Repartition[];
      montantPropose: number;
      concurrents: { nom: string; nombre: number; ecartMoyenPct: number | null }[];
    };
  };

  finances: {
    /** null : paramètres à renseigner (voir parametresManquants). */
    encaisse: number | null;
    parametresManquants: CleParametre[];
    parMois: { mois: string; montant: number }[];
    parFamilleSource: Repartition[];
    parCategorieClient: Repartition[];
    parDepartement: Repartition[];
    depenses: number;
    depensesParCategorie: Repartition[];
    margeBrute: number | null;
    panierMoyenSigne: number | null;
    panierMoyenFacture: number | null;
    /** Au moment du calcul (pour un instantané : au moment du gel). */
    encours: { total: number; plus30Jours: number; factures: number };
    margesDossiers: { dossierId: string; clientId: string | null; facture: number; depenses: number; marge: number; margePct: number | null }[];
  };

  clients: {
    nouveaux: number;
    parFamilleSource: Repartition[];
    campagnes: Repartition[];
    recommandations: number;
    recommandeurs: { clientId: string; nombre: number }[];
    relationnelContrePayant: { nouveauxRelationnel: number; nouveauxPayant: number; caRelationnel: number | null; caPayant: number | null };
    recurrents: { clients: number; partCa: number | null };
    inactifs: { nombre: number; clientIds: string[] };
  };

  agent: {
    parAuteur: {
      auteur: string;
      proposees: number;
      validees: number;
      modifiees: number;
      rejetees: number;
      expirees: number;
      enAttente: number;
      tauxAcceptation: number | null;
      delaiDecisionMedianHeures: number | null;
    }[];
    motifsRejet: Repartition[];
  };

  qualite: Repartition[];
};

/** Noms à afficher, résolus à la lecture (ou pseudonymes). */
export type References = { clients: Record<string, string>; dossiers: Record<string, string> };

export type Alerte = {
  code: string;
  gravite: "URGENT" | "ATTENTION" | "INFO";
  titre: string;
  detail: string;
  lien: string | null;
};
