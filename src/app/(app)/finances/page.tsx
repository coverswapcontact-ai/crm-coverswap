import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Euro, TrendingUp, TrendingDown, Percent, Receipt, PiggyBank } from "lucide-react";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { fr } from "date-fns/locale";

export default async function FinancesPage() {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const prevMonthStart = startOfMonth(subMonths(now, 1));
  const prevMonthEnd = endOfMonth(subMonths(now, 1));

  const [
    facturesSoldeesThisMonth,
    facturesSoldeesPrevMonth,
    totalFactures,
    chantiersTermines,
    devisSigned,
    allFactures,
  ] = await Promise.all([
    prisma.facture.findMany({
      where: { statut: "SOLDEE", soldeDate: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.facture.findMany({
      where: { statut: "SOLDEE", soldeDate: { gte: prevMonthStart, lte: prevMonthEnd } },
    }),
    prisma.facture.aggregate({ _sum: { montantTotal: true } }),
    prisma.chantier.findMany({ where: { statut: "TERMINE" } }),
    prisma.devis.findMany({ where: { statut: "SIGNE" } }),
    prisma.facture.findMany({ include: { devis: true } }),
  ]);

  const caThisMonth = facturesSoldeesThisMonth.reduce((s, f) => s + f.montantTotal, 0);
  const caPrevMonth = facturesSoldeesPrevMonth.reduce((s, f) => s + f.montantTotal, 0);
  const caTotal = totalFactures._sum.montantTotal || 0;
  const margeChantiers = chantiersTermines.reduce((s, c) => s + c.margeNette, 0);
  const margeDevis = devisSigned.reduce((s, d) => s + d.margeNette, 0);
  const prixMatiereTotal = allFactures.reduce((s, f) => s + f.devis.prixMatiere, 0);
  const tauxMarge = caTotal > 0 ? Math.round(((caTotal - prixMatiereTotal) / caTotal) * 100) : 0;

  const evolution =
    caPrevMonth > 0
      ? Math.round(((caThisMonth - caPrevMonth) / caPrevMonth) * 100)
      : caThisMonth > 0
        ? 100
        : 0;

  const kpis = [
    { label: "CA Ce Mois", value: formatEuros(caThisMonth), icon: Euro, color: "text-green-400" },
    {
      label: "Evolution vs M-1",
      value: `${evolution >= 0 ? "+" : ""}${evolution}%`,
      icon: evolution >= 0 ? TrendingUp : TrendingDown,
      color: evolution >= 0 ? "text-green-400" : "text-red-400",
    },
    { label: "CA Total", value: formatEuros(caTotal), icon: PiggyBank, color: "text-blue-400" },
    { label: "Marge Chantiers", value: formatEuros(margeChantiers), icon: TrendingUp, color: "text-emerald-400" },
    { label: "Taux de Marge", value: `${tauxMarge}%`, icon: Percent, color: "text-yellow-400" },
    { label: "Marge Devis Signes", value: formatEuros(margeDevis), icon: Receipt, color: "text-purple-400" },
  ];

  // Monthly recap: last 6 months - single query instead of N+1
  const sixMonthsAgo = startOfMonth(subMonths(now, 5));
  const allSoldees6Months = await prisma.facture.findMany({
    where: { statut: "SOLDEE", soldeDate: { gte: sixMonthsAgo, lte: monthEnd } },
  });

  const monthlyData: { month: string; ca: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = startOfMonth(subMonths(now, i));
    const mEnd = endOfMonth(subMonths(now, i));
    const monthFactures = allSoldees6Months.filter(
      (f) => f.soldeDate && f.soldeDate >= mStart && f.soldeDate <= mEnd
    );
    monthlyData.push({
      month: format(mStart, "MMM yyyy", { locale: fr }),
      ca: monthFactures.reduce((s, f) => s + f.montantTotal, 0),
    });
  }

  const maxCa = Math.max(...monthlyData.map((m) => m.ca), 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Finances</h1>
        <p className="text-gray-400 mt-1">Suivi financier CoverSwap</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="bg-[#262626] border-white/10">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">{kpi.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{kpi.value}</p>
                </div>
                <kpi.icon className={`h-8 w-8 ${kpi.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Simple bar chart */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">CA Mensuel (6 derniers mois)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 h-48">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-xs text-gray-400">{formatEuros(m.ca)}</span>
                <div
                  className="w-full bg-red-600/80 rounded-t"
                  style={{ height: `${Math.max((m.ca / maxCa) * 100, 2)}%` }}
                />
                <span className="text-xs text-gray-500">{m.month}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
