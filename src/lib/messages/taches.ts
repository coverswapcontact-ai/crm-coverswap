import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { mettreEnFile } from "@/lib/taches/file";
import { ErreurDefinitive, enregistrerTraitement } from "@/lib/taches/registre";
import { ACTEUR_AGENT_MAIL, analyserMessage } from "./analyse";
import { agentMailActif } from "./consultation";
import { lireMessageGmail, listerMessagesGmail, versMessageRecu } from "./gmail";
import { TYPE_TACHE_ANALYSE, TYPE_TACHE_BOITE, TYPE_TACHE_PIECES, TYPE_TACHE_RELEVE, conserverPieces, enregistrerMessageRecu, rangerDansBoite } from "./stockage";

/**
 * Relevé de la boîte mail et tâches de l'agent. Le relevé ne lit que les
 * messages récents (depuis le dernier message connu, moins une marge d'un
 * jour ; au premier passage, depuis une semaine avant la connexion) : il est
 * rejouable sans doublon et ne bloque jamais l'interface.
 */

const MARGE_MS = 24 * 60 * 60_000;
const PREMIERE_REPRISE_MS = 7 * 24 * 60 * 60_000;
const MESSAGES_PAR_RELEVE = 300;

export type BilanReleve = { lus: number; nouveaux: number };

export async function releverBoite(options: { signal?: AbortSignal } = {}): Promise<BilanReleve> {
  const connexion = await agentMailActif();
  if (!connexion) throw new ErreurDefinitive("Agent mail inactif : aucun compte Google connecté avec l'accès Gmail.");

  const [dernier, ligneConnexion] = await Promise.all([
    prisma.message.findFirst({ where: { canal: "EMAIL", compte: connexion.compte }, orderBy: { recuLe: "desc" }, select: { recuLe: true } }),
    prisma.connexionGoogle.findUnique({ where: { id: connexion.id }, select: { createdAt: true } }),
  ]);
  const depuis = dernier ? dernier.recuLe.getTime() - MARGE_MS : (ligneConnexion?.createdAt.getTime() ?? Date.now()) - PREMIERE_REPRISE_MS;
  const recherche = `after:${Math.floor(depuis / 1000)} -in:spam -in:trash -in:drafts -in:chats`;
  const identifiants = await listerMessagesGmail(recherche, MESSAGES_PAR_RELEVE);

  const connus = new Set(
    (
      await prisma.message.findMany({
        where: { ...AVEC_ARCHIVES, canal: "EMAIL", identifiantCanal: { in: identifiants.map((element) => element.id) } },
        select: { identifiantCanal: true },
      })
    ).map((message) => message.identifiantCanal)
  );
  let nouveaux = 0;
  // Du plus ancien au plus récent : une conversation se lit dans l'ordre.
  for (const { id } of [...identifiants].reverse()) {
    if (options.signal?.aborted) break;
    if (connus.has(id)) continue;
    const gmail = await lireMessageGmail(id);
    if (!gmail) continue;
    const { id: messageId, nouveau } = await enregistrerMessageRecu(versMessageRecu(gmail, connexion.compte));
    if (!nouveau) continue;
    nouveaux++;
    await mettreEnFile({ type: TYPE_TACHE_ANALYSE, cle: `analyse-message:${messageId}`, charge: { messageId } });
  }
  return { lus: identifiants.length, nouveaux };
}

/** « Relever maintenant » : une tâche de fond, jamais un appel bloquant. */
export async function demanderReleve(): Promise<void> {
  if (!(await agentMailActif())) throw new ErreurMetier("Agent mail inactif : connecter le compte Google (accès Gmail) dans Paramètres.", 409);
  await mettreEnFile({ type: TYPE_TACHE_RELEVE, cle: "releve-boite", mode: "RECONCILIATION", charge: {} });
}

function messageIdDe(charge: unknown): string {
  const messageId = (charge as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== "string") throw new ErreurDefinitive("Charge invalide : messageId manquant");
  return messageId;
}

export function enregistrerTachesMessages(): void {
  enregistrerTraitement(TYPE_TACHE_ANALYSE, {
    libelle: "Analyse d'un mail par l'agent (règles, puis IA si active)",
    acteur: ACTEUR_AGENT_MAIL,
    delaiMaxMs: 3 * 60_000,
    tentativesMax: 3,
    executer: (charge, contexte) => analyserMessage(messageIdDe(charge), { relire: (charge as { relire?: boolean }).relire === true, signal: contexte.signal }),
  });
  enregistrerTraitement(TYPE_TACHE_BOITE, {
    libelle: "Rangement d'un mail dans la boîte (archiver le bruit, remettre dans la boîte)",
    acteur: "SYSTEME:boite-mail",
    executer: async (charge) => {
      if (!(await agentMailActif())) throw new ErreurDefinitive("Boîte mail non connectée : le rangement attendra la reconnexion (relancer la tâche).");
      return rangerDansBoite(messageIdDe(charge));
    },
  });
  enregistrerTraitement(TYPE_TACHE_PIECES, {
    libelle: "Conservation des pièces jointes d'un mail",
    acteur: "SYSTEME:boite-mail",
    delaiMaxMs: 5 * 60_000,
    executer: async (charge) => {
      if (!(await agentMailActif())) throw new ErreurDefinitive("Boîte mail non connectée : pièces jointes non téléchargées.");
      const bilan = await conserverPieces(messageIdDe(charge));
      if (bilan.erreurs > 0) throw new Error(`${bilan.erreurs} pièce(s) jointe(s) en échec : nouvel essai plus tard`);
      return bilan;
    },
  });
  enregistrerTraitement(TYPE_TACHE_RELEVE, {
    libelle: "Relevé de la boîte mail (demandé)",
    acteur: ACTEUR_AGENT_MAIL,
    delaiMaxMs: 10 * 60_000,
    executer: (_charge, contexte) => releverBoite({ signal: contexte.signal }),
  });
  // Mission 7 (22/09/2026) : le relevé périodique de l'agent (toutes les 5 min, puis analyse et propositions) est
  // remplacé par la synchronisation de l'onglet Mail (src/lib/mail/taches.ts : historique Gmail chaque minute, tri
  // d'office). Les traitements ci-dessus restent enregistrés : les tâches déjà en file vont au bout.
}
