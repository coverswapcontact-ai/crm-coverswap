import prisma from "@/lib/prisma";
import { alerter } from "@/lib/alertes/canaux";
import { CANAUX_PUSH } from "@/lib/alertes/configuration";
import { aHeureParis } from "@/lib/commercial/quand";
import { pluriel } from "@/lib/commun/format";
import { jourParis } from "@/lib/dossiers/dates";
import { lireParametre } from "@/lib/parametres/service";
import { listeTaches } from "./lecture";

/**
 * Mission 17 (partie A, lot 2) : la notification du matin — « Tâches du jour : 7 tâches aujourd'hui, environ 45 min ».
 * Une fois par jour, à partir de 8 h (Paris), sur les canaux poussés (Telegram, ntfy, push web), si le paramètre
 * NOTIF_TACHES_MATIN vaut Oui (Oui quand il n'a jamais été saisi) et qu'il y a au moins une tâche aujourd'hui.
 * Dédoublonnée par le registre des alertes (AlerteEnvoi, origine « taches-matin », jour de Paris) : un redémarrage ne
 * la renvoie pas. Rien n'est jamais envoyé aux clients. Lancée par le travail périodique « taches-matin » (taches.ts).
 */

export const ORIGINE_MATIN = "taches-matin";
export const HEURE_MATIN = 8;
export const CLE_PARAMETRE_MATIN = "NOTIF_TACHES_MATIN";

/** Garde en mémoire (même processus) : si l'écriture dans AlerteEnvoi échouait, pas un envoi toutes les 15 minutes. */
const CLE_MEMOIRE = "__coverswapTachesMatin";
const memoire = globalThis as unknown as Record<string, string | undefined>;

/** Essais : oublie le jour gardé en mémoire (le registre AlerteEnvoi reste la vraie garde). */
export function oublierEnvoiDuMatin(): void {
  memoire[CLE_MEMOIRE] = undefined;
}

export type ResultatMatin = { envoyee: boolean; raison: string; texte?: string };

/** « 45 min », « 1 h », « 1 h 15 ». */
export function dureeLisible(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const heures = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${heures} h ${String(reste).padStart(2, "0")}` : `${heures} h`;
}

export async function notifierTachesDuMatin(maintenant: Date = new Date()): Promise<ResultatMatin> {
  if (maintenant.getTime() < aHeureParis(maintenant, 0, HEURE_MATIN).getTime()) return { envoyee: false, raison: `avant ${HEURE_MATIN} h` };
  const reglage = await lireParametre(CLE_PARAMETRE_MATIN, maintenant);
  if ((reglage ?? "OUI") !== "OUI") return { envoyee: false, raison: "notification du matin coupée (Paramètres → Pilotage)" };
  const jour = jourParis(maintenant);
  if (memoire[CLE_MEMOIRE] === jour) return { envoyee: false, raison: "déjà envoyée aujourd'hui" };
  const deja = await prisma.alerteEnvoi.findFirst({ where: { origine: ORIGINE_MATIN, createdAt: { gte: aHeureParis(maintenant, 0, 0), lt: aHeureParis(maintenant, 1, 0) } }, select: { id: true } });
  if (deja) {
    memoire[CLE_MEMOIRE] = jour;
    return { envoyee: false, raison: "déjà envoyée aujourd'hui" };
  }
  const { compteurs } = await listeTaches(maintenant);
  if (compteurs.aujourdhui === 0) return { envoyee: false, raison: "aucune tâche aujourd'hui" };
  const texte = `${pluriel(compteurs.aujourdhui, "tâche", "tâches")} aujourd'hui, environ ${dureeLisible(compteurs.minutesAujourdhui)}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
  memoire[CLE_MEMOIRE] = jour;
  await alerter({ titre: "Tâches du jour", texte, lien: `${appUrl}/taches`, libelleLien: "Voir mes tâches", etiquette: "taches-matin" }, { canaux: CANAUX_PUSH, origine: ORIGINE_MATIN });
  return { envoyee: true, raison: "envoyée", texte };
}
