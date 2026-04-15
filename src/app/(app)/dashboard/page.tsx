import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";
import { subDays, startOfMonth, endOfMonth, differenceInDays } from "date-fns";
import Link from "next/link";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    facturesSoldeesTotal,
    facturesSoldeesMois,
    leadsTotal,
    leadsSigned,
    leadsNouveaux,
    devisTotal,
    pipeline,
    relances,
    acomptesEnAttente,
    chantiersProchains,
    leadsRecents,
  ] = await Promise.all([
    prisma.facture.findMany({ where: { statut: "SOLDEE" } }),
    prisma.facture.findMany({
      where: { statut: "SOLDEE", soldeDate: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.lead.count(),
    prisma.lead.count({
      where: { statut: { in: ["SIGNE", "CHANTIER_PLANIFIE", "TERMINE"] } },
    }),
    prisma.lead.count({ where: { statut: "NOUVEAU" } }),
    prisma.devis.count(),
    prisma.lead.findMany({
      where: {
        statut: { in: ["NOUVEAU", "CONTACTE", "DEVIS_ENVOYE"] },
        prixDevis: { not: null },
      },
    }),
    prisma.lead.findMany({
      where: {
        statut: { in: ["NOUVEAU", "CONTACTE"] },
        updatedAt: { lt: subDays(now, 5) },
      },
      orderBy: { prixDevis: "desc" },
      take: 5,
    }),
    prisma.facture.findMany({
      where: { statut: "ACOMPTE_EN_ATTENTE", acompteRecu: false },
      include: { devis: { include: { lead: true } } },
    }),
    prisma.chantier.findMany({
      where: {
        dateIntervention: { gte: now, lte: subDays(now, -14) },
        statut: { notIn: ["TERMINE", "FACTURE"] },
      },
      include: { lead: true },
      orderBy: { dateIntervention: "asc" },
      take: 5,
    }),
    // Derniers leads (pour mode simple)
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const caTotal = facturesSoldeesTotal.reduce((s, f) => s + f.montantTotal, 0);
  const caMois = facturesSoldeesMois.reduce((s, f) => s + f.montantTotal, 0);
  const caPipeline = pipeline.reduce((s, l) => s + (l.prixDevis || 0), 0);
  const tauxConversion = leadsTotal > 0 ? Math.round((leadsSigned / leadsTotal) * 100) : 0;
  const panierMoyen = facturesSoldeesTotal.length > 0 ? caTotal / facturesSoldeesTotal.length : 0;

  const data = {
    caTotal,
    caMois,
    caPipeline,
    tauxConversion,
    panierMoyen,
    leadsTotal,
    leadsNouveaux,
    leadsSigned,
    devisTotal,
    relances: JSON.parse(JSON.stringify(relances)),
    acomptesEnAttente: JSON.parse(JSON.stringify(acomptesEnAttente)),
    chantiersProchains: JSON.parse(JSON.stringify(chantiersProchains)),
    leadsRecents: JSON.parse(JSON.stringify(leadsRecents)),
    now: now.toISOString(),
  };

  return <DashboardClient data={data} />;
}
