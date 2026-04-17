import prisma from "@/lib/prisma";
import { subDays, startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { fr } from "date-fns/locale";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const sixMonthsAgo = startOfMonth(subMonths(now, 5));

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
    facturesImpayees,
    facturesHistorique,
    acomptesActifs,
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
    // Factures impayees (urgent)
    prisma.facture.findMany({
      where: { statut: "IMPAYEE" },
      include: { devis: { include: { lead: true } } },
    }),
    // Historique 6 mois (pour sparkline)
    prisma.facture.findMany({
      where: { statut: "SOLDEE", soldeDate: { gte: sixMonthsAgo, lte: monthEnd } },
      select: { montantTotal: true, soldeDate: true },
    }),
    // Acomptes non encore soldés (tresorerie attendue)
    prisma.facture.findMany({
      where: { statut: { in: ["ACOMPTE_RECU", "ACOMPTE_EN_ATTENTE"] } },
      select: { montantTotal: true, acompteRecu: true },
    }),
  ]);

  const caTotal = facturesSoldeesTotal.reduce((s, f) => s + f.montantTotal, 0);
  const caMois = facturesSoldeesMois.reduce((s, f) => s + f.montantTotal, 0);
  const caPipeline = pipeline.reduce((s, l) => s + (l.prixDevis || 0), 0);
  const tauxConversion = leadsTotal > 0 ? Math.round((leadsSigned / leadsTotal) * 100) : 0;
  const panierMoyen = facturesSoldeesTotal.length > 0 ? caTotal / facturesSoldeesTotal.length : 0;

  // Impayes montant
  const impayesTotal = facturesImpayees.reduce((s, f) => s + f.montantTotal, 0);

  // Sparkline 6 mois
  const caHistorique: { month: string; ca: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = startOfMonth(subMonths(now, i));
    const mEnd = endOfMonth(subMonths(now, i));
    const monthTotal = facturesHistorique
      .filter((f) => f.soldeDate && f.soldeDate >= mStart && f.soldeDate <= mEnd)
      .reduce((s, f) => s + f.montantTotal, 0);
    caHistorique.push({
      month: format(mStart, "MMM", { locale: fr }),
      ca: monthTotal,
    });
  }

  // Tresorerie prévisionnelle : acomptes en attente (30%) + soldes à venir (70%)
  const tresoreriePrevue = acomptesActifs.reduce((s, f) => {
    const acompte = f.montantTotal * 0.3;
    const solde = f.montantTotal * 0.7;
    return s + (f.acompteRecu ? solde : acompte + solde);
  }, 0);

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
    impayesTotal,
    impayesCount: facturesImpayees.length,
    tresoreriePrevue,
    caHistorique,
    relances: JSON.parse(JSON.stringify(relances)),
    acomptesEnAttente: JSON.parse(JSON.stringify(acomptesEnAttente)),
    chantiersProchains: JSON.parse(JSON.stringify(chantiersProchains)),
    leadsRecents: JSON.parse(JSON.stringify(leadsRecents)),
    facturesImpayees: JSON.parse(JSON.stringify(facturesImpayees)),
    now: now.toISOString(),
  };

  return <DashboardClient data={data} />;
}
