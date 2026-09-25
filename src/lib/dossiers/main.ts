// Qui a la main sur un dossier — UNE règle, lue partout (carte du kanban,
// panneau du dossier, Espaces clients, Leads, /commercial) et vérifiée chaque
// jour par le contrôle de cohérence.
//
// La main suit les gestes : je publie une simulation, j'émets un devis,
// j'envoie un lien → elle passe au client ; le client agit (photos, projet
// validé, simulation validée, demande, accord, message, SMS, mail) → elle me
// revient. Faute de geste plus récent, c'est l'étape qui dit qui doit agir
// (REGLES_ETAPES). Le plus récent l'emporte ; un geste à moins d'une minute
// d'un changement d'étape l'a causé (ou en découle) et l'emporte sur lui.
//
// `mainSelonFaits` est pure ; `recalculerMain` l'applique au dossier et range
// le résultat dans `Dossier.main / mainLe / mainMotif`, relus par les écrans.

import { prisma } from "@/lib/prisma";
import { LIBELLES_ETAPE, REGLES_ETAPES, type EtapeDossier } from "./constants";

export type QuiALaMain = "MOI" | "CLIENT";
export type MainCalculee = { qui: QuiALaMain | null; le: Date | null; motif: string };

type Passage = { qui: QuiALaMain; motif: string };
type EvenementLu = { type: string; direction: string; metadata: string; contenu: string };

