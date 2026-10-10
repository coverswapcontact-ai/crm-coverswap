/**
 * Mission 25 — le dossier « Démo Messagerie » (cahier, § Le scénario de bout en bout) : un lead fictif (« Démo
 * Messagerie », numéro de la plage de fiction 06 39 98 00 18, Lattes), créé à la demande depuis Paramètres → SMS et
 * messagerie, pour essayer la messagerie sur le téléphone : A1 prêt et l'alerte, puis note après appel, photos,
 * simulation, réponses, devis, « comme convenu ». Recréer la démo archive la précédente (rien ne se supprime).
 * Aucun vrai nom, aucun vrai numéro.
 */
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";

export const DEMO = { prenom: "Démo", nom: "Messagerie", telephone: "+33639980018", saisi: "06 39 98 00 18", ville: "Lattes", codePostal: "34970" } as const;
const MOTIF = "Démo Messagerie remplacée (mission 25)";

/** Archive l'ancienne démo (lead, dossiers, suivi) puis crée un nouveau lead de démonstration ; la messagerie prépare A1. */
export async function creerDemoMessagerie(maintenant: Date = new Date()): Promise<{ leadId: string; archives: number }> {
  const anciens = await prisma.lead.findMany({ where: { ...AVEC_ARCHIVES, prenom: DEMO.prenom, nom: DEMO.nom, archiveLe: null }, select: { id: true } });
  let archives = 0;
  for (const ancien of anciens) {
    await prisma.lead.update({ where: { id: ancien.id }, data: { archiveLe: maintenant, archiveMotif: MOTIF, rappelLe: null } });
    const dossiers = await prisma.dossier.findMany({ where: { leadId: ancien.id, archiveLe: null }, select: { id: true } });
    for (const d of dossiers) await prisma.dossier.update({ where: { id: d.id }, data: { archiveLe: maintenant, archiveMotif: MOTIF } });
    const suivis = await prisma.suivi.findMany({ where: { ...AVEC_ARCHIVES, OR: [{ leadId: ancien.id }, { dossierId: { in: dossiers.map((d) => d.id) } }] }, select: { id: true } });
    await prisma.messagePrepare.updateMany({ where: { suiviId: { in: suivis.map((x) => x.id) }, statut: { in: ["PREVU", "A_ENVOYER", "A_VALIDER"] } }, data: { statut: "ANNULE", motif: MOTIF } });
    await prisma.suivi.updateMany({ where: { id: { in: suivis.map((x) => x.id) }, archiveLe: null }, data: { archiveLe: maintenant, archiveMotif: MOTIF } });
    archives++;
  }
  // Le numéro de démo repart sans STOP ni « premier SMS » : la démo se rejoue à l'identique.
  const conversation = await prisma.conversationSms.findFirst({ where: { ...AVEC_ARCHIVES, numero: DEMO.telephone } });
  if (conversation) {
    await prisma.conversationSms.update({ where: { id: conversation.id }, data: { premierEnvoiLe: null, stopLe: null, stopTexte: null, leadId: null, clientId: null } });
    await prisma.sms.updateMany({ where: { conversationId: conversation.id, archiveLe: null }, data: { archiveLe: maintenant, archiveMotif: MOTIF } });
  }
  const lead = await prisma.lead.create({
    data: { prenom: DEMO.prenom, nom: DEMO.nom, telephone: DEMO.saisi, ville: DEMO.ville, codePostal: DEMO.codePostal, source: "META_ADS", typeProjet: "CUISINE", message: "Démonstration de la messagerie (fictif)", notes: "Dossier de démonstration de la messagerie : numéro fictif, à archiver après l'essai." },
  });
  const { signalerMessagerie } = await import("./taches");
  await signalerMessagerie();
  return { leadId: lead.id, archives };
}
