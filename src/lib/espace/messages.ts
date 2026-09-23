import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { recalculerMain } from "@/lib/dossiers/main";
import { resoudreContexte } from "@/lib/journal/acteur";
import { notifierClient } from "@/lib/mail/notifications";
import { lienPourLeProjet } from "./liens";

/**
 * Les messages de l'espace client (mission 10) : ce que le client écrit —
 * « Écrire à CoverSwap », un commentaire sur une simulation, une demande
 * d'autre proposition — et ce que Lucas lui répond, depuis l'assistant ou le
 * CRM. Une seule table (`MessageEspace`), lue par l'assistant (« messages_espace »,
 * non lus d'abord), par le dossier (rubrique Messages) et par le client dans
 * l'onglet Contact de son espace. Une réponse part avec la notification de
 * l'espace (mécanique existante : un mail sobre, un bouton vers son espace) et
 * passe la main au client. Rien ne se supprime.
 */

export const SOURCES_MESSAGE_ESPACE = ["MESSAGE", "COMMENTAIRE", "PROPOSITION", "REPONSE"] as const;
export type SourceMessageEspace = (typeof SOURCES_MESSAGE_ESPACE)[number];
export const LIBELLES_SOURCE_MESSAGE: Record<SourceMessageEspace, string> = { MESSAGE: "message", COMMENTAIRE: "commentaire sur une simulation", PROPOSITION: "demande d'autre proposition", REPONSE: "réponse de CoverSwap" };

/** Un fait que le CRM ne donne pas s'écrit ainsi dans un brouillon : la réponse ne part pas tant qu'il en reste. */
export const A_COMPLETER = /\[\s*à\s+compl[ée]ter\s*\]/i;
export const MESSAGE_MIN = 2;
export const MESSAGE_MAX = 2000;

export type MessageEspaceVue = {
  id: string;
  le: string;
  dossierId: string;
  clientNom: string;
  auteur: "CLIENT" | "LUCAS";
  source: SourceMessageEspace;
  texte: string;
  simulationId: string | null;
  /** Message du client : lu par Lucas ; réponse : vue par le client. */
  luLe: string | null;
  notifieLe: string | null;
  par: string | null;
};

type Ligne = { id: string; createdAt: Date; dossierId: string; auteur: string; source: string; texte: string; simulationId: string | null; luLe: Date | null; notifieLe: Date | null; par: string | null; dossier?: { clientNom: string } };

const versVue = (m: Ligne): MessageEspaceVue => ({
  id: m.id,
  le: m.createdAt.toISOString(),
  dossierId: m.dossierId,
  clientNom: m.dossier?.clientNom ?? "",
  auteur: m.auteur === "LUCAS" ? "LUCAS" : "CLIENT",
  source: (SOURCES_MESSAGE_ESPACE as readonly string[]).includes(m.source) ? (m.source as SourceMessageEspace) : "MESSAGE",
  texte: m.texte,
  simulationId: m.simulationId,
  luLe: m.luLe?.toISOString() ?? null,
  notifieLe: m.notifieLe?.toISOString() ?? null,
  par: m.par,
});

/** Ce que le client vient d'écrire (appelé par `envoyerMessage`, `commenterSimulation`, `demanderProposition`). Jamais bloquant. */
export async function enregistrerMessageClient(entree: { dossierId: string; espaceId?: string | null; source: Exclude<SourceMessageEspace, "REPONSE">; texte: string; simulationId?: string | null; evenementId?: string | null }): Promise<string | null> {
  const texte = entree.texte.trim().slice(0, MESSAGE_MAX);
  if (!texte) return null;
  try {
    const m = await prisma.messageEspace.create({ data: { dossierId: entree.dossierId, espaceId: entree.espaceId ?? null, auteur: "CLIENT", source: entree.source, texte, simulationId: entree.simulationId ?? null, evenementId: entree.evenementId ?? null } });
    return m.id;
  } catch (erreur) {
    console.error("[espace] message du client non rangé dans les messages :", erreur);
    return null;
  }
}

