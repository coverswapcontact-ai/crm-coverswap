import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { planifierAction } from "./planification";

/**
 * « Planifier » depuis un mail (mission 9 ; mission 17, partie C : partagé par la route de l'écran Mail et l'outil
 * « planifier » de l'assistant) : l'action se pose sur le dossier du mail (ou le dernier dossier de son client), sinon
 * sur son lead. Un mail rattaché à rien est refusé : il se rattache d'abord.
 */
export async function planifierDepuisMail(messageId: string, entree: { debut: Date; action: string; dureeMinutes?: number; origine: string }) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { dossierId: true, leadId: true, clientId: true, deNom: true, de: true, client: { select: { nom: true, dossiers: { where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } }, lead: { select: { prenom: true, nom: true } } } });
  if (!message) throw new ErreurMetier("Mail introuvable.", 404);
  const dossierId = message.dossierId ?? message.client?.dossiers[0]?.id ?? null;
  if (!dossierId && !message.leadId) throw new ErreurMetier("Ce mail n'est rattaché ni à un dossier ni à un lead : rattachez-le d'abord.", 409);
  const nom = message.client?.nom ?? (message.lead ? `${message.lead.prenom} ${message.lead.nom}`.trim() : (message.deNom ?? message.de));
  const leadId = dossierId ? null : message.leadId;
  const resultat = await planifierAction({ dossierId, leadId, nom, action: entree.action, debut: entree.debut, dureeMinutes: entree.dureeMinutes, origine: entree.origine });
  return { ...resultat, dossierId, leadId, nom };
}
