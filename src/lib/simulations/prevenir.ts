import prisma from "@/lib/prisma";
import { rattacherLead } from "@/lib/clients/identification";
import { normaliserEmail, normaliserTelephone } from "@/lib/clients/normalisation";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { adresseDuSite } from "@/lib/espace/liens";
import { envoyeurMail } from "@/lib/mail/envoi";
import { mailNotification, type ModeleNotification } from "@/lib/mail/notifications";
import { lireParametre } from "@/lib/parametres/service";
import { notifierDemandeDuSite } from "@/lib/prospects/notification";
import { classerLeadSansBloquer } from "@/lib/prospects/qualification";
import { teintesDe } from "./site";
import { cheminsImagesTravail, lireReferencesTravail } from "./travaux-lecture";
import { promises as fs } from "fs";
import path from "path";
import { resolveUploadsDir } from "@/lib/uploads";

/**
 * Mission 15 (partie 1) — « Me prévenir quand c'est prêt » : le visiteur qui
 * attend son rendu laisse une adresse ou un numéro. Le lead du parcours est
 * créé ou retrouvé (source SITE_SIMULATEUR, comme le webhook du site le fait,
 * sans passer par le réseau : même consentement enregistré, même alerte à
 * Lucas), la demande est notée sur sa fiche, et à la fin UN mail part
 * (interrupteur NOTIF_SIMULATION_SITE_PRETE, actif par défaut), jamais deux.
 * Téléphone seul : AUCUN SMS (aucun envoi automatique nouveau) — la note le
 * dit, le téléphone de Lucas sonne, et il rappelle.
 */

export const CLE_INTERRUPTEUR_NOTIFICATION = "NOTIF_SIMULATION_SITE_PRETE";

const TYPE_PROJET: Record<string, string> = { cuisine: "CUISINE", "salle-de-bain": "SDB", meubles: "MEUBLES", professionnel: "PRO", "mur-plafond": "AUTRE" };

/** Texte de la case cochée sur le site (preuve du consentement). Le site transmet le sien ; celui-ci sert à défaut. */
export const TEXTE_CONSENTEMENT_PREVENIR = "J'accepte que CoverSwap me contacte au sujet de cette simulation (un e-mail au plus si j'ai donné une adresse ; par téléphone, un rappel de notre part, jamais de SMS automatique).";

/** Le mail « simulation prête » du site : même gabarit que les notifications de l'espace client. */
export const MODELE_SIMULATION_SITE_PRETE: ModeleNotification = {
  objet: "Votre simulation CoverSwap est prête",
  phrase: "Votre simulation est prête : le rendu est joint à ce mail. Retrouvez-le sur le simulateur pour comparer avant / après et recevoir un devis.",
  bouton: "Voir ma simulation",
  actif: true,
};

/** L'interrupteur (Paramètres → Simulateur, `voir_parametres`) : actif tant qu'il n'est pas coupé. */
export async function notificationSitePreteActive(): Promise<boolean> {
  return (await lireParametre(CLE_INTERRUPTEUR_NOTIFICATION)) !== "INACTIF";
}

/**
 * Le lien du mail porte les DEUX preuves que le suivi exige (travail + parcours) :
 * ouvert sur un autre appareil, sans mémoire locale, le site adopte ce parcours
 * et retrouve le rendu. Le couple est déjà la preuve admise par /image et /prevenir.
 */
export function lienDeReprise(travailId: string, parcoursId: string): string {
  return `${adresseDuSite()}/simulateur?reprise=${encodeURIComponent(travailId)}&p=${encodeURIComponent(parcoursId)}`;
}

export type DemandePrevenir = { travailId: string; parcoursId: string; email?: string | null; telephone?: string | null; ip?: string | null; consentementTexte?: string | null };

/** L'alerte à Lucas, comme pour une demande du webhook : jamais bloquante. */
async function alerterSansBloquer(demande: Parameters<typeof notifierDemandeDuSite>[0]): Promise<void> {
  try {
    await notifierDemandeDuSite(demande);
  } catch (erreur) {
    console.error("[simulate] alerte « Me prévenir » non envoyée (non bloquant) :", erreur);
  }
}

/**
 * Enregistre la demande sur le travail et sur le lead du parcours (créé s'il
 * n'existe pas). Rejouable : la même demande ne crée ni second lead, ni seconde
 * note, ni second consentement. Si le rendu est déjà prêt, le mail part tout de suite.
 */
