import prisma from "@/lib/prisma";
import { normaliserEmail } from "@/lib/clients/normalisation";
import { EMETTEUR } from "@/lib/dossiers/constants";
import { lienPourLeProjet } from "@/lib/espace/liens";
import { programmerEnvoi } from "./envoi-crm";

/**
 * Les notifications de l'espace client, par mail (mission 7) — le mail prend
 * le relais du SMS. AUTOMATIQUES, sans validation, parce que ce sont des
 * messages fixes et attendus (décision de Lucas) : simulation publiée, devis
 * disponible, paiement reçu, projet terminé (avec l'invitation à laisser un
 * avis). Un mail sobre, une phrase, un bouton vers son espace.
 *
 * Un seul mail par événement (clé unique de l'envoi), seulement si l'adresse
 * est connue et valide et que l'espace est ouvert. Chaque envoi s'inscrit dans
 * l'historique du dossier et dans l'onglet Mail. Rien d'autre ne part seul.
 */

export const EVENEMENTS_NOTIFIES = ["SIMULATION_PUBLIEE", "DEVIS_DISPONIBLE", "PAIEMENT_RECU", "PROJET_TERMINE", "MESSAGE_LUCAS"] as const;
export type EvenementNotifie = (typeof EVENEMENTS_NOTIFIES)[number];

export type ModeleNotification = { objet: string; phrase: string; bouton: string; actif: boolean };

export const LIBELLES_NOTIFICATION: Record<EvenementNotifie, string> = {
  SIMULATION_PUBLIEE: "Simulation publiée",
  DEVIS_DISPONIBLE: "Devis disponible",
  PAIEMENT_RECU: "Paiement reçu",
  PROJET_TERMINE: "Projet terminé (invitation à laisser un avis)",
  MESSAGE_LUCAS: "Réponse de CoverSwap dans l'espace (mission 10)",
};

/** Les textes par défaut ; modifiables dans Paramètres (variables : {prenom}, {montant}, {message}). */
export const MODELES_PAR_DEFAUT: Record<EvenementNotifie, ModeleNotification> = {
  SIMULATION_PUBLIEE: { objet: "Votre simulation est prête", phrase: "Votre simulation est prête : découvrez votre pièce rénovée dans votre espace CoverSwap.", bouton: "Voir ma simulation", actif: true },
  DEVIS_DISPONIBLE: { objet: "Votre devis est disponible", phrase: "Votre devis est disponible dans votre espace : lisez-le à votre rythme, et donnez votre accord en ligne quand vous êtes prêt.", bouton: "Voir mon devis", actif: true },
  PAIEMENT_RECU: { objet: "Paiement bien reçu, merci", phrase: "Nous avons bien reçu votre paiement de {montant} : merci ! Le détail est dans votre espace.", bouton: "Voir mon espace", actif: true },
  PROJET_TERMINE: { objet: "Votre chantier est terminé : merci !", phrase: "Votre chantier est terminé : merci pour votre confiance. Si le résultat vous plaît, votre avis nous aide beaucoup — il se donne en un clic depuis votre espace.", bouton: "Donner mon avis", actif: true },
  MESSAGE_LUCAS: { objet: "CoverSwap vous a répondu", phrase: "CoverSwap vous a répondu dans votre espace : « {message} »", bouton: "Lire la réponse", actif: true },
};

const ANCRES: Record<EvenementNotifie, string> = { SIMULATION_PUBLIEE: "#simulations", DEVIS_DISPONIBLE: "#devis", PAIEMENT_RECU: "#paiement", PROJET_TERMINE: "#apres", MESSAGE_LUCAS: "#contact" };

export async function modeleNotification(evenement: EvenementNotifie): Promise<ModeleNotification> {
  const ligne = await prisma.reglageTexte.findUnique({ where: { cle: `NOTIF_${evenement}` } });
  if (!ligne) return MODELES_PAR_DEFAUT[evenement];
  try {
    return { ...MODELES_PAR_DEFAUT[evenement], ...(JSON.parse(ligne.valeur) as Partial<ModeleNotification>) };
  } catch {
    return MODELES_PAR_DEFAUT[evenement];
  }
}

export async function enregistrerModeleNotification(evenement: EvenementNotifie, modele: ModeleNotification, par: string): Promise<void> {
  const valeur = JSON.stringify({ objet: modele.objet.trim().slice(0, 150), phrase: modele.phrase.trim().slice(0, 600), bouton: modele.bouton.trim().slice(0, 40), actif: modele.actif });
  await prisma.reglageTexte.upsert({ where: { cle: `NOTIF_${evenement}` }, create: { cle: `NOTIF_${evenement}`, valeur, par }, update: { valeur, par } });
}

