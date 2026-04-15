import prisma from "./prisma";
import { subDays, addDays, startOfDay, endOfDay } from "date-fns";

export async function getAlertes() {
  const now = new Date();

  const leadsNonTraites = await prisma.lead.findMany({
    where: {
      statut: { in: ["NOUVEAU", "CONTACTE"] },
      updatedAt: { lt: subDays(now, 5) },
    },
    orderBy: { prixDevis: "desc" },
    take: 10,
  });

  const acomptesEnAttente = await prisma.facture.findMany({
    where: {
      statut: "ACOMPTE_EN_ATTENTE",
      acompteRecu: false,
    },
    include: { devis: { include: { lead: true } } },
  });

  const chantiersProchains = await prisma.chantier.findMany({
    where: {
      dateIntervention: {
        gte: startOfDay(now),
        lte: endOfDay(addDays(now, 7)),
      },
    },
    include: { lead: true, commandes: true },
  });

  const commandesUrgentes = await prisma.commande.findMany({
    where: {
      statut: { in: ["A_COMMANDER", "COMMANDEE"] },
      chantier: {
        dateIntervention: { lte: addDays(now, 7) },
      },
    },
    include: { chantier: { include: { lead: true } } },
  });

  return { leadsNonTraites, acomptesEnAttente, chantiersProchains, commandesUrgentes };
}
