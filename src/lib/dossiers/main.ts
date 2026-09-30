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
// Exceptions (mission 14). Un message du client (mail rattaché, message dans
// son espace) resté sans réponse m'épingle la main, « Répondre à {nom} », quel
// que soit le geste ou le changement d'étape plus récent, jusqu'à ma réponse
// (mail, réponse dans l'espace, SMS hors accusé automatique, appel abouti) ;
// un mail rangé, traité, automatique ou déplacé dans un autre dossier ne
// compte pas. Un devis (généré, rendu visible, déposé) ne passe la main au
// client que s'il attend encore sa réponse : visible, émis ou envoyé, non
// archivé. Un devis déposé la passe à la date du dépôt, et seulement avant la
// signature (Qualification → Relance) ; après, l'étape décide.
//
// `mainSelonFaits` est pure ; `recalculerMain` l'applique au dossier et range
// le résultat dans `Dossier.main / mainLe / mainMotif`, relus par les écrans.

import { prisma } from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { porteLienEspace } from "@/lib/sms/catalogue";
import { LIBELLES_ETAPE, LIBELLES_TYPE_DOCUMENT, REGLES_ETAPES, type EtapeDossier } from "./constants";

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

// Les SMS partis par le fournisseur (SMS_ENVOYE) qui portaient le lien, reconnus à leur modèle (préfixe : les
// variantes d'hier comprises, car la main se recalcule sur tout l'historique). Les SMS copiés se lisent au texte.
const MODELES_LIEN = /^(LIEN_ESPACE|INJOIGNABLE_LIEN|RELANCE_PHOTOS|SIMULATION_PRETE)/;

const MOTIF_DEVIS_ENVOYE = "Devis envoyé : en attente de sa réponse";
const MOTIF_LIEN_ENVOYE = "Lien de son espace envoyé : en attente du client";
const MOTIF_ESPACE_OUVERT = "Espace ouvert : en attente du client";
/** Mission 14 (partie 6) : une relance de devis copiée (SMS) ; le mail de relance garde « Mail envoyé : … ». */
export const MOTIF_RELANCE_ENVOYEE = "Relance envoyée : en attente de sa réponse";

/**
 * Mission 14 (partie 6) : les motifs des événements de lien (espace ouvert, lien communiqué, SMS du lien, nouveau
 * lien) ne supposent plus ce qui manque au client — l'espace le dit (`espace/suivi.ts`, d'après son étape : photos,
 * projet, choix de simulation…). Reconnaît aussi les motifs d'avant, rangés sur les dossiers jusqu'à leur recalcul.
 */
export const estMotifDeLien = (motif: string | null | undefined): boolean =>
  /^(Espace ouvert|Lien de son espace (envoyé|communiqué)|Nouveau lien envoyé) : en attente /.test(motif ?? "");

/** Les étapes où un devis déposé passe la main au client : avant la signature. Après, l'étape (déclarée à la reprise) décide. */
const ETAPES_DEPOT_DEVIS: readonly EtapeDossier[] = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"];

/** Statuts d'un devis qui attend encore la réponse du client (les mêmes que devis-envoye.ts, qui importe ce module). */
const STATUTS_EN_ATTENTE = ["GENERE", "ENVOYE"];

/**
 * Un DOCUMENT_REPRIS qui est un devis visible en attente de réponse, d'après l'événement seul. Depuis la mission 14,
 * la metadata porte type, statut et visibilité ; avant, seul le contenu (« Devis 2026-043 … ») disait qu'il
 * s'agissait d'un devis. `calculerMain` relit en plus l'état actuel du document (voir `devisEnAttente`).
 */
function devisDeposeVisible(evenement: EvenementLu): boolean {
  const meta = lireMetadata(evenement.metadata);
  if (typeof meta.type !== "string") return evenement.contenu.startsWith(`${LIBELLES_TYPE_DOCUMENT.DEVIS} `);
  const statut = typeof meta.statut === "string" ? meta.statut : "ENVOYE";
  return meta.type === "DEVIS" && meta.visibleEspace !== false && STATUTS_EN_ATTENTE.includes(statut);
}

