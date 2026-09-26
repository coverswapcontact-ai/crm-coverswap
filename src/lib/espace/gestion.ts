import prisma from "@/lib/prisma";
import { recalculerMain } from "@/lib/dossiers/main";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { envoyerSms } from "@/lib/sms/envoi";
import { lienEspace, renouvelerEspace, revoquerEspace } from "./liens";
import { accorderProjets, projetsVisibles } from "./projets";
import { documentsDuClient, type DocumentClient } from "./compte";
import { listerClientsEspaces, type ClientEspace } from "./suivi";
import { PHRASE_NOUVEAU_LIEN, texteNouveauLien } from "./textes";

export { texteNouveauLien };

/**
 * L'espace permanent d'un client, piloté depuis le CRM (fiche client, Espaces
 * clients, dossier) : régénérer son lien (l'ancien meurt ; le mail avec le
 * nouveau part au clic de Lucas, texte relu — mission 7, le mail remplace le
 * SMS), le désactiver, lui accorder un projet de plus. Rien ne part sans Lucas.
 */

const CLIENT_INCONNU = /^(inconnu|client)$/i;

async function destinataire(clientId: string): Promise<{ prenom: string; numero: string | null; email: string | null }> {
  const [client, dossier] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: {
        prenom: true,
        nom: true,
        telephones: { where: { archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }], take: 1, select: { numero: true } },
        emails: { where: { archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }], take: 1, select: { adresse: true } },
        leads: { orderBy: { createdAt: "desc" }, take: 1, select: { prenom: true } },
      },
    }),
    prisma.dossier.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { clientTelephone: true, clientEmail: true } }),
  ]);
  const brut = (client?.leads[0]?.prenom ?? client?.prenom ?? client?.nom.split(/\s+/)[0] ?? "").trim().split(/\s+/)[0] ?? "";
  return {
    prenom: CLIENT_INCONNU.test(brut) ? "" : brut,
    numero: client?.telephones[0]?.numero ?? dossier?.clientTelephone ?? null,
    email: normaliserEmail(client?.emails[0]?.adresse) ?? normaliserEmail(dossier?.clientEmail) ?? null,
  };
}


export type EspaceDuClient = { espace: ClientEspace | null; documents: DocumentClient[]; smsNouveauLien: string; numero: string | null; email: string | null };

/** Fiche client : son espace (lien, visites, projets et leur état), ses documents, et à qui envoyer un nouveau lien. */
export async function espaceDuClient(clientId: string): Promise<EspaceDuClient> {
  const permanent = await prisma.espacePermanent.findUnique({ where: { clientId } });
  const { prenom, numero, email } = await destinataire(clientId);
  if (!permanent) return { espace: null, documents: [], smsNouveauLien: texteNouveauLien(prenom), numero, email };
  const [clients, documents] = await Promise.all([listerClientsEspaces(new Date(), { permanentId: permanent.id }), documentsDuClient(permanent)]);
  return { espace: clients[0] ?? null, documents, smsNouveauLien: texteNouveauLien(prenom), numero, email };
}

async function dossierDeReference(permanentId: string): Promise<string | null> {
  const projets = await projetsVisibles(prisma, permanentId);
  return projets.at(-1)?.dossierId ?? (await prisma.espaceClient.findFirst({ where: { permanentId }, orderBy: { createdAt: "desc" }, select: { dossierId: true } }))?.dossierId ?? null;
}

/**
 * Nouveau lien : la version de l'espace et de ses projets monte, tous les liens
 * déjà envoyés meurent. Le mail part si Lucas l'a laissé coché, avec SA phrase
 * (le bouton « Ouvrir mon espace » porte le nouveau lien). Le SMS, plus
 * proposé à l'écran depuis la mission 7, reste possible ici.
 */
export async function regenererLien(
  permanentId: string,
  envoi: { mail?: boolean; sms?: boolean; texte?: string | null },
): Promise<{ lien: string; sms: { id: string; statut: string } | null; mail: { id: string; deja: boolean } | null }> {
  const avant = await prisma.espacePermanent.findUnique({ where: { id: permanentId } });
  if (!avant) throw new ErreurMetier("Espace introuvable.", 404);
  const { permanent } = await renouvelerEspace(permanentId);
  const lien = lienEspace(permanent);
  const dossierId = await dossierDeReference(permanentId);
  const { prenom, numero, email } = await destinataire(permanent.clientId);
  let sms: { id: string; statut: string } | null = null;
  let mail: { id: string; deja: boolean } | null = null;
  if (envoi.mail) {
    if (!email) throw new ErreurMetier("Nouveau lien émis, mais aucune adresse e-mail valide pour ce client : copiez le lien et envoyez-le autrement.", 409);
    const [{ mailNotification }, { programmerEnvoi }] = await Promise.all([import("@/lib/mail/notifications"), import("@/lib/mail/envoi-crm")]);
    const phrase = (envoi.texte?.trim() || PHRASE_NOUVEAU_LIEN).slice(0, 600);
    const contenu = mailNotification({ objet: "Le nouveau lien de votre espace CoverSwap", phrase, bouton: "Ouvrir mon espace", actif: true }, { prenom, lien });
    mail = await programmerEnvoi({ cle: `nouveau-lien:${permanent.id}:${permanent.version}`, nature: "NOUVEAU", modele: "LIEN_ESPACE_NOUVEAU", a: email, objet: contenu.objet, texte: contenu.texte, html: contenu.html, dossierId, clientId: permanent.clientId });
  } else if (envoi.sms) {
    if (!numero) throw new ErreurMetier("Nouveau lien émis, mais aucun numéro connu pour ce client : copiez le lien et envoyez-le autrement.", 409);
    const modele = (envoi.texte?.trim() || texteNouveauLien(prenom)).slice(0, 700);
    const texte = modele.includes("{lien}") ? modele.replace("{lien}", lien) : `${modele} ${lien}`;
    const envoye = await envoyerSms({ numero, rattachement: { clientId: permanent.clientId }, texte, origine: "LIEN_ESPACE", modele: "LIEN_ESPACE_NOUVEAU", textePropose: texteNouveauLien(prenom).replace("{lien}", lien), cleEnvoi: `nouveau-lien:${permanent.id}:${permanent.version}` });
    sms = { id: envoye.id, statut: envoye.statut };
  }
  if (dossierId) {
    const suite = mail ? " ; mail envoyé avec le nouveau lien" : sms ? " ; SMS envoyé avec le nouveau lien" : " (rien d'envoyé)";
    await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_REGENERE", direction: "SORTANT", contenu: `Nouveau lien émis pour l'espace du client : l'ancien ne fonctionne plus${suite}.`, metadata: JSON.stringify({ permanentId, version: permanent.version, sms: Boolean(sms), mail: Boolean(mail) }) } });
    await recalculerMain(dossierId);
  }
  return { lien, sms, mail };
}

export async function desactiverLien(permanentId: string, motif?: string): Promise<void> {
  await revoquerEspace(permanentId);
  const dossierId = await dossierDeReference(permanentId);
  if (dossierId) await prisma.dossierEvenement.create({ data: { dossierId, type: "ESPACE_LIEN_DESACTIVE", direction: "INTERNE", contenu: `Lien de l'espace du client désactivé${motif ? ` (${motif})` : ""} : il lit « lien désactivé » (rien n'est effacé ; un nouveau lien le rouvre).`, metadata: JSON.stringify({ permanentId, ...(motif ? { motif } : {}) }) } });
}

export { accorderProjets };
