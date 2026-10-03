import { ErreurMetier } from "@/lib/commun/erreurs";
import { enregistrerModeleNotification, EVENEMENTS_NOTIFIES, LIBELLES_NOTIFICATION, modeleNotification, type EvenementNotifie } from "@/lib/mail/notifications";
import { enregistrerParametre, lireParametre } from "@/lib/parametres/service";
import { lireModele, modifierModele } from "@/lib/sms/modeles";

/**
 * Les automatismes du CRM et leur interrupteur (mission 11) : tout ce qui part
 * chez un client sans un clic de Lucas, et les deux réglages de l'agent mail.
 * Une seule liste, lisible et réglable au même endroit — par l'écran
 * Paramètres et par l'assistant (« voir_parametres », « modifier_parametres »).
 * Aucun automatisme n'est ajouté ici : ceux qui existent deviennent débrayables. Mission 18 (A4) : les séquences de
 * mails sont retirées (leurs lignes `SequenceMail` restent en base, sans interrupteur) ; un code `SEQUENCE_…` est
 * désormais inconnu.
 */

export type FamilleAutomatisme = "ESPACE" | "SMS" | "AGENT";
export type Automatisme = { code: string; libelle: string; description: string; famille: FamilleAutomatisme; actif: boolean };

const CODE_SMS = "SMS_ACCUSE_RECEPTION";
const CODE_SMS_HORS_HORAIRES = "SMS_ACCUSE_RECEPTION_HORS_HORAIRES";
/** Paramètre (groupe Simulateur) et non modèle de notification de l'espace : le destinataire est un visiteur du site, sans dossier. */
const CODE_NOTIF_SIMULATION_SITE = "NOTIF_SIMULATION_SITE_PRETE";

export async function listerAutomatismes(): Promise<Automatisme[]> {
  const liste: Automatisme[] = [];
  for (const evenement of EVENEMENTS_NOTIFIES) {
    const modele = await modeleNotification(evenement);
    liste.push({ code: `NOTIF_${evenement}`, libelle: `Mail au client : ${LIBELLES_NOTIFICATION[evenement]}`, description: "Notification automatique de l'espace client, par mail, s'il a une adresse.", famille: "ESPACE", actif: modele.actif });
  }
  const accuse = await lireModele("ACCUSE_RECEPTION");
  liste.push({ code: CODE_SMS, libelle: "SMS d'accusé de réception (nouveau lead Meta)", description: "Le SMS envoyé automatiquement à un lead Meta dès sa réception (aux heures ouvrées).", famille: "SMS", actif: accuse?.actif ?? false });
  const horsHoraires = await lireModele("ACCUSE_RECEPTION_HORS_HORAIRES");
  if (horsHoraires) liste.push({ code: CODE_SMS_HORS_HORAIRES, libelle: "SMS d'accusé de réception, variante hors horaires", description: "La variante du SMS d'accusé de réception envoyée hors des heures ouvrées.", famille: "SMS", actif: horsHoraires.actif });
  // Mission 15 (partie 1) : le mail « simulation prête » du simulateur du site (« Me prévenir »), actif par défaut.
  const simulationSite = await lireParametre(CODE_NOTIF_SIMULATION_SITE);
  liste.push({ code: CODE_NOTIF_SIMULATION_SITE, libelle: "Mail au visiteur du site : simulation prête (« Me prévenir »)", description: "Un visiteur de coverswap.fr qui attend son rendu peut laisser son adresse : un seul mail part quand c'est prêt, avec l'image et le lien pour la retrouver. Jamais de SMS.", famille: "ESPACE", actif: simulationSite !== "INACTIF" });
  const ia = await lireParametre("IA_CRM_ACTIVE");
  liste.push({ code: "IA_CRM", libelle: "IA appelée par le CRM lui-même (clé du serveur, coût par appel)", description: "En pause : seul l'assistant Claude (MCP, abonnement) lit et rédige. Active : l'ancien chemin est de nouveau permis.", famille: "AGENT", actif: ia === "ACTIVE" });
  const rangement = await lireParametre("MAIL_RANGEMENT_GMAIL");
  liste.push({ code: "MAIL_RANGEMENT_GMAIL", libelle: "Rangement d'office dans Gmail", description: "Ce que le tri range est aussi marqué lu et rangé dans Gmail (réversible par « Remonter »).", famille: "AGENT", actif: rangement === "ACTIF" });
  return liste;
}

export async function lireAutomatisme(code: string): Promise<Automatisme> {
  const automatisme = (await listerAutomatismes()).find((a) => a.code === code);
  if (!automatisme) throw new ErreurMetier(`Automatisme inconnu : « ${code} ». Les codes valides sont ceux rendus par la liste des automatismes.`, 404);
  return automatisme;
}

/** Règle un interrupteur ; rend l'état d'avant et d'après. */
export async function reglerAutomatisme(code: string, actif: boolean, par: string): Promise<{ avant: Automatisme; apres: Automatisme }> {
  const avant = await lireAutomatisme(code);
  if (code === CODE_NOTIF_SIMULATION_SITE) {
    await enregistrerParametre({ cle: CODE_NOTIF_SIMULATION_SITE, valeur: actif ? "ACTIF" : "INACTIF", valableDu: new Date(), source: par });
  } else if (code.startsWith("NOTIF_")) {
    const evenement = code.slice("NOTIF_".length) as EvenementNotifie;
    const modele = await modeleNotification(evenement);
    await enregistrerModeleNotification(evenement, { ...modele, actif }, par);
  } else if (code === CODE_SMS || code === CODE_SMS_HORS_HORAIRES) {
    const modele = await lireModele(code === CODE_SMS ? "ACCUSE_RECEPTION" : "ACCUSE_RECEPTION_HORS_HORAIRES");
    if (!modele) throw new ErreurMetier("Modèle de SMS introuvable.", 404);
    await modifierModele(modele.id, { actif });
  } else if (code === "IA_CRM") {
    await enregistrerParametre({ cle: "IA_CRM_ACTIVE", valeur: actif ? "ACTIVE" : "EN_PAUSE", valableDu: new Date(), source: par });
  } else if (code === "MAIL_RANGEMENT_GMAIL") {
    await enregistrerParametre({ cle: "MAIL_RANGEMENT_GMAIL", valeur: actif ? "ACTIF" : "INACTIF", valableDu: new Date(), source: par });
  } else {
    throw new ErreurMetier(`Automatisme « ${code} » sans interrupteur.`, 400);
  }
  return { avant, apres: await lireAutomatisme(code) };
}
