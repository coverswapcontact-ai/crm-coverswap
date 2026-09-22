import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { GoogleIndisponible } from "@/lib/google/connexion";
import { lireEntetes } from "@/lib/messages/stockage";
import { lireParametre } from "@/lib/parametres/service";
import { mettreEnFile } from "@/lib/taches/file";
import { envoyeurMail } from "./envoi";
import { tracerMailDansDossier } from "./rattachement";

/**
 * Tout mail qui part du CRM passe ici (mission 7) : une ligne `EnvoiMail` à
 * clé unique (un même envoi ne part jamais deux fois), une tâche qui l'envoie
 * depuis la boîte Gmail — dans le fil de la conversation quand c'est une
 * réponse —, puis la trace : le mail dans l'onglet Mail, l'événement dans le
 * dossier. Google coupé : l'envoi attend la reconnexion, rien n'est perdu.
 *
 * Qui décide de l'envoi ? Lucas (réponse, nouveau mail : son clic), ou la
 * règle des notifications de l'espace (quatre événements fixes, voulus par
 * Lucas). Rien d'autre n'appelle `programmerEnvoi`.
 */

export const TYPE_TACHE_ENVOI_MAIL = "MAIL_ENVOI";
export const NATURES_ENVOI = ["NOTIFICATION", "REPONSE", "NOUVEAU", "SEQUENCE", "ESSAI"] as const;
export type NatureEnvoi = (typeof NATURES_ENVOI)[number];

export type DemandeEnvoi = {
  cle: string;
  nature: NatureEnvoi;
  modele?: string | null;
  a: string;
  objet: string;
  texte: string;
  html?: string | null;
  /** Message reçu auquel on répond : même fil, en-têtes de réponse. */
  enReponseA?: string | null;
  dossierId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
  brouillonId?: string | null;
  entetes?: Record<string, string>;
};

/** Programme un envoi (une seule fois par clé). Rend l'envoi, et s'il existait déjà. */
export async function programmerEnvoi(demande: DemandeEnvoi): Promise<{ id: string; deja: boolean }> {
  const a = normaliserEmail(demande.a);
  if (!a) throw new ErreurMetier("Adresse du destinataire invalide.", 400);
  if (!demande.objet.trim()) throw new ErreurMetier("Objet manquant.", 400);
  if (!demande.texte.trim()) throw new ErreurMetier("Message vide.", 400);
  const deja = await prisma.envoiMail.findUnique({ where: { cle: demande.cle }, select: { id: true } });
  if (deja) return { id: deja.id, deja: true };
  let id: string;
  try {
    id = (
      await prisma.envoiMail.create({
        data: {
          cle: demande.cle,
          nature: demande.nature,
          modele: demande.modele ?? null,
          a,
          objet: demande.objet.trim().slice(0, 300),
          texte: demande.texte,
          html: demande.html ?? null,
          enReponseA: demande.enReponseA ?? null,
          dossierId: demande.dossierId ?? null,
          clientId: demande.clientId ?? null,
          leadId: demande.leadId ?? null,
          brouillonId: demande.brouillonId ?? null,
          entetes: demande.entetes ? JSON.stringify(demande.entetes) : null,
        },
      })
    ).id;
  } catch (erreur) {
    // Deux demandes simultanées du même envoi : la seconde rend la première.
    if ((erreur as { code?: string }).code !== "P2002") throw erreur;
    const existant = await prisma.envoiMail.findUniqueOrThrow({ where: { cle: demande.cle }, select: { id: true } });
    return { id: existant.id, deja: true };
  }
  await mettreEnFile({ type: TYPE_TACHE_ENVOI_MAIL, cle: `mail-envoi:${id}`, charge: { envoiId: id }, priorite: 6, tentativesMax: 6 });
  return { id, deja: false };
}

