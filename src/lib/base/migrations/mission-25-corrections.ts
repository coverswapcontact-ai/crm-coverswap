import { pluriel } from "@/lib/commun/format";
import { formuleBonjour, prenomFiable } from "@/lib/messagerie/texte";
import { PROPOSITIONS_PAR_JOUR } from "@/lib/messagerie/types";
import { unSeulParEtape } from "@/lib/messagerie/unicite";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Mission 25, corrections du 12/10 (après la première file du jour) — les messages déjà préparés suivent les nouvelles
 * règles :
 * 1. un seul message par étape : le plus avancé reste (D4 avant D2, D3 avant D4), les autres sont annulés, avec une
 *    ligne au journal du client ;
 * 2. le prénom fiable : « Bonjour X, » redevient « Bonjour, » (ou le bon prénom) dans les messages encore ouverts ;
 * 3. une seule carte par client dans la file, et 8 propositions au plus : le reste repasse « prévu » (la garde et le
 *    plafond du moteur le reproposent ensuite, 8 par jour, dans l'ordre).
 * Rien n'est envoyé, rien n'est classé (dossiers et leads ne changent pas). Rejouable : un état déjà corrigé ne bouge plus.
 */

const NOM = "messagerie-corrections-12-10";
const OUVERTS = ["PREVU", "A_ENVOYER", "A_VALIDER"];
const SALUTATION = /^Bonjour(?: [^,\n]{1,40})?,/;

async function ligne(client: BaseDonnees, suiviId: string, cle: string, le: Date, texte: string): Promise<void> {
  try {
    await client.ligneJournalSuivi.create({ data: { suiviId, cle: cle.slice(0, 190), le, acteur: "IA", texte: texte.slice(0, 300) } });
  } catch (erreur) {
    if ((erreur as { code?: string }).code !== "P2002") throw erreur;
  }
}

/** Le prénom fiable d'un suivi (règle du 12/10), lu dans sa fiche client, son lead et son dossier. */
async function prenomDuSuivi(client: BaseDonnees, suivi: { leadId: string | null; dossierId: string | null; clientId: string | null }): Promise<string | null> {
  const [lead, dossier] = await Promise.all([
    suivi.leadId ? client.lead.findUnique({ where: { id: suivi.leadId }, select: { prenom: true, nom: true, clientId: true } }) : null,
    suivi.dossierId ? client.dossier.findUnique({ where: { id: suivi.dossierId }, select: { clientNom: true, clientId: true } }) : null,
  ]);
  const clientId = dossier?.clientId ?? lead?.clientId ?? suivi.clientId;
  const fiche = clientId ? await client.client.findUnique({ where: { id: clientId }, select: { nom: true, prenom: true, nomFamille: true } }) : null;
  return prenomFiable([{ prenom: fiche?.prenom, nom: fiche?.nomFamille }, { prenom: lead?.prenom, nom: lead?.nom }], [fiche?.nom, dossier?.clientNom]);
}

export async function corrigerLesMessagesPrepares(client: BaseDonnees, maintenant: Date = new Date()): Promise<Record<string, number>> {
  const compteurs = { remplaces: 0, salutations: 0, remisEnAttente: 0, propositions: 0 };
  const ouverts = await client.messagePrepare.findMany({ where: { statut: { in: OUVERTS } }, select: { suiviId: true } });
  const suiviIds = [...new Set(ouverts.map((m) => m.suiviId))];
  const touches = new Set<string>();

  // 1. Un seul message par étape (parmi tous les messages du client, partis ou non).
  for (const suiviId of suiviIds) {
    const messages = await client.messagePrepare.findMany({ where: { suiviId }, select: { id: true, code: true, cle: true, statut: true, motif: true } });
    for (const r of unSeulParEtape([], messages).remplaces) {
      const motif = `remplacé par ${r.par} : un seul message à la fois`;
      const { count } = await client.messagePrepare.updateMany({ where: { id: r.messageId, statut: { in: OUVERTS } }, data: { statut: "ANNULE", motif } });
      if (!count) continue;
      compteurs.remplaces++;
      touches.add(suiviId);
      await ligne(client, suiviId, `msg:${r.messageId}:annule`, maintenant, `${messages.find((m) => m.id === r.messageId)?.code ?? "Message"} annulé : ${motif}`);
    }
  }

  // 2. Le prénom fiable dans les messages encore ouverts.
  for (const suiviId of suiviIds) {
    const suivi = await client.suivi.findUnique({ where: { id: suiviId }, select: { leadId: true, dossierId: true, clientId: true } });
    if (!suivi) continue;
    const bonjour = formuleBonjour(await prenomDuSuivi(client, suivi));
    const messages = await client.messagePrepare.findMany({ where: { suiviId, statut: { in: OUVERTS } }, select: { id: true, texte: true, texteValide: true } });
    for (const m of messages) {
      const texte = m.texte.replace(SALUTATION, bonjour);
      const texteValide = m.texteValide.replace(SALUTATION, bonjour);
      if (texte === m.texte && texteValide === m.texteValide) continue;
      await client.messagePrepare.update({ where: { id: m.id }, data: { texte, texteValide } });
      compteurs.salutations++;
      touches.add(suiviId);
    }
  }

  // 3. Une carte par client (par suivi et par numéro), et 8 propositions au plus ; les réponses au client restent.
  const enFile = await client.messagePrepare.findMany({ where: { statut: { in: ["A_ENVOYER", "A_VALIDER"] } }, orderBy: [{ prevuLe: "asc" }, { createdAt: "asc" }], select: { id: true, suiviId: true, code: true, statut: true, reponse: true, destinataire: true, proposeLe: true } });
  const ordre = [...enFile.filter((m) => m.reponse), ...enFile.filter((m) => !m.reponse && m.statut === "A_ENVOYER"), ...enFile.filter((m) => !m.reponse && m.statut === "A_VALIDER")];
  const suivisPris = new Set<string>();
  const numerosPris = new Set<string>();
  let propositions = 0;
  for (const m of ordre) {
    const dejaPris = suivisPris.has(m.suiviId) || Boolean(m.destinataire && numerosPris.has(m.destinataire));
    const tropDePropositions = m.statut === "A_VALIDER" && propositions >= PROPOSITIONS_PAR_JOUR;
    if (!m.reponse && (dejaPris || tropDePropositions)) {
      const motif = tropDePropositions && !dejaPris ? `${PROPOSITIONS_PAR_JOUR} propositions par jour au plus : reviendra à son tour` : "un seul message à la fois pour ce client : reviendra après";
      await client.messagePrepare.update({ where: { id: m.id }, data: { statut: "PREVU", prevuLe: maintenant, motif } });
      compteurs.remisEnAttente++;
      touches.add(m.suiviId);
      await ligne(client, m.suiviId, `msg:${m.id}:attente:${NOM}`, maintenant, `${m.code} remis en attente : ${motif}`);
      continue;
    }
    suivisPris.add(m.suiviId);
    if (m.destinataire) numerosPris.add(m.destinataire);
    if (m.statut === "A_VALIDER") {
      propositions++;
      if (!m.proposeLe) await client.messagePrepare.update({ where: { id: m.id }, data: { proposeLe: maintenant } });
    }
  }
  compteurs.propositions = propositions;

  // Les clients touchés sont relus au prochain passage du moteur (« Où on en est », prochaine action).
  if (touches.size) await client.suivi.updateMany({ where: { id: { in: [...touches] } }, data: { revoirLe: maintenant } });
  console.info(
    `[migration ${NOM}] ${pluriel(compteurs.remplaces, "message remplacé", "messages remplacés")}, ${pluriel(compteurs.salutations, "salutation corrigée", "salutations corrigées")}, ${pluriel(compteurs.remisEnAttente, "message remis en attente", "messages remis en attente")}, ${pluriel(compteurs.propositions, "proposition gardée", "propositions gardées")}`
  );
  return compteurs;
}

export const migrationCorrectionsMessagerie25: MigrationDonnees = {
  nom: NOM,
  description: "Messagerie (corrections du 12/10) : un seul message par étape (le plus avancé), prénom fiable dans les messages ouverts, une carte par client et 8 propositions au plus",
  executer: (client) => corrigerLesMessagesPrepares(client),
};
