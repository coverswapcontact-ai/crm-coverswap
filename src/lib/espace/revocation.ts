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
 */
export const JOURS_AVANT_REVOCATION = 90;
export const TYPE_TACHE_REVOCATION = "REVOCATION_ESPACES";
export const NOM_TRAVAIL_REVOCATION = "revocation-espaces-termines";
export const MOTIF_REVOCATION = `automatique : ${JOURS_AVANT_REVOCATION} jours après l'encaissement du dernier chantier (mission 13)`;

const JOUR_MS = 24 * 60 * 60_000;
const ETAPES_CLOSES = new Set(["ENCAISSE", "PERDU"]);

export type EspaceARevoquer = { permanentId: string; clientNom: string; encaisseLe: Date; dossiers: number };

/** Les espaces dont le lien peut être désactivé aujourd'hui. Lecture seule. */
export async function espacesARevoquer(maintenant: Date = new Date()): Promise<EspaceARevoquer[]> {
  const permanents = await prisma.espacePermanent.findMany({
    where: { revoqueLe: null, fusionneDansId: null },
    select: { id: true, client: { select: { nom: true } }, projets: { select: { dossier: { select: { id: true, etape: true, archiveLe: true, updatedAt: true } } } } },
  });
  const limite = maintenant.getTime() - JOURS_AVANT_REVOCATION * JOUR_MS;
  const candidats: EspaceARevoquer[] = [];
  for (const permanent of permanents) {
    const dossiers = permanent.projets.map((p) => p.dossier);
    if (dossiers.length === 0) continue;
    if (!dossiers.every((d) => d.archiveLe !== null || ETAPES_CLOSES.has(d.etape))) continue;
    const encaisses = dossiers.filter((d) => d.etape === "ENCAISSE");
    if (encaisses.length === 0) continue;
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
    await desactiverLien(c.permanentId, MOTIF_REVOCATION);
    revoques.push({ permanentId: c.permanentId, clientNom: c.clientNom, encaisseLe: c.encaisseLe.toISOString() });
  }
  const examines = await prisma.espacePermanent.count({ where: { revoqueLe: null, fusionneDansId: null } });
  return { examines: examines + revoques.length, revoques };
}

export function enregistrerTachesRevocation(): void {
  enregistrerTraitement(TYPE_TACHE_REVOCATION, {
    libelle: `Espaces clients : liens désactivés ${JOURS_AVANT_REVOCATION} jours après l'encaissement`,
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
