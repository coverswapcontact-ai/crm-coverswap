import { texteDeLEvenement } from "@/lib/espace/messages";
import type { MigrationDonnees } from "./index";

const SOURCES: Record<string, "MESSAGE" | "COMMENTAIRE" | "PROPOSITION"> = { ESPACE_MESSAGE: "MESSAGE", ESPACE_COMMENTAIRE: "COMMENTAIRE", ESPACE_NOUVELLE_PROPOSITION: "PROPOSITION" };

/**
 * Mission 10 : les messages écrits par les clients dans leur espace avant la
 * table `MessageEspace` (événements ESPACE_MESSAGE, ESPACE_COMMENTAIRE,
 * ESPACE_NOUVELLE_PROPOSITION) la rejoignent, à leur date, marqués lus (Lucas
 * en a été alerté à l'époque) : le fil est complet pour le client comme pour
 * l'assistant, sans réveiller de « non lu » d'il y a des semaines.
 */
export const migrationMessagesEspace: MigrationDonnees = {
  nom: "2026-09-23-messages-espace",
  description: "Reprend les messages, commentaires et demandes d'autre proposition des clients (événements du dossier) dans la table des messages d'espace, marqués lus",
  async executer(client) {
    const evenements = await client.dossierEvenement.findMany({
      where: { type: { in: Object.keys(SOURCES) }, direction: "ENTRANT", archiveLe: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, contenu: true, metadata: true, createdAt: true, survenuLe: true, dossierId: true },
    });
    const deja = new Set((await client.messageEspace.findMany({ where: { evenementId: { not: null } }, select: { evenementId: true } })).map((m) => m.evenementId));
    let repris = 0;
    let vides = 0;
    for (const e of evenements) {
      if (deja.has(e.id)) continue;
      const texte = texteDeLEvenement(e.contenu);
      if (!texte) {
        vides++;
        continue;
      }
      let simulationId: string | null = null;
      let espaceId: string | null = null;
      try {
        const meta = JSON.parse(e.metadata || "{}") as { simulationId?: string | null; espaceId?: string | null };
        simulationId = typeof meta.simulationId === "string" ? meta.simulationId : null;
        espaceId = typeof meta.espaceId === "string" ? meta.espaceId : null;
      } catch {
        // métadonnée illisible : le message est repris sans son rattachement
      }
      const le = e.survenuLe ?? e.createdAt;
      await client.messageEspace.create({ data: { dossierId: e.dossierId, espaceId, auteur: "CLIENT", source: SOURCES[e.type], texte, simulationId, evenementId: e.id, luLe: le, createdAt: le } });
      repris++;
    }
    return { repris, vides, dejaRepris: deja.size };
  },
};
