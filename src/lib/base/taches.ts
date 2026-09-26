import { jourParis } from "@/lib/dossiers/dates";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { dossierSauvegardes, purgerSauvegardes, RETENTION, sauvegardeDuJourExiste, sauvegarderBase } from "./sauvegarde.mjs";
import { enregistrerTachesSauvegardeDrive } from "./sauvegarde-drive";

/**
 * Sauvegardes en arrière-plan (mission 10) : une copie vérifiée de la base par
 * jour civil (les copies d'avant migration et de démarrage continuent à part),
 * puis la purge au-delà de la rétention — 7 quotidiennes, 4 hebdomadaires —,
 * faite par une tâche, donc journalisée dans Tâches de fond avec son bilan.
 */

export const NOM_SAUVEGARDE_QUOTIDIENNE = "sauvegarde-quotidienne";
export const TYPE_PURGE_SAUVEGARDES = "PURGE_SAUVEGARDES";
export const MOTIF_QUOTIDIENNE = "quotidienne";

const mo = (octets: number) => `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;

/** Une base SQLite locale seulement (pas Turso) : là où une copie a un sens. */
const baseLocale = () => Boolean(process.env.DATABASE_URL?.startsWith("file:")) && !process.env.TURSO_DATABASE_URL;

/** La sauvegarde du jour, si elle manque ; rend vrai quand une copie a été faite. */
export async function sauvegardeQuotidienne(maintenant = new Date()): Promise<{ faite: boolean; fichier?: string; raison?: string }> {
  const dossier = dossierSauvegardes();
  if (!dossier) return { faite: false, raison: "base non locale" };
  const jour = jourParis(maintenant);
  if (sauvegardeDuJourExiste(dossier, MOTIF_QUOTIDIENNE, maintenant.toISOString().slice(0, 10)) || sauvegardeDuJourExiste(dossier, MOTIF_QUOTIDIENNE, jour)) return { faite: false, raison: "déjà faite aujourd'hui" };
  const resultat = await sauvegarderBase({ raison: MOTIF_QUOTIDIENNE });
  if ("ignoree" in resultat) return { faite: false, raison: resultat.ignoree };
  return { faite: true, fichier: resultat.fichier };
}

export type BilanPurge = { gardees: number; purgees: string[]; octetsLiberes: number; resume: string };

/** La purge, telle que la tâche l'exécute et la journalise. */
export function purgeJournalisee(): BilanPurge {
  const dossier = dossierSauvegardes();
  if (!dossier) return { gardees: 0, purgees: [], octetsLiberes: 0, resume: "Base non locale : rien à purger." };
  const bilan = purgerSauvegardes(dossier);
  const resume = bilan.purgees.length
    ? `${bilan.purgees.length} sauvegarde(s) purgée(s) (${mo(bilan.octetsLiberes)} libérés) ; ${bilan.gardees.length} gardée(s) : ${RETENTION.quotidiennes} quotidiennes + ${RETENTION.hebdomadaires} hebdomadaires au plus.`
    : `Rien à purger : ${bilan.gardees.length} sauvegarde(s) dans la rétention (${RETENTION.quotidiennes} quotidiennes + ${RETENTION.hebdomadaires} hebdomadaires).`;
  return { gardees: bilan.gardees.length, purgees: bilan.purgees, octetsLiberes: bilan.octetsLiberes, resume };
}

export function enregistrerTachesSauvegardes(): void {
  enregistrerTraitement(TYPE_PURGE_SAUVEGARDES, {
    libelle: "Sauvegardes : purge au-delà de la rétention (7 quotidiennes + 4 hebdomadaires)",
    acteur: "SYSTEME:sauvegardes",
    tentativesMax: 2,
    executer: async () => purgeJournalisee(),
  });
  enregistrerTravailPeriodique({
    nom: NOM_SAUVEGARDE_QUOTIDIENNE,
    libelle: "Sauvegarde quotidienne de la base (une copie vérifiée par jour), puis purge journalisée",
    acteur: "SYSTEME:sauvegardes",
    intervalleMs: 60 * 60_000,
    estActif: baseLocale,
    executer: async () => {
      const maintenant = new Date();
      const copie = await sauvegardeQuotidienne(maintenant);
      if (copie.faite) console.log(`[sauvegarde] Quotidienne : ${copie.fichier}`);
      // La purge du jour : une tâche (journalisée dans Tâches de fond), une fois par jour.
      await mettreEnFile({ type: TYPE_PURGE_SAUVEGARDES, cle: `purge-sauvegardes:${jourParis(maintenant)}`, charge: { jour: jourParis(maintenant) }, priorite: -1 });
    },
  });
  // Mission 13 (lot 2) : une copie chiffrée hors de l'hébergeur, chaque semaine (Google Drive).
  enregistrerTachesSauvegardeDrive();
}
