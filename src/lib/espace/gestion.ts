import prisma from "@/lib/prisma";
import { recalculerMain } from "@/lib/dossiers/main";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { envoyerSms } from "@/lib/sms/envoi";
import { lienEspace, renouvelerEspace, revoquerEspace } from "./liens";
import { accorderProjets, projetsVisibles } from "./projets";
import { documentsDuClient, type DocumentClient } from "./compte";
import { listerClientsEspaces, type ClientEspace } from "./suivi";
import { texteNouveauLien } from "./textes";

export { texteNouveauLien };

/**
 * L'espace permanent d'un client, piloté depuis le CRM (fiche client, Espaces
 * clients, dossier) : régénérer son lien (l'ancien meurt ; le SMS avec le
 * nouveau part au clic de Lucas, texte relu), le désactiver, lui accorder un
 * projet de plus. Rien ne part sans Lucas.
 */

const CLIENT_INCONNU = /^(inconnu|client)$/i;

async function prenomEtNumero(clientId: string): Promise<{ prenom: string; numero: string | null }> {
  const [client, dossier] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { prenom: true, nom: true, telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1, select: { numero: true } }, leads: { orderBy: { createdAt: "desc" }, take: 1, select: { prenom: true } } } }),
    prisma.dossier.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { clientTelephone: true } }),
  ]);
  const brut = (client?.leads[0]?.prenom ?? client?.prenom ?? client?.nom.split(/\s+/)[0] ?? "").trim().split(/\s+/)[0] ?? "";
  return { prenom: CLIENT_INCONNU.test(brut) ? "" : brut, numero: client?.telephones[0]?.numero ?? dossier?.clientTelephone ?? null };
}


export type EspaceDuClient = { espace: ClientEspace | null; documents: DocumentClient[]; smsNouveauLien: string; numero: string | null };

/** Fiche client : son espace (lien, visites, projets et leur état), ses documents, et le SMS prêt pour un nouveau lien. */
export async function espaceDuClient(clientId: string): Promise<EspaceDuClient> {
  const permanent = await prisma.espacePermanent.findUnique({ where: { clientId } });
  const { prenom, numero } = await prenomEtNumero(clientId);
  if (!permanent) return { espace: null, documents: [], smsNouveauLien: texteNouveauLien(prenom), numero };
  const [clients, documents] = await Promise.all([listerClientsEspaces(new Date(), { permanentId: permanent.id }), documentsDuClient(permanent)]);
  return { espace: clients[0] ?? null, documents, smsNouveauLien: texteNouveauLien(prenom), numero };
}

async function dossierDeReference(permanentId: string): Promise<string | null> {
  const projets = await projetsVisibles(prisma, permanentId);
  return projets.at(-1)?.dossierId ?? (await prisma.espaceClient.findFirst({ where: { permanentId }, orderBy: { createdAt: "desc" }, select: { dossierId: true } }))?.dossierId ?? null;
}

/**
 * Nouveau lien : la version de l'espace et de ses projets monte, tous les liens
 * déjà envoyés meurent. Le SMS part si Lucas l'a laissé coché, avec SON texte
 * (le lien est mis à la place de `{lien}`, ou ajouté à la fin).
 */
export async function regenererLien(permanentId: string, sms: { envoyer: boolean; texte?: string | null }): Promise<{ lien: string; sms: { id: string; statut: string } | null }> {
  const avant = await prisma.espacePermanent.findUnique({ where: { id: permanentId } });
  if (!avant) throw new ErreurMetier("Espace introuvable.", 404);
  const { permanent } = await renouvelerEspace(permanentId);
  const lien = lienEspace(permanent);
  const dossierId = await dossierDeReference(permanentId);
  let envoye: { id: string; statut: string } | null = null;
  if (sms.envoyer) {
    const { prenom, numero } = await prenomEtNumero(permanent.clientId);
    if (!numero) throw new ErreurMetier("Nouveau lien émis, mais aucun numéro connu pour ce client : copiez le lien et envoyez-le autrement.", 409);
    const modele = (sms.texte?.trim() || texteNouveauLien(prenom)).slice(0, 700);
    const texte = modele.includes("{lien}") ? modele.replace("{lien}", lien) : `${modele} ${lien}`;
    const envoi = await envoyerSms({ numero, rattachement: { clientId: permanent.clientId }, texte, origine: "LIEN_ESPACE", modele: "LIEN_ESPACE_NOUVEAU", textePropose: texteNouveauLien(prenom).replace("{lien}", lien), cleEnvoi: `nouveau-lien:${permanent.id}:${permanent.version}` });
    envoye = { id: envoi.id, statut: envoi.statut };
  }
  if (dossierId) {
    await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_REGENERE", direction: "SORTANT", contenu: `Nouveau lien émis pour l'espace du client : l'ancien ne fonctionne plus${envoye ? " ; SMS envoyé avec le nouveau lien" : " (aucun SMS envoyé)"}.`, metadata: JSON.stringify({ permanentId, version: permanent.version, sms: Boolean(envoye) }) } });
    await recalculerMain(dossierId);
  }
  return { lien, sms: envoye };
}

export async function desactiverLien(permanentId: string): Promise<void> {
  await revoquerEspace(permanentId);
  const dossierId = await dossierDeReference(permanentId);
  if (dossierId) await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_DESACTIVE", direction: "INTERNE", contenu: "Lien de l'espace du client désactivé : il lit « lien désactivé » (rien n'est effacé ; un nouveau lien le rouvre).", metadata: JSON.stringify({ permanentId }) } });
}

export { accorderProjets };