const lireMetadata = (json: string): Record<string, unknown> => {
  try {
    const valeur: unknown = JSON.parse(json);
    return valeur && typeof valeur === "object" ? (valeur as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const MODELES_LIEN = /^(LIEN_ESPACE|INJOIGNABLE_LIEN|RELANCE_PHOTOS|SIMULATION_PRETE)/;

/**
 * Les événements qui passent la main, et à qui. Seuls les gestes du CLIENT
 * (direction ENTRANT) lui font revenir la main : ce que Lucas fait à sa place
 * (INTERNE) ne compte pas comme une réponse du client.
 */
export function passageDeMain(evenement: EvenementLu): Passage | null {
  const client = evenement.direction === "ENTRANT";
  switch (evenement.type) {
    // Lucas passe la main au client.
    case "ESPACE_SIMULATION_DEPOSEE":
      return { qui: "CLIENT", motif: "Simulation publiée : en attente de son retour" };
    case "DEVIS_GENERE":
    case "DEVIS_ENVOYE":
      return { qui: "CLIENT", motif: "Devis envoyé : en attente de sa réponse" };
    case "ESPACE_LIEN_CREE":
      return { qui: "CLIENT", motif: "Espace ouvert : en attente de ses photos et de son projet" };
    case "ESPACE_SIMULATIONS_ACCORDEES":
      return { qui: "CLIENT", motif: "Simulations accordées : à lui de les créer" };
    case "ESPACE_LIEN_REGENERE":
      return lireMetadata(evenement.metadata).sms ? { qui: "CLIENT", motif: "Nouveau lien envoyé : en attente du client" } : null;
    // Mission 7 : je réponds par mail (onglet Mail, dans le fil) → la main passe au client.
    // (Les notifications automatiques de l'espace sont des MAIL_NOTIFICATION : elles ne la déplacent pas.)
    case "MAIL_ENVOYE":
      return evenement.direction === "SORTANT" ? { qui: "CLIENT", motif: "Mail envoyé : en attente de sa réponse" } : null;
    // Mission 10 : je réponds dans son espace, ou je lui communique le lien par SMS (texte rendu par l'assistant).
    case "ESPACE_REPONSE":
      return evenement.direction === "SORTANT" ? { qui: "CLIENT", motif: "Réponse envoyée dans son espace : en attente de son retour" } : null;
    case "ESPACE_LIEN_COMMUNIQUE":
      return { qui: "CLIENT", motif: "Lien de son espace communiqué : en attente de ses photos" };
    case "SMS_ENVOYE": {
      const meta = lireMetadata(evenement.metadata);
      const lien = meta.origine === "LIEN_ESPACE" || (typeof meta.modele === "string" && MODELES_LIEN.test(meta.modele));
      return lien ? { qui: "CLIENT", motif: "Lien de son espace envoyé : en attente du client" } : null;
    }
    // Le client revient sur ce qu'il avait fait : c'est de nouveau à lui.
    case "ESPACE_SIMULATION_DEVALIDEE":
      return client ? { qui: "CLIENT", motif: "Il a dévalidé sa simulation : à lui de choisir" } : null;
    case "ESPACE_PROPOSITION_RETIREE":
      return client ? { qui: "CLIENT", motif: "Il a retiré sa demande d'autre proposition" } : null;
    case "ESPACE_PROJET_DEVALIDE":
      return client ? { qui: "CLIENT", motif: "Il modifie son projet" } : null;
    // Il crée lui-même ses simulations (v3) : à lui d'en valider une, rien ne m'attend.
    case "ESPACE_SIMULATION_CLIENT":
      return client ? { qui: "CLIENT", motif: "Il a créé une simulation : à lui d'en valider une" } : null;
    // Un brouillon de simulation m'attend : à moi de le relire et de le publier.
    case "SIMULATION_BROUILLON":
      return { qui: "MOI", motif: "Brouillon de simulation à publier" };
    // Le client agit : la main me revient.
    case "ESPACE_PHOTOS":
      return client ? { qui: "MOI", motif: "Photos reçues dans son espace" } : null;
    case "ESPACE_PROJET_VALIDE":
      return client ? { qui: "MOI", motif: "Projet validé par le client" } : null;
    case "ESPACE_SIMULATION_CHOISIE":
      return client ? { qui: "MOI", motif: "Simulation validée : faire le devis" } : null;
    case "ESPACE_NOUVELLE_PROPOSITION":
      return client ? { qui: "MOI", motif: "Il demande une autre proposition" } : null;
    case "ESPACE_SIMULATIONS_DEMANDEES":
      return client ? { qui: "MOI", motif: "Il demande d'autres simulations" } : null;
    case "ESPACE_COMMENTAIRE":
      return client ? { qui: "MOI", motif: "Il a commenté une simulation" } : null;
    case "ESPACE_DEVIS_ACCEPTE": {
      if (!client) return null;
      // Mission 11 : plusieurs devis proposés → le motif nomme celui qu'il a choisi.
      const meta = lireMetadata(evenement.metadata);
      const numero = typeof meta.numero === "string" ? meta.numero : null;
      const libelle = typeof meta.libelle === "string" && meta.libelle ? ` (${meta.libelle})` : "";
      return { qui: "MOI", motif: numero ? `Il a choisi le devis ${numero}${libelle} : fixer la date du chantier` : "Bon pour accord reçu : fixer la date du chantier" };
    }
    case "ESPACE_ACCORD_RETIRE":
      return client ? { qui: "MOI", motif: "Il a retiré son bon pour accord : l'appeler" } : null;
    case "ESPACE_MESSAGE":
      return client ? { qui: "MOI", motif: "Message du client dans son espace" } : null;
    case "ESPACE_NOUVEAU_PROJET":
      return client ? { qui: "MOI", motif: "Nouveau projet ouvert par le client" } : null;
    case "SMS_RECU":
      return { qui: "MOI", motif: "SMS du client reçu" };
    case "MAIL_RECU":
      return { qui: "MOI", motif: "Mail du client reçu" };
    case "WHATSAPP_RECU":
      return { qui: "MOI", motif: "Message WhatsApp du client reçu" };
    default:
      return null;
  }
}

/** Les types à relire pour recalculer la main (changements d'étape compris). */
export const TYPES_MAIN = [
  "CHANGEMENT_ETAPE",
  "ESPACE_LIEN_CREE",
  "ESPACE_SIMULATION_CLIENT",
  "SIMULATION_BROUILLON",
  "ESPACE_SIMULATION_DEPOSEE",
  "DEVIS_GENERE",
  "DEVIS_ENVOYE",
  "ESPACE_SIMULATIONS_ACCORDEES",
  "ESPACE_LIEN_REGENERE",
  "SMS_ENVOYE",
  "MAIL_ENVOYE",
  "ESPACE_SIMULATION_DEVALIDEE",
  "ESPACE_PROPOSITION_RETIREE",
  "ESPACE_PROJET_DEVALIDE",
  "ESPACE_PHOTOS",
  "ESPACE_PROJET_VALIDE",
  "ESPACE_SIMULATION_CHOISIE",
  "ESPACE_NOUVELLE_PROPOSITION",
  "ESPACE_SIMULATIONS_DEMANDEES",
  "ESPACE_COMMENTAIRE",
  "ESPACE_DEVIS_ACCEPTE",
  "ESPACE_ACCORD_RETIRE",
  "ESPACE_MESSAGE",
  "ESPACE_NOUVEAU_PROJET",
  "SMS_RECU",
  "MAIL_RECU",
  "WHATSAPP_RECU",
  "ESPACE_REPONSE",
  "ESPACE_LIEN_COMMUNIQUE",
];

const MINUTE = 60_000;

export type FaitsMain = {
  etape: EtapeDossier;
  /** Événements du dossier (non archivés), du plus récent au plus ancien (à date égale, l'ordre donné départage). */
  evenements: (EvenementLu & { le: Date })[];
};

/**
 * Qui a la main, d'après l'étape et les derniers gestes. Dossier perdu ou
 * encaissé : personne. Sinon le geste le plus récent ; faute de geste depuis le
 * dernier changement d'étape, le responsable de l'étape.
 */
export function mainSelonFaits(faits: FaitsMain): MainCalculee {
  const responsable = REGLES_ETAPES[faits.etape]?.responsable ?? null;
  if (responsable === null) return { qui: null, le: null, motif: faits.etape === "PERDU" ? "Dossier perdu" : "Dossier terminé" };
  const tries = faits.evenements.map((e, i) => ({ e, i })).sort((a, b) => a.e.le.getTime() - b.e.le.getTime() || b.i - a.i).map((x) => x.e);
  const changement = tries.filter((e) => e.type === "CHANGEMENT_ETAPE").at(-1) ?? null;
  const gestes = tries.map((e) => ({ e, passage: passageDeMain(e) })).filter((x): x is { e: EvenementLu & { le: Date }; passage: Passage } => x.passage !== null);
  const dernier = gestes.at(-1) ?? null;
  const parEtape: MainCalculee = { qui: responsable, le: changement?.le ?? null, motif: `Étape « ${LIBELLES_ETAPE[faits.etape]} »` };
  if (!dernier) return parEtape;
  if (!changement || dernier.e.le.getTime() >= changement.le.getTime() - MINUTE) return { qui: dernier.passage.qui, le: dernier.e.le, motif: dernier.passage.motif };
  return parEtape;
}

/** Recalcule la main d'un dossier et la range sur lui ; rend la valeur retenue. Jamais bloquant pour l'appelant. */
export async function recalculerMain(dossierId: string | null | undefined): Promise<MainCalculee | null> {
  if (!dossierId) return null;
  try {
    const calcul = await calculerMain(dossierId);
    if (!calcul) return null;
    await prisma.dossier.update({ where: { id: dossierId }, data: { main: calcul.qui, mainLe: calcul.le, mainMotif: calcul.motif } });
    return calcul;
  } catch (erreur) {
    console.error("[main] recalcul non écrit :", erreur);
    return null;
  }
}

/** La main telle que la règle la donne aujourd'hui, sans rien écrire (contrôle de cohérence, migration). */
export async function calculerMain(dossierId: string): Promise<MainCalculee | null> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true } });
  if (!dossier) return null;
  const evenements = await prisma.dossierEvenement.findMany({
    where: { dossierId, archiveLe: null, type: { in: TYPES_MAIN } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 60,
    select: { type: true, direction: true, metadata: true, contenu: true, createdAt: true, survenuLe: true },
  });
  return mainSelonFaits({ etape: dossier.etape as EtapeDossier, evenements: evenements.map((e) => ({ ...e, le: e.survenuLe ?? e.createdAt })) });
}

/** Tous les dossiers vivants d'un client (un lien envoyé vaut pour ses projets en cours). */
export async function recalculerMainDuClient(clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const dossiers = await prisma.dossier.findMany({ where: { clientId, archiveLe: null }, select: { id: true } });
  for (const d of dossiers) await recalculerMain(d.id);
}