const lireEntetesEnvoi = (json: string | null): Record<string, string> | undefined => {
  try {
    return json ? (JSON.parse(json) as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
};

/** Envoie un mail programmé (tâche). Rejouable : un envoi fait ne repart pas. */
export async function executerEnvoi(envoiId: string): Promise<{ envoye: boolean; identifiant: string | null }> {
  const envoi = await prisma.envoiMail.findUnique({ where: { id: envoiId } });
  if (!envoi) throw new ErreurMetier("Envoi introuvable.", 404);
  if (envoi.statut !== "A_ENVOYER") return { envoye: false, identifiant: envoi.identifiantCanal };
  const envoyeur = await envoyeurMail({ exigerGmail: true });
  if (!envoyeur) throw new GoogleIndisponible("envoi en attente : la boîte Gmail n'est pas connectée avec l'accès d'envoi.");

  const recu = envoi.enReponseA ? await prisma.message.findUnique({ where: { id: envoi.enReponseA }, include: { contenu: { select: { entetes: true } } } }) : null;
  const entetesRecu = recu ? lireEntetes(recu.contenu?.entetes) : {};
  // Séquences : l'adresse d'expédition paramétrée (Paramètres → Agent mail et IA), pour passer un jour sur son domaine.
  const expediteur = envoi.nature === "SEQUENCE" ? ((await lireParametre("MAIL_EXPEDITEUR")) as string | null) : null;
  const realise = await envoyeur.envoyer({
    de: expediteur,
    a: envoi.a,
    objet: envoi.objet,
    texte: envoi.texte,
    html: envoi.html,
    entetes: lireEntetesEnvoi(envoi.entetes),
    enReponseA: recu ? { fil: recu.filCanal, messageIdEntete: entetesRecu["message-id"] ?? null, references: entetesRecu.references ?? null } : null,
  });
  const maintenant = new Date();
  const automatique = envoi.nature === "NOTIFICATION" || envoi.nature === "SEQUENCE";
  const identifiant = realise.identifiant ?? `crm:${envoi.id}`;
  const donneesMessage = {
    automatique,
    lu: true,
    dansBoite: false,
    classe: envoi.clientId || envoi.leadId ? "CLIENT" : "HUMAIN",
    classeMotif: automatique ? "Mail automatique de l'espace client." : "Envoyé depuis le CRM.",
    classePar: "TRI",
    statut: envoi.clientId || envoi.leadId ? "RATTACHE" : "IGNORE",
    categorie: envoi.clientId || envoi.leadId ? "CLIENT" : "AUTRE",
    clientId: envoi.clientId,
    leadId: envoi.leadId,
    dossierId: envoi.dossierId,
    trieLe: maintenant,
    triePar: "SYSTEME:envoi-mail",
  };
  // La synchronisation a pu voir le mail envoyé avant nous : on complète sa ligne au lieu d'en créer une seconde.
  const existant = await prisma.message.findFirst({ where: { canal: "EMAIL", identifiantCanal: identifiant }, select: { id: true } });
  const messageId = existant
    ? (await prisma.message.update({ where: { id: existant.id }, data: donneesMessage })).id
    : (
        await prisma.message.create({
          data: {
            canal: "EMAIL",
            compte: realise.compte ?? "crm",
            identifiantCanal: identifiant,
            filCanal: realise.fil ?? recu?.filCanal ?? null,
            sens: "SORTANT",
            de: realise.compte ?? "crm",
            deNom: "CoverSwap",
            a: JSON.stringify([envoi.a]),
            objet: envoi.objet,
            extrait: envoi.texte.slice(0, 300),
            recuLe: maintenant,
            ...donneesMessage,
            contenu: { create: { texte: envoi.texte, entetes: "{}" } },
          },
        })
      ).id;
  await prisma.envoiMail.update({ where: { id: envoi.id }, data: { statut: "ENVOYE", envoyeLe: maintenant, messageId, identifiantCanal: identifiant, erreur: null } });

  // La trace : le fil répondu, le brouillon envoyé, l'événement dans le dossier.
  if (recu?.filCanal && !automatique) {
    await prisma.message.updateMany({ where: { canal: "EMAIL", filCanal: recu.filCanal, sens: "ENTRANT", reponduLe: null }, data: { reponduLe: maintenant } });
  }
  if (envoi.brouillonId) await prisma.brouillonMail.update({ where: { id: envoi.brouillonId }, data: { statut: "ENVOYE", envoyeLe: maintenant, envoiId: envoi.id } }).catch(() => undefined);
  if (envoi.dossierId) {
    if (automatique) {
      await prisma.dossierEvenement.create({
        data: { dossierId: envoi.dossierId, type: "MAIL_NOTIFICATION", direction: "SORTANT", contenu: `Mail automatique envoyé à ${envoi.a} : « ${envoi.objet} »`, metadata: JSON.stringify({ messageId, envoiId: envoi.id, modele: envoi.modele }) },
      });
    } else {
      await tracerMailDansDossier(messageId, envoi.dossierId);
    }
  } else if (envoi.leadId && !automatique) {
    await prisma.interaction.create({ data: { leadId: envoi.leadId, type: "EMAIL", contenu: `Mail envoyé : ${envoi.objet} — ${envoi.texte.slice(0, 300)}` } });
  }
  return { envoye: true, identifiant };
}

/** Un envoi en échec définitif garde sa raison (l'écran Mail la montre). */
export async function noterEchecEnvoi(envoiId: string, raison: string): Promise<void> {
  await prisma.envoiMail.update({ where: { id: envoiId }, data: { statut: "ECHEC", erreur: raison.slice(0, 1000) } }).catch(() => undefined);
}