export async function enregistrerDemandePrevenir(demande: DemandePrevenir): Promise<{ leadId: string; nouveau: boolean; notifie: boolean }> {
  const travail = await prisma.travailSimulation.findFirst({ where: { id: demande.travailId, parcoursId: demande.parcoursId, archiveLe: null } });
  if (!travail) throw new ErreurMetier("Nous ne retrouvons pas cette simulation : relancez-la depuis vos choix.", 404);
  const email = demande.email ? normaliserEmail(demande.email) : null;
  const telephone = demande.telephone ? normaliserTelephone(demande.telephone) : null;
  if (demande.email && !email) throw new ErreurMetier("Adresse e-mail invalide : vérifiez-la.", 400);
  if (demande.telephone && !telephone) throw new ErreurMetier("Numéro de téléphone illisible : il faut au moins 9 chiffres.", 400);
  if (!email && !telephone) throw new ErreurMetier("Indiquez une adresse e-mail ou un numéro de téléphone.", 400);

  const memeContact = (l: { email: string | null; telephone: string }) => (!!email && normaliserEmail(l.email) === email) || (!!telephone && normaliserTelephone(l.telephone) === telephone);
  const duParcours = (await prisma.lead.findMany({ where: { parcoursId: travail.parcoursId, archiveLe: null }, orderBy: { createdAt: "desc" } })).find(memeContact);
  const connu =
    duParcours ??
    (await prisma.lead.findMany({ where: { archiveLe: null, OR: [email ? { email } : undefined, telephone ? { telephone } : undefined].filter(Boolean) as { email?: string; telephone?: string }[] }, orderBy: { createdAt: "desc" }, take: 20 })).find(memeContact) ??
    null;

  const references = lireReferencesTravail(travail.references);
  const dejaNotee = travail.leadId !== null && travail.notifierEmail === email && travail.notifierTelephone === telephone;
  // Un numéro qui n'était pas encore sur ce travail : Lucas doit le voir (téléphone seul = il rappelle).
  const nouveauTelephone = !!telephone && travail.notifierTelephone !== telephone;
  let leadId: string;
  let nouveau = false;
  if (connu) {
    leadId = connu.id;
    const maj: Record<string, unknown> = {};
    if (!connu.email && email) maj.email = email;
    if (!connu.telephone && telephone) maj.telephone = telephone;
    if (!connu.parcoursId) maj.parcoursId = travail.parcoursId;
    if (Object.keys(maj).length) await prisma.lead.update({ where: { id: leadId }, data: maj });
  } else {
    nouveau = true;
    const lead = await prisma.lead.create({
      data: {
        prenom: "Inconnu",
        nom: "Inconnu",
        email,
        telephone: telephone ?? "",
        ville: "Non renseignée",
        source: "SITE_SIMULATEUR",
        typeProjet: TYPE_PROJET[travail.projet] ?? "AUTRE",
        parcoursId: travail.parcoursId,
        campagne: travail.campagne,
        formulaire: "simulateur · me prévenir",
        ipOrigine: demande.ip && demande.ip !== "inconnue" ? demande.ip : null,
      },
    });
    leadId = lead.id;
  }
  const par = email && telephone ? `par e-mail (${email}) et par téléphone (${telephone})` : email ? `par e-mail (${email})` : `par téléphone (${telephone}) — aucun SMS automatique : à rappeler quand le rendu est prêt`;
  if (!dejaNotee) {
    await prisma.interaction.create({ data: { leadId, type: "NOTE", contenu: `En attente du rendu : a demandé à être prévenu ${par}. Simulation ${travail.projet} : ${teintesDe(references)}.` } });
  }
  await prisma.travailSimulation.update({ where: { id: travail.id }, data: { leadId, notifierEmail: email, notifierTelephone: telephone } });
  try {
    // La case cochée est la preuve du consentement au mail « simulation prête » : enregistrée comme par le webhook
    // (ligne consentementMail), une fois par demande — jamais rejouée pour la même demande.
    await rattacherLead(prisma, leadId, dejaNotee ? null : { accorde: true, moyen: "FORMULAIRE_SITE", recueilliLe: new Date(), preuve: (demande.consentementTexte?.trim() || TEXTE_CONSENTEMENT_PREVENIR).slice(0, 1000) });
  } catch (erreur) {
    console.error("[simulate] rattachement du client (non bloquant) :", erreur);
  }
  if (nouveau) await classerLeadSansBloquer(leadId);
  // Le téléphone de Lucas sonne comme pour une demande du webhook : nouveau contact, ou numéro à rappeler.
  if (nouveau || nouveauTelephone) {
    await alerterSansBloquer({
      leadId,
      prenom: "Inconnu",
      nom: "Inconnu",
      telephone: telephone ?? "",
      ville: null,
      typeProjet: TYPE_PROJET[travail.projet] ?? "AUTRE",
      source: "SITE_SIMULATEUR",
      campagne: travail.campagne,
      nouveau,
      simulations: 0,
      photos: 0,
      message: `En attente du rendu du simulateur : a demandé à être prévenu ${par}.`,
    });
  }

  // Le rendu a pu arriver pendant cette demande (la tâche a relu le travail avant l'adresse) : le statut est relu
  // maintenant, pas celui lu au départ ; `notifieLe` garantit qu'un seul mail part si les deux chemins l'appellent.
  const statut = (await prisma.travailSimulation.findUnique({ where: { id: travail.id }, select: { statut: true } }))?.statut;
  const notifie = statut === "PRETE" ? (await notifierTravailPret(travail.id)).envoye : false;
  return { leadId, nouveau, notifie };
}

