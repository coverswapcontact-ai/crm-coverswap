import prisma from "@/lib/prisma";
import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { TACHE_ENVOI_SMS, TENTATIVES_ENVOI, executerEnvoiSms } from "./envoi";
import { fournisseurSms } from "./fournisseurs";
import { publierEvenementSms } from "./flux";
import { enregistrerSmsEntrant } from "./reception";

/**
 * Ce que la messagerie SMS fait en arrière-plan :
 *  - SMS_ENVOI : un message quitte le CRM (réessais si le réseau flanche) ;
 *  - sms-releve : toutes les trente secondes, les réponses des clients sont
 *    relevées chez le fournisseur (OVH n'a pas de webhook) ;
 *  - sms-remises : l'état de remise des envois récents (envoyé → délivré ou échec).
 */
const RECOUVREMENT_MS = 15 * 60_000;

/** Relève les SMS arrivés depuis le dernier connu (avec recouvrement : l'identifiant du fournisseur écarte les doublons). */
export async function releverSmsEntrants(): Promise<{ releves: number; nouveaux: number }> {
  const fournisseur = fournisseurSms();
  if (!fournisseur?.releverEntrants) return { releves: 0, nouveaux: 0 };
  const dernier = await prisma.sms.findFirst({ where: { sens: "ENTRANT", fournisseur: fournisseur.nom }, orderBy: { recuLe: "desc" }, select: { recuLe: true } });
  const depuis = new Date((dernier?.recuLe?.getTime() ?? Date.now() - 48 * 3_600_000) - RECOUVREMENT_MS);
  const entrants = await fournisseur.releverEntrants(depuis);
  let nouveaux = 0;
  for (const entrant of entrants) {
    const resultat = await enregistrerSmsEntrant(entrant, fournisseur.nom);
    if (resultat?.nouveau) nouveaux++;
  }
  return { releves: entrants.length, nouveaux };
}

/** Met à jour l'état de remise des envois des trois derniers jours encore « envoyés ». */
export async function suivreRemises(): Promise<{ suivis: number; changes: number }> {
  const fournisseur = fournisseurSms();
  if (!fournisseur?.etat) return { suivis: 0, changes: 0 };
  const enCours = await prisma.sms.findMany({
    where: { sens: "SORTANT", statut: "ENVOYE", fournisseur: fournisseur.nom, identifiantFournisseur: { not: null }, envoyeLe: { gte: new Date(Date.now() - 72 * 3_600_000) } },
    orderBy: { envoyeLe: "asc" },
    take: 40,
    select: { id: true, identifiantFournisseur: true, conversationId: true },
  });
  let changes = 0;
  for (const sms of enCours) {
    try {
      const etat = await fournisseur.etat(sms.identifiantFournisseur!);
      if (!etat || etat.statut === "ENVOYE") continue;
      await prisma.sms.update({
        where: { id: sms.id },
        data: etat.statut === "DELIVRE" ? { statut: "DELIVRE", delivreLe: etat.le ?? new Date() } : { statut: "ECHEC", erreur: etat.detail ?? "Non remis par l'opérateur." },
      });
      publierEvenementSms({ genre: "STATUT", conversationId: sms.conversationId, smsId: sms.id });
      changes++;
    } catch (erreur) {
      console.error(`[sms] état de remise du message ${sms.id} illisible :`, erreur);
    }
  }
  return { suivis: enCours.length, changes };
}

export function enregistrerTachesSms(): void {
  enregistrerTraitement(TACHE_ENVOI_SMS, {
    libelle: "SMS : envoi d'un message",
    acteur: "SYSTEME:sms",
    tentativesMax: TENTATIVES_ENVOI,
    delaiMaxMs: 45_000,
    executer: async (charge, contexte) => {
      const { smsId } = charge as { smsId: string };
      return executerEnvoiSms(smsId, contexte.tentative);
    },
  });

  enregistrerTravailPeriodique({
    nom: "sms-releve",
    libelle: "SMS : relève des réponses des clients",
    acteur: "SYSTEME:sms",
    intervalleMs: 30_000,
    estActif: () => Boolean(fournisseurSms()?.releverEntrants),
    executer: async () => {
      await releverSmsEntrants();
    },
  });

  enregistrerTravailPeriodique({
    nom: "sms-remises",
    libelle: "SMS : suivi de remise des envois",
    acteur: "SYSTEME:sms",
    intervalleMs: 120_000,
    estActif: () => Boolean(fournisseurSms()?.etat),
    executer: async () => {
      await suivreRemises();
    },
  });
}