export async function messagesEspace(options: { dossierId?: string | null; nonLus?: boolean; limite?: number } = {}): Promise<MessageEspaceVue[]> {
  const lignes = await prisma.messageEspace.findMany({
    where: { archiveLe: null, ...(options.dossierId ? { dossierId: options.dossierId } : {}), ...(options.nonLus ? { auteur: "CLIENT", luLe: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limite ?? 30,
    include: { dossier: { select: { clientNom: true } } },
  });
  return lignes.map(versVue);
}

export async function compterMessagesNonLus(): Promise<number> {
  return prisma.messageEspace.count({ where: { archiveLe: null, auteur: "CLIENT", luLe: null } });
}

/** Lucas a lu (répondu, ou dit « c'est lu ») : les messages du client de ce dossier sont marqués. */
export async function marquerMessagesLus(dossierId: string): Promise<number> {
  const { count } = await prisma.messageEspace.updateMany({ where: { dossierId, auteur: "CLIENT", luLe: null }, data: { luLe: new Date() } });
  return count;
}

/** Le client a ouvert l'onglet Contact : les réponses de ses projets sont vues. */
export async function marquerReponsesVues(dossierIds: string[]): Promise<number> {
  if (dossierIds.length === 0) return 0;
  const { count } = await prisma.messageEspace.updateMany({ where: { dossierId: { in: dossierIds }, auteur: "LUCAS", luLe: null }, data: { luLe: new Date() } });
  return count;
}

export function verifierTexteReponse(texte: string): string {
  const propre = texte.trim();
  if (propre.length < MESSAGE_MIN) throw new ErreurMetier("La réponse est vide.", 400);
  if (propre.length > MESSAGE_MAX) throw new ErreurMetier(`Réponse trop longue (${MESSAGE_MAX} caractères au plus).`, 400);
  if (A_COMPLETER.test(propre)) throw new ErreurMetier("La réponse contient « [à compléter] » : complète-la (ou demande à Lucas) avant d'envoyer.", 409);
  return propre;
}

export type ReponseEnvoyee = { message: MessageEspaceVue; notification: { programme: boolean; raison?: string }; lien: string | null; clientNom: string; messagesLus: number };

/**
 * Lucas répond dans l'espace : le message est visible dans l'onglet Contact du
 * client ; la notification de l'espace (mail, si l'adresse est connue) part par
 * la mécanique existante ; les messages du client sont marqués lus ; la main
 * passe au client. Refusé si l'espace n'est pas ouvert, ou si un « [à compléter] » reste.
 */
export async function repondreDansLEspace(dossierId: string, texte: string, options: { commande?: string | null } = {}): Promise<ReponseEnvoyee> {
  const propre = verifierTexteReponse(texte);
  const dossier = await prisma.dossier.findUnique({ where: { id: dossierId }, select: { id: true, clientNom: true, archiveLe: true, espaces: { where: { archiveLe: null }, take: 1 } } });
  if (!dossier || dossier.archiveLe) throw new ErreurMetier("Dossier introuvable ou archivé.", 404);
  const espace = dossier.espaces[0] ?? null;
  if (!espace) throw new ErreurMetier(`${dossier.clientNom} n'a pas d'espace client : ouvre-le d'abord (outil « lien_espace »), il pourra alors y lire la réponse.`, 409);
  const lien = await lienPourLeProjet(espace);
  if (!lien) throw new ErreurMetier("L'espace de ce client est désactivé : régénère son lien avant de lui répondre dedans.", 409);
  const { acteur } = await resoudreContexte();
  const message = await prisma.messageEspace.create({ data: { dossierId, espaceId: espace.id, auteur: "LUCAS", source: "REPONSE", texte: propre, par: acteur } });
  await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_REPONSE", direction: "SORTANT", contenu: `Réponse envoyée dans son espace : « ${propre} »`.slice(0, 1500), metadata: JSON.stringify({ messageId: message.id, commande: options.commande?.slice(0, 200) ?? null }) } });
  const messagesLus = await marquerMessagesLus(dossierId);
  const notification = await notifierClient("MESSAGE_LUCAS", dossierId, message.id, { message: propre.slice(0, 300) });
  if (notification.programme) await prisma.messageEspace.update({ where: { id: message.id }, data: { notifieLe: new Date() } });
  await recalculerMain(dossierId);
  return { message: versVue({ ...message, dossier: { clientNom: dossier.clientNom } }), notification, lien, clientNom: dossier.clientNom, messagesLus };
}

/** Le texte d'un ancien événement (« Message du client depuis son espace : « … » ») : ce qu'il y a entre les derniers guillemets. */
export function texteDeLEvenement(contenu: string): string {
  const m = /«\s*([\s\S]*?)\s*»\s*$/.exec(contenu.trim());
  return (m?.[1] ?? contenu).trim();
}
