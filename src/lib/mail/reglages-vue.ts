import prisma from "@/lib/prisma";
import { EVENEMENTS_NOTIFIES, LIBELLES_NOTIFICATION, modeleNotification, type EvenementNotifie, type ModeleNotification } from "./notifications";
import { lireGuideStyle, type GuideStyle } from "./redaction";
import { TYPE_REGLE_TRI } from "./propositions-maj";
import { listerPropositions } from "@/lib/validation/service";
import type { PropositionVue } from "@/lib/validation/types";

/**
 * Mission 13 (lot 3) — ce que Paramètres → Mail affiche : lu par la page
 * (rendu serveur) et par GET /api/mail/reglages (après une modification).
 */
export type ReglagesMailVue = {
  guide: GuideStyle;
  modeles: (ModeleNotification & { evenement: EvenementNotifie; libelle: string })[];
  regles: { id: string; cible: string; action: string; motif: string | null; createdAt: string }[];
  proposees: PropositionVue[];
};

export async function reglagesMail(): Promise<ReglagesMailVue> {
  const [guide, modeles, regles, proposees] = await Promise.all([
    lireGuideStyle(),
    Promise.all(EVENEMENTS_NOTIFIES.map(async (evenement) => ({ evenement, libelle: LIBELLES_NOTIFICATION[evenement], ...(await modeleNotification(evenement)) }))),
    prisma.regleExpediteur.findMany({ where: { archiveLe: null }, orderBy: { createdAt: "desc" }, take: 300, select: { id: true, cible: true, action: true, motif: true, createdAt: true } }),
    listerPropositions({ type: TYPE_REGLE_TRI, statuts: ["EN_ATTENTE"], limite: 50 }),
  ]);
  return { guide, modeles, regles: regles.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), proposees };
}