/** Mission 14 (R2) : le motif d'un message du client resté sans réponse — la main m'est épinglée jusqu'à ma réponse. */
export function motifRepondre(nom: string | null | undefined): string {
  const propre = nom?.trim();
  return propre ? `Répondre à ${propre}` : "Répondre au client";
}
export const estMotifRepondre = (motif: string | null | undefined): boolean => /^Répondre (à |au client$)/.test(motif ?? "");

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
      return { qui: "CLIENT", motif: MOTIF_DEVIS_ENVOYE };
    // Mission 14 : un devis déposé (fait ailleurs), visible et en attente de réponse, vaut un devis émis.
    case "DOCUMENT_REPRIS":
      return devisDeposeVisible(evenement) ? { qui: "CLIENT", motif: MOTIF_DEVIS_ENVOYE } : null;
    // Mission 14 (partie 6) : motif générique ; ce qu'il a à faire se lit sur l'étape de son espace (espace/suivi.ts).
    case "ESPACE_LIEN_CREE":
      return { qui: "CLIENT", motif: MOTIF_ESPACE_OUVERT };
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
      return { qui: "CLIENT", motif: MOTIF_LIEN_ENVOYE };
    case "SMS_ENVOYE": {
      const meta = lireMetadata(evenement.metadata);
      const lien = meta.origine === "LIEN_ESPACE" || (typeof meta.modele === "string" && MODELES_LIEN.test(meta.modele));
      return lien ? { qui: "CLIENT", motif: MOTIF_LIEN_ENVOYE } : null;
    }
    // Mission 14 (partie 5) : un SMS copié par Lucas (copier vaut envoi) dont le texte porte le lien de son espace,
    // quel que soit son code (texte libre compris) — la règle de « Lien pas encore envoyé » (`porteLienEspace`).
    // Partie 6 : une relance de devis copiée passe la main au client comme le mail de relance, lien ou non.
    case "SMS_COPIE": {
      const meta = lireMetadata(evenement.metadata);
      const relance = meta.relance && typeof meta.relance === "object" ? (meta.relance as Record<string, unknown>) : null;
      if (relance && typeof relance.documentId === "string") return { qui: "CLIENT", motif: MOTIF_RELANCE_ENVOYEE };
      return porteLienEspace(typeof meta.texte === "string" ? meta.texte : evenement.contenu) ? { qui: "CLIENT", motif: MOTIF_LIEN_ENVOYE } : null;
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
    // Mission 15 (partie 5) : sa simulation est restée sous le seuil du contrôle — il l'attend, à moi de la relire.
    case "ESPACE_SIMULATION_RELECTURE":
      return { qui: "MOI", motif: "Simulation du client à relire et publier" };
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
  "ESPACE_SIMULATION_RELECTURE",
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
  "DOCUMENT_REPRIS",
  "SMS_COPIE",
];

/* ── Mission 14 (R2) : un message du client sans réponse ─────────────────────── */

/** Ce qui répond à un message du client : un mail, une réponse dans l'espace, un SMS (pas l'accusé automatique), un appel abouti. */
export function estReponse(evenement: EvenementLu): boolean {
  switch (evenement.type) {
    case "MAIL_ENVOYE":
    case "ESPACE_REPONSE":
      return evenement.direction === "SORTANT";
    case "SMS_ENVOYE":
      return lireMetadata(evenement.metadata).origine !== "ACCUSE_AUTO";
    // SMS rendu « à copier » par le CRM et envoyé par Lucas depuis son téléphone (mission 14, partie 5).
    case "SMS_COPIE":
      return true;
    case "APPEL":
      return lireMetadata(evenement.metadata).issue !== "PAS_DE_REPONSE";
    default:
      return false;
  }
}

/** Un message du client : un mail rattaché au dossier, ou un message écrit dans son espace. */
const estMessageEntrant = (evenement: EvenementLu) => (evenement.type === "MAIL_RECU" || evenement.type === "ESPACE_MESSAGE") && evenement.direction === "ENTRANT";

const TYPES_REPONSE = ["MAIL_ENVOYE", "ESPACE_REPONSE", "SMS_ENVOYE", "SMS_COPIE", "APPEL"];
const TYPES_LUS = [...new Set([...TYPES_MAIN, ...TYPES_REPONSE])];

/**
 * Le dernier message du client resté sans réponse (du plus récent au plus ancien : la première réponse
 * rencontrée clôt tout ce qui la précède). `repondu` dit si un mail a eu sa réponse ailleurs (dans son fil).
 */
export async function messageSansReponse(
  evenements: readonly (EvenementLu & { le: Date })[],
  repondu: (evenement: EvenementLu) => Promise<boolean> = async () => false
): Promise<MessageSansReponse | null> {
  const recents = evenements.map((e, i) => ({ e, i })).sort((a, b) => b.e.le.getTime() - a.e.le.getTime() || a.i - b.i).map((x) => x.e);
  for (const evenement of recents) {
    if (estReponse(evenement)) return null;
    if (!estMessageEntrant(evenement)) continue;
    return (await repondu(evenement)) ? null : { le: evenement.le, type: evenement.type, contenu: evenement.contenu };
  }
  return null;
}

