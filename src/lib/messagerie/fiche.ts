/**
 * Mission 25 (lot 6) — ce que la fiche dossier lit de la messagerie pour l'en-tête de ses sections : la conversation
 * (non lue ou non, dernier échange, messages prêts à envoyer), les simulations (nombre, dernière publiée, vue ou non),
 * l'espace (dernière visite), la zone, les pièces et la surface dites. Une lecture : rien n'est écrit.
 */
import prisma from "@/lib/prisma";
import { chargerEtat } from "./etat";
import { lancementMessagerie } from "./suivis";
import { avecImages, premiersSms, vueDuMessage, type MessageVue } from "./vues";
import type { Zone } from "./zone";

export type FicheSuivi = {
  conversation: { nonLue: boolean; dernier: { le: string; texte: string; sens: string } | null; prets: MessageVue[] };
  simulations: { nombre: number; derniereLe: string | null; vue: boolean };
  espace: { ouvert: boolean; derniereVisite: string | null; lienCommunique: boolean };
  zone: Zone;
  pieces: string[];
  surface: string | null;
};

export async function ficheDuSuivi(suiviId: string, maintenant: Date = new Date()): Promise<FicheSuivi | null> {
  const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
  if (!suivi) return null;
  const { etat } = await chargerEtat(suivi, await lancementMessagerie(maintenant), maintenant);
  const ouverts = await prisma.messagePrepare.findMany({ where: { suiviId, statut: { in: ["A_ENVOYER", "A_VALIDER"] } }, orderBy: { prevuLe: "asc" } });
  const premier = (await premiersSms([suiviId])).has(suiviId);
  const sims = etat.simulations.filter((s) => s.source !== "SITE").sort((a, b) => b.publieeLe.getTime() - a.publieeLe.getTime());
  const nonLue = suivi.nonLu || (suivi.dernierSens === "CLIENT" && Boolean(suivi.dernierEchangeLe) && (!suivi.luLe || suivi.luLe.getTime() < suivi.dernierEchangeLe!.getTime()));
  return {
    conversation: {
      nonLue,
      dernier: suivi.dernierEchangeLe ? { le: suivi.dernierEchangeLe.toISOString(), texte: suivi.dernierExtrait ?? "", sens: suivi.dernierSens ?? "" } : null,
      prets: await avecImages(ouverts.map((m) => vueDuMessage(m, premier))),
    },
    simulations: { nombre: sims.length, derniereLe: sims[0]?.publieeLe.toISOString() ?? null, vue: Boolean(sims[0]?.vueLe) },
    espace: { ouvert: Boolean(etat.espace), derniereVisite: etat.espace?.dernierAccesLe?.toISOString() ?? null, lienCommunique: etat.espace?.lienCommunique ?? false },
    zone: etat.zone,
    pieces: etat.faits.pieces.length ? etat.faits.pieces : etat.piece.connue ? [etat.piece.nom] : [],
    surface: etat.faits.surface,
  };
}
