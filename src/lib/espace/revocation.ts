import prisma from "@/lib/prisma";
import { jourParis } from "@/lib/dossiers/dates";
import { mettreEnFile } from "@/lib/taches/file";
import { enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { desactiverLien } from "./gestion";

/**
 * Mission 13 (lot 2) — révocation automatique du lien d'espace 90 jours après
 * « encaissé ». Un espace dont tous les projets sont clos (encaissés, perdus ou
 * archivés), dont au moins un chantier a été encaissé, et dont le dernier
 * encaissement date de plus de 90 jours, n'a plus de raison de rester ouvert
 * par un lien qui circule dans des SMS. Le lien est désactivé (rien n'est
 * effacé : un nouveau lien le rouvre, l'espace et ses données restent) ; le
 * dossier de référence reçoit l'événement avec le motif. Une tâche par jour,
 * journalisée dans Tâches de fond avec la liste des espaces désactivés.
 *
 * Mission 18 (relecture, écart 13) : un espace dont TOUS les projets sont perdus ou archivés (aucun encaissé) suit la
 * même règle, depuis la clôture du dernier projet (`dernierProjetClosLe` : la perte, l'archivage). Le passage en
 * « Perdu » ne ferme pas le lien tout de suite (le client relit son projet « non réalisé », le dossier peut reprendre) ;
 * le contrôle de cohérence ne signale un lien resté actif qu'une fois ce délai passé (`ESPACE_ACTIF_DOSSIER_CLOS`).
 */
export const JOURS_AVANT_REVOCATION = 90;
export const TYPE_TACHE_REVOCATION = "REVOCATION_ESPACES";
export const NOM_TRAVAIL_REVOCATION = "revocation-espaces-termines";
export const MOTIF_REVOCATION = `automatique : ${JOURS_AVANT_REVOCATION} jours après l'encaissement du dernier chantier (mission 13)`;
export const MOTIF_REVOCATION_CLOS = `automatique : ${JOURS_AVANT_REVOCATION} jours après la clôture du dernier projet (perdu ou archivé, mission 18)`;

const JOUR_MS = 24 * 60 * 60_000;
const ETAPES_CLOSES = new Set(["ENCAISSE", "PERDU"]);

export type EspaceARevoquer = { permanentId: string; clientNom: string; encaisseLe: Date; dossiers: number; /** Mission 18 : aucun chantier encaissé, tous perdus ou archivés. */ clos?: boolean };

/**
 * Mission 18 (relecture) : la date où le dernier projet d'un espace s'est clos — perdu (date de la perte, sinon dernière
 * modification) ou archivé (date de l'archivage) ; null si un projet est encore vivant ou encaissé. Pure.
 */
export function dernierProjetClosLe(dossiers: readonly { etape: string; archiveLe: Date | null; perteLe: Date | null; updatedAt: Date }[]): Date | null {
  if (dossiers.length === 0) return null;
  let dernier = 0;
  for (const d of dossiers) {
    if (d.archiveLe) dernier = Math.max(dernier, d.archiveLe.getTime());
    else if (d.etape === "PERDU") dernier = Math.max(dernier, (d.perteLe ?? d.updatedAt).getTime());
    else return null;
  }
  return new Date(dernier);
}

/** Le lien d'un espace dont tous les projets sont clos depuis `jours` jours (le délai de la révocation automatique) ? */
export function closDepuisLeDelai(closLe: Date | null, maintenant: Date, jours = JOURS_AVANT_REVOCATION): boolean {
  return Boolean(closLe && closLe.getTime() <= maintenant.getTime() - jours * JOUR_MS);
}

/** Les espaces dont le lien peut être désactivé aujourd'hui. Lecture seule. */
export async function espacesARevoquer(maintenant: Date = new Date()): Promise<EspaceARevoquer[]> {
  const permanents = await prisma.espacePermanent.findMany({
    where: { revoqueLe: null, fusionneDansId: null },
    select: { id: true, client: { select: { nom: true } }, projets: { select: { dossier: { select: { id: true, etape: true, archiveLe: true, updatedAt: true, perteLe: true } } } } },
  });
  const limite = maintenant.getTime() - JOURS_AVANT_REVOCATION * JOUR_MS;
  const candidats: EspaceARevoquer[] = [];
  for (const permanent of permanents) {
    const dossiers = permanent.projets.map((p) => p.dossier);
    if (dossiers.length === 0) continue;
    if (!dossiers.every((d) => d.archiveLe !== null || ETAPES_CLOSES.has(d.etape))) continue;
    const encaisses = dossiers.filter((d) => d.etape === "ENCAISSE");
    if (encaisses.length === 0) {
      // Mission 18 (relecture) : tous perdus ou archivés — le même délai, depuis la clôture du dernier projet.
      const closLe = dernierProjetClosLe(dossiers);
      if (closLe && closDepuisLeDelai(closLe, maintenant)) candidats.push({ permanentId: permanent.id, clientNom: permanent.client.nom, encaisseLe: closLe, dossiers: dossiers.length, clos: true });
      continue;
    }
    // La date du dernier encaissement : le passage à « Encaissé » dans l'historique, sinon la dernière modification du dossier.
    const passage = await prisma.dossierEvenement.findFirst({
      where: { dossierId: { in: encaisses.map((d) => d.id) }, type: "CHANGEMENT_ETAPE", metadata: { contains: '"vers":"ENCAISSE"' } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const encaisseLe = passage?.createdAt ?? new Date(Math.max(...encaisses.map((d) => d.updatedAt.getTime())));
    if (encaisseLe.getTime() > limite) continue;
    candidats.push({ permanentId: permanent.id, clientNom: permanent.client.nom, encaisseLe, dossiers: dossiers.length });
  }
  return candidats;
}

export type BilanRevocation = { examines: number; revoques: { permanentId: string; clientNom: string; encaisseLe: string }[] };

/** Désactive les liens échus. Rend le bilan (journalisé par la tâche). */
export async function revoquerEspacesTermines(maintenant: Date = new Date()): Promise<BilanRevocation> {
  const candidats = await espacesARevoquer(maintenant);
  const revoques: BilanRevocation["revoques"] = [];
  for (const c of candidats) {
    await desactiverLien(c.permanentId, c.clos ? MOTIF_REVOCATION_CLOS : MOTIF_REVOCATION);
    revoques.push({ permanentId: c.permanentId, clientNom: c.clientNom, encaisseLe: c.encaisseLe.toISOString() });
  }
  const examines = await prisma.espacePermanent.count({ where: { revoqueLe: null, fusionneDansId: null } });
  return { examines: examines + revoques.length, revoques };
}

export function enregistrerTachesRevocation(): void {
  enregistrerTraitement(TYPE_TACHE_REVOCATION, {
    libelle: `Espaces clients : liens désactivés ${JOURS_AVANT_REVOCATION} jours après l'encaissement (ou la clôture des projets perdus)`,
    acteur: "SYSTEME:espace",
    tentativesMax: 2,
    executer: async () => revoquerEspacesTermines(),
  });
  enregistrerTravailPeriodique({
    nom: NOM_TRAVAIL_REVOCATION,
    libelle: `Espaces clients : désactivation des liens ${JOURS_AVANT_REVOCATION} jours après l'encaissement (une tâche par jour)`,
    acteur: "SYSTEME:espace",
    intervalleMs: 6 * 60 * 60_000,
    executer: async () => {
      const jour = jourParis(new Date());
      await mettreEnFile({ type: TYPE_TACHE_REVOCATION, cle: `revocation-espaces:${jour}`, charge: { jour }, priorite: -1 });
    },
  });
}