/** Le message du client resté sans réponse : sa date, son type (MAIL_RECU, ESPACE_MESSAGE) et le texte de l'événement. */
export type MessageSansReponse = { le: Date; type: string; contenu: string };

const MINUTE = 60_000;

export type FaitsMain = {
  etape: EtapeDossier;
  /** Événements du dossier (non archivés), du plus récent au plus ancien (à date égale, l'ordre donné départage). */
  evenements: (EvenementLu & { le: Date })[];
  /** Mission 14 (R2) : le dernier message du client (mail rattaché, message d'espace) resté sans réponse. */
  messageSansReponse?: { le: Date } | null;
  /** Le nom du client (Dossier.clientNom), pour « Répondre à … ». */
  nom?: string | null;
};

/**
 * Qui a la main, d'après l'étape et les derniers gestes. Dossier perdu ou
 * encaissé : personne. Un message du client sans réponse : à moi, « Répondre à
 * {nom} », quel que soit le geste ou le changement d'étape plus récent, jusqu'à
 * ma réponse. Sinon le geste le plus récent (un devis déposé ne compte qu'avant
 * la signature) ; faute de geste depuis le dernier changement d'étape, le
 * responsable de l'étape.
 */
export function mainSelonFaits(faits: FaitsMain): MainCalculee {
  const responsable = REGLES_ETAPES[faits.etape]?.responsable ?? null;
  if (responsable === null) return { qui: null, le: null, motif: faits.etape === "PERDU" ? "Dossier perdu" : "Dossier terminé" };
  if (faits.messageSansReponse) return { qui: "MOI", le: faits.messageSansReponse.le, motif: motifRepondre(faits.nom) };
  const tries = faits.evenements.map((e, i) => ({ e, i })).sort((a, b) => a.e.le.getTime() - b.e.le.getTime() || b.i - a.i).map((x) => x.e);
  const changement = tries.filter((e) => e.type === "CHANGEMENT_ETAPE").at(-1) ?? null;
  // Un devis déposé ne passe la main qu'avant la signature : sur un dossier signé (ou repris plus loin), l'étape décide.
  const depotCompte = ETAPES_DEPOT_DEVIS.includes(faits.etape);
  const gestes = tries
    .filter((e) => depotCompte || e.type !== "DOCUMENT_REPRIS")
    .map((e) => ({ e, passage: passageDeMain(e) }))
    .filter((x): x is { e: EvenementLu & { le: Date }; passage: Passage } => x.passage !== null);
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

/**
 * Un devis déposé passe la main au moment du dépôt (mission 14), pas à sa date d'émission, souvent plus ancienne.
 * Sauf pendant la reprise d'un dossier entier (`reprise: true`) : le parcours y est daté du passé, le dépôt aussi.
 */
function dateDuGeste(evenement: { type: string; metadata: string; createdAt: Date; survenuLe: Date | null }): Date {
  if (evenement.type === "DOCUMENT_REPRIS") {
    const meta = lireMetadata(evenement.metadata);
    if (typeof meta.type === "string" && meta.reprise !== true) return evenement.createdAt;
  }
  return evenement.survenuLe ?? evenement.createdAt;
}

const idDe = (cle: "messageId" | "documentId") => (evenement: EvenementLu): string | null => {
  const id = lireMetadata(evenement.metadata)[cle];
  return typeof id === "string" ? id : null;
};
const idMessage = idDe("messageId");
const idDocument = idDe("documentId");
const nonNul = (id: string | null): id is string => id !== null;

/** Les événements d'un devis dont le passage de main dépend de l'état ACTUEL du devis. */
const TYPES_DEVIS = ["DEVIS_GENERE", "DEVIS_ENVOYE", "DOCUMENT_REPRIS"];

/** Un devis qui attend encore la réponse du client : visible dans son espace, émis ou envoyé, non archivé. */
const devisEnAttente = (document: { type: string; statut: string; visibleEspace: boolean; archiveLe: Date | null }) =>
  document.type === "DEVIS" && !document.archiveLe && document.visibleEspace && STATUTS_EN_ATTENTE.includes(document.statut);

/**
 * Les faits de la règle pour un dossier, lus en base (événements non archivés, mails et devis relus) : la même
 * lecture pour la main (`calculerMain`) et pour le contrôle de cohérence (message du client sans réponse).
 */
export async function lireFaitsMain(dossierId: string): Promise<(FaitsMain & { messageSansReponse: MessageSansReponse | null }) | null> {
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { etape: true, clientNom: true } });
  if (!dossier) return null;
  const lus = await prisma.dossierEvenement.findMany({
    where: { dossierId, archiveLe: null, type: { in: TYPES_LUS } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 60,
    select: { type: true, direction: true, metadata: true, contenu: true, createdAt: true, survenuLe: true },
  });
  const evenements = lus.map((e) => ({ ...e, le: dateDuGeste(e) }));
  // Mission 14 (R2) : un mail reçu que Lucas a rangé ou traité (« pas de réponse à faire »), automatique, archivé
  // ou déplacé dans un autre dossier ne compte plus.
  const idsMessages = evenements.filter((e) => e.type === "MAIL_RECU").map(idMessage).filter(nonNul);
  const messages = idsMessages.length
    ? await prisma.message.findMany({ where: { id: { in: idsMessages }, archiveLe: null }, select: { id: true, dossierId: true, automatique: true, rangeLe: true, traiteLe: true, canal: true, filCanal: true, recuLe: true } })
    : [];
  const parId = new Map(messages.map((m) => [m.id, m]));
  // Mission 14 : un devis masqué, annulé, accepté, refusé ou archivé depuis ne dit plus « en attente de sa réponse ».
  const idsDocuments = evenements.filter((e) => TYPES_DEVIS.includes(e.type)).map(idDocument).filter(nonNul);
  const documents = idsDocuments.length
    ? await prisma.document.findMany({ where: { id: { in: idsDocuments }, ...AVEC_ARCHIVES }, select: { id: true, type: true, statut: true, visibleEspace: true, archiveLe: true } })
    : [];
  const documentsParId = new Map(documents.map((d) => [d.id, d]));
  const retenus = evenements.filter((e) => {
    if (TYPES_DEVIS.includes(e.type)) {
      const document = documentsParId.get(idDocument(e) ?? "");
      // Sans document retrouvé (événement sans identifiant), l'événement seul décide (passageDeMain).
      return !document || devisEnAttente(document);
    }
    const id = e.type === "MAIL_RECU" ? idMessage(e) : null;
    if (!id) return true;
    const message = parId.get(id);
    return Boolean(message && !message.automatique && !message.rangeLe && !message.traiteLe && (!message.dossierId || message.dossierId === dossierId));
  });
  // Une réponse partie dans le même fil de mails compte, même si elle n'est pas tracée sur le dossier.
  const repondu = async (e: EvenementLu) => {
    const message = e.type === "MAIL_RECU" ? parId.get(idMessage(e) ?? "") : undefined;
    if (!message?.filCanal) return false;
    const reponse = await prisma.message.findFirst({ where: { canal: message.canal, filCanal: message.filCanal, sens: "SORTANT", automatique: false, archiveLe: null, recuLe: { gt: message.recuLe } }, select: { id: true } });
    return reponse !== null;
  };
  return {
    etape: dossier.etape as EtapeDossier,
    evenements: retenus.filter((e) => TYPES_MAIN.includes(e.type)),
    messageSansReponse: await messageSansReponse(retenus, repondu),
    nom: dossier.clientNom,
  };
}

