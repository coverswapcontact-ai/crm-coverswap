import prisma from "@/lib/prisma";
import { sourcesDeLaTache } from "./moteur";

/**
 * Mission 17 (partie A) — ce que l'écran /taches et la navigation lisent en plus de `lecture.ts`.
 *
 * L'onglet Mail compte désormais les tâches : celles à faire (ou revenues d'un « Plus tard » dont la date est passée)
 * qui viennent du mail ou des messages de l'espace client — la source de la tâche, ou l'une des sources qui la voient
 * (`donnees.sourcesVues`, posé par le moteur quand plusieurs détecteurs voient la même tâche).
 */

const SOURCES_MAIL = ["MAIL", "ESPACE_MESSAGES"];

export async function compterMailATraiter(maintenant: Date = new Date()): Promise<number> {
  const lignes = await prisma.tacheAFaire.findMany({
    where: {
      archiveLe: null,
      AND: [
        { OR: [{ statut: "A_FAIRE" }, { statut: "PLUS_TARD", plusTardJusqua: { lte: maintenant } }] },
        { OR: [{ source: { in: SOURCES_MAIL } }, { donnees: { contains: "sourcesVues" } }] },
      ],
    },
    select: { source: true, donnees: true },
  });
  return lignes.filter((ligne) => sourcesDeLaTache(ligne).some((source) => SOURCES_MAIL.includes(source))).length;
}
