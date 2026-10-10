import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { envoyerSms } from "./envoi";
import { fournisseurSms } from "./fournisseurs";
import { lireModele } from "./modeles";
import { estMobileFrancais, remplirModele } from "./texte";

/**
 * Accusé de réception : LE SEUL SMS qui part sans validation.
 *
 * Dans la minute qui suit un nouveau lead, un message fixe (rédigé une fois par
 * Lucas, modifiable dans Paramètres) annonce son appel : c'est ce qui fait
 * décrocher. Le soir et le dimanche, la variante « demain matin » part à la
 * place, si elle est active — promettre un appel « dans les prochaines minutes »
 * à 23 h serait un mensonge.
 *
 * Jamais bloquant, jamais deux fois pour la même personne, jamais vers un
 * numéro en STOP, un fixe ou un numéro étranger.
 */
const HEURE_DEBUT = 8 * 60 + 30;
const HEURE_FIN = 19 * 60 + 30;

/** Heure de Paris : le serveur tourne en UTC. */
export function estHeureOuvree(date: Date = new Date()): boolean {
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const lire = (type: string) => parties.find((p) => p.type === type)?.value ?? "";
  if (lire("weekday").toLowerCase().startsWith("dim")) return false;
  const minutes = Number(lire("hour")) * 60 + Number(lire("minute"));
  return minutes >= HEURE_DEBUT && minutes < HEURE_FIN;
}

export type ResultatAccuse = { envoye: boolean; raison: string; smsId?: string };

/**
 * Mission 25 : l'accusé par le fournisseur est remplacé par A1, le premier message de la messagerie (cahier « Relances
 * et messagerie », § Plan de construction : « les anciens circuits […] accusé par fournisseur sont remplacés par le
 * moteur, pas dupliqués »). Le nouveau lead déclenche le balayage de la messagerie : A1 est prêt quelques secondes plus
 * tard, avec l'alerte sur le téléphone ; en mode Manuel, c'est Lucas qui l'envoie. Rien ne part plus d'ici.
 */
export async function envoyerAccuseDeReception(leadId: string, maintenant: Date = new Date()): Promise<ResultatAccuse> {
  void leadId;
  void maintenant;
  const { signalerMessagerie } = await import("@/lib/messagerie/taches");
  await signalerMessagerie();
  return { envoye: false, raison: "remplacé par A1 (messagerie)" };
}

/** L'ancien accusé par le fournisseur (avant la mission 25), gardé pour le lot 8 (passerelle Android) et l'historique. */
export async function envoyerAccuseParFournisseur(leadId: string, maintenant: Date = new Date()): Promise<ResultatAccuse> {
  try {
    if (!fournisseurSms()) return { envoye: false, raison: "aucun fournisseur de SMS configuré" };
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, prenom: true, telephone: true, archiveLe: true, clientId: true } });
    if (!lead || lead.archiveLe) return { envoye: false, raison: "contact introuvable ou archivé" };
    const numero = normaliserTelephone(lead.telephone);
    if (!estMobileFrancais(numero)) return { envoye: false, raison: "pas un numéro de mobile français" };

    const principal = await lireModele("ACCUSE_RECEPTION");
    if (!principal?.actif) return { envoye: false, raison: "accusé de réception désactivé" };
    const variante = estHeureOuvree(maintenant) ? null : await lireModele("ACCUSE_RECEPTION_HORS_HORAIRES");
    const modele = variante?.actif ? variante : principal;

    // Un seul accusé par personne : ni deux formulaires remplis coup sur coup, ni un rejeu du webhook, n'en font partir un second.
    const conversation = await prisma.conversationSms.findUnique({ where: { numero: numero! }, select: { id: true, stopLe: true } });
    if (conversation?.stopLe) return { envoye: false, raison: "numéro en STOP" };
    if (conversation) {
      const dejaEcrit = await prisma.sms.count({ where: { conversationId: conversation.id, sens: "SORTANT", createdAt: { gte: new Date(maintenant.getTime() - 7 * 86_400_000) } } });
      if (dejaEcrit > 0) return { envoye: false, raison: "un SMS est déjà parti vers ce numéro cette semaine" };
    }

    const prenom = /^inconnu$/i.test(lead.prenom.trim()) ? "" : lead.prenom.trim().split(/\s+/)[0];
    const texte = remplirModele(modele.texte, { prenom });
    const sms = await envoyerSms({ numero: numero!, rattachement: { leadId: lead.id, clientId: lead.clientId }, texte, origine: "ACCUSE_AUTO", modele: modele.code, textePropose: texte, cleEnvoi: `accuse:${lead.id}` });
    return { envoye: true, raison: modele.code, smsId: sms.id };
  } catch (erreur) {
    console.error(`[sms] accusé de réception du contact ${leadId} impossible (non bloquant) :`, erreur);
    return { envoye: false, raison: erreur instanceof Error ? erreur.message : "erreur" };
  }
}