/** La main telle que la règle la donne aujourd'hui, sans rien écrire (contrôle de cohérence, migration). */
export async function calculerMain(dossierId: string): Promise<MainCalculee | null> {
  const faits = await lireFaitsMain(dossierId);
  return faits ? mainSelonFaits(faits) : null;
}

/** Mission 14 (R2) : des mails rangés, traités, archivés ou remis « à traiter » — la main de leurs dossiers est relue. Jamais bloquant. */
export async function recalculerMainDesMessages(messageIds: readonly string[]): Promise<void> {
  if (messageIds.length === 0) return;
  try {
    const messages = await prisma.message.findMany({ where: { id: { in: [...messageIds] }, dossierId: { not: null }, ...AVEC_ARCHIVES }, select: { dossierId: true } });
    for (const dossierId of new Set(messages.map((m) => m.dossierId))) await recalculerMain(dossierId);
  } catch (erreur) {
    console.error("[main] recalcul après un geste sur des mails :", erreur);
  }
}

/** Tous les dossiers vivants d'un client (un lien envoyé vaut pour ses projets en cours). */
export async function recalculerMainDuClient(clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  const dossiers = await prisma.dossier.findMany({ where: { clientId, archiveLe: null }, select: { id: true } });
  for (const d of dossiers) await recalculerMain(d.id);
}