const echapper = (texte: string) => texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Le mail aux couleurs de CoverSwap : le mot, la phrase, le bouton. Texte brut à côté, pour tous les lecteurs. */
export function mailNotification(modele: ModeleNotification, valeurs: { prenom: string; montant?: string | null; message?: string | null; lien: string }): { objet: string; texte: string; html: string } {
  const remplir = (texte: string) => texte.replace(/\{prenom\}/g, valeurs.prenom).replace(/\{montant\}/g, valeurs.montant ?? "").replace(/\{message\}/g, valeurs.message ?? "");
  const bonjour = valeurs.prenom ? `Bonjour ${valeurs.prenom},` : "Bonjour,";
  const phrase = remplir(modele.phrase);
  const signature = `Lucas · CoverSwap · ${EMETTEUR.telephone}`;
  const texte = `${bonjour}\n\n${phrase}\n\n${modele.bouton} : ${valeurs.lien}\n\n${signature}\nUne question ? Répondez simplement à ce mail.`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${echapper(remplir(modele.objet))}</title></head>
<body style="margin:0;padding:0;background:#F5F4F1;color:#1A1A1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F4F1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#FFFFFF;border-radius:16px">
<tr><td style="padding:28px 28px 0;font-size:21px;font-weight:700;letter-spacing:-0.01em">Cover<span style="color:#CC0000">Swap</span></td></tr>
<tr><td style="padding:24px 28px 0;font-size:17px;line-height:1.55">${echapper(bonjour)}</td></tr>
<tr><td style="padding:8px 28px 0;font-size:17px;line-height:1.55">${echapper(phrase)}</td></tr>
<tr><td style="padding:28px 28px 0"><a href="${echapper(valeurs.lien)}" style="display:inline-block;background:#CC0000;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:16px;line-height:1;padding:15px 24px;border-radius:12px">${echapper(modele.bouton)}</a></td></tr>
<tr><td style="padding:28px 28px 28px;font-size:13px;line-height:1.55;color:#6B665F">${echapper(signature)}<br>Une question ? Répondez simplement à ce mail.</td></tr>
</table></td></tr></table></body></html>`;
  return { objet: remplir(modele.objet), texte, html };
}

/**
 * Programme la notification d'un événement de l'espace (une seule fois par
 * `cle`). Rend pourquoi rien n'est parti, le cas échéant (jamais d'erreur :
 * une notification manquée ne bloque pas le geste de Lucas).
 */
export async function notifierClient(evenement: EvenementNotifie, dossierId: string, cle: string, valeurs: { montant?: string | null; message?: string | null } = {}): Promise<{ programme: boolean; raison?: string }> {
  try {
    const modele = await modeleNotification(evenement);
    if (!modele.actif) return { programme: false, raison: "Modèle désactivé dans Paramètres." };
    const dossier = await prisma.dossier.findUnique({
      where: { id: dossierId },
      select: { id: true, archiveLe: true, clientEmail: true, clientNom: true, clientId: true, leadId: true, client: { select: { prenom: true, emails: { where: { archiveLe: null }, orderBy: { principale: "desc" }, take: 1, select: { adresse: true } } } }, lead: { select: { prenom: true } }, espaces: { where: { archiveLe: null }, take: 1 } },
    });
    if (!dossier || dossier.archiveLe) return { programme: false, raison: "Dossier introuvable ou archivé." };
    const adresse = normaliserEmail(dossier.clientEmail) ?? normaliserEmail(dossier.client?.emails[0]?.adresse);
    if (!adresse) return { programme: false, raison: "Aucune adresse e-mail valide pour ce client." };
    const espace = dossier.espaces[0];
    const lien = espace ? await lienPourLeProjet(espace) : null;
    if (!lien) return { programme: false, raison: "Espace client fermé ou lien désactivé." };
    const prenomBrut = (dossier.client?.prenom || dossier.lead?.prenom || dossier.clientNom.split(" ")[0] || "").trim();
    const prenom = /^(inconnu|client)$/i.test(prenomBrut) ? "" : prenomBrut.split(/\s+/)[0];
    const mail = mailNotification(modele, { prenom, montant: valeurs.montant, message: valeurs.message, lien: `${lien}${ANCRES[evenement]}` });
    const { deja } = await programmerEnvoi({ cle: `notif:${evenement}:${cle}`, nature: "NOTIFICATION", modele: evenement, a: adresse, objet: mail.objet, texte: mail.texte, html: mail.html, dossierId, clientId: dossier.clientId, leadId: dossier.leadId });
    return deja ? { programme: false, raison: "Déjà envoyé pour cet événement." } : { programme: true };
  } catch (erreur) {
    console.error(`[notifications] ${evenement} ${dossierId} :`, erreur);
    return { programme: false, raison: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

/** Paiements enregistrés à l'instant sur un dossier : chacun est notifié une fois (quel que soit le chemin d'enregistrement). */
export async function notifierPaiementsRecents(dossierId: string): Promise<void> {
  const evenements = await prisma.dossierEvenement.findMany({
    where: { dossierId, type: "ENCAISSEMENT_ENREGISTRE", archiveLe: null, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
    select: { metadata: true },
  });
  for (const e of evenements) {
    try {
      const { encaissementId, montant } = JSON.parse(e.metadata) as { encaissementId?: string; montant?: number };
      if (!encaissementId) continue;
      await notifierClient("PAIEMENT_RECU", dossierId, encaissementId, { montant: typeof montant === "number" ? `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : null });
    } catch {
      // métadonnée illisible : pas de notification
    }
  }
}