/**
 * Le mail « simulation prête » : une fois par travail (`notifieLe` posé avant
 * l'envoi, rendu si l'envoi échoue), seulement avec une adresse, seulement si
 * l'interrupteur est actif. Rendu en pièce jointe, lien de reprise dans le corps.
 */
export async function notifierTravailPret(travailId: string): Promise<{ envoye: boolean; raison?: string }> {
  const travail = await prisma.travailSimulation.findUnique({ where: { id: travailId } });
  if (!travail || travail.statut !== "PRETE") return { envoye: false, raison: "Travail introuvable ou pas prêt." };
  if (!travail.notifierEmail) return { envoye: false, raison: "Aucune adresse e-mail demandée." };
  if (travail.notifieLe) return { envoye: false, raison: "Déjà envoyé." };
  if (!(await notificationSitePreteActive())) return { envoye: false, raison: "Interrupteur NOTIF_SIMULATION_SITE_PRETE coupé." };
  const { count } = await prisma.travailSimulation.updateMany({ where: { id: travailId, notifieLe: null }, data: { notifieLe: new Date() } });
  if (count !== 1) return { envoye: false, raison: "Déjà envoyé." };
  const rendre = () => prisma.travailSimulation.update({ where: { id: travailId }, data: { notifieLe: null } }).catch(() => undefined);
  try {
    const envoyeur = await envoyeurMail();
    if (!envoyeur) {
      await rendre();
      console.warn("[simulate] mail « simulation prête » non envoyé : aucun envoyeur configuré (boîte Gmail ou RESEND_API_KEY + EMAIL_FROM).");
      return { envoye: false, raison: "Aucun envoyeur de mail configuré." };
    }
    const chemins = await cheminsImagesTravail(travail);
    const rendu = chemins.apres ? await fs.readFile(path.join(resolveUploadsDir(), chemins.apres)).catch(() => null) : null;
    const mail = mailNotification(MODELE_SIMULATION_SITE_PRETE, { prenom: "", lien: lienDeReprise(travail.id, travail.parcoursId) });
    await envoyeur.envoyer({
      a: travail.notifierEmail,
      objet: mail.objet,
      texte: mail.texte,
      html: mail.html,
      repondreA: "contact@coverswap.fr",
      pieces: rendu ? [{ nom: `simulation-coverswap-${travail.projet}.png`, type: "image/png", contenu: rendu }] : undefined,
    });
    if (travail.leadId) await prisma.interaction.create({ data: { leadId: travail.leadId, type: "EMAIL", contenu: `Mail « simulation prête » envoyé à ${travail.notifierEmail} (rendu joint, lien de reprise du simulateur).` } }).catch(() => undefined);
    return { envoye: true };
  } catch (erreur) {
    await rendre();
    console.error("[simulate] mail « simulation prête » non envoyé :", erreur);
    return { envoye: false, raison: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}
