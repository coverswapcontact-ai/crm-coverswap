import prisma from "@/lib/prisma";
import { formatEuros } from "@/lib/utils";
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
    { label: "CA ce mois", value: formatEuros(caThisMonth), icon: Euro, color: "text-emerald-500", bg: "bg-emerald-50" },
    {
      label: "Evolution vs M-1",
      value: `${evolution >= 0 ? "+" : ""}${evolution}%`,
      icon: evolution >= 0 ? TrendingUp : TrendingDown,
      color: evolution >= 0 ? "text-emerald-500" : "text-red-500",
      bg: evolution >= 0 ? "bg-emerald-50" : "bg-red-50",
    },
    { label: "CA total", value: formatEuros(caTotal), icon: PiggyBank, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Marge chantiers", value: formatEuros(margeChantiers), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Taux de marge", value: `${tauxMarge}%`, icon: Percent, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Marge devis signes", value: formatEuros(margeDevis), icon: Receipt, color: "text-purple-500", bg: "bg-purple-50" },
  ];

  // Monthly recap: last 6 months
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
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Finances</h1>
        <p className="text-gray-400 mt-0.5 text-[14px]">Suivi financier CoverSwap</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="glass-card p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-gray-400 font-medium">{kpi.label}</p>
                <p className="text-[20px] font-bold text-gray-900 mt-1 truncate">{kpi.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${kpi.bg} flex items-center justify-center shrink-0`}>
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CA mensuel barchart */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-gray-900 px-1">CA mensuel (6 derniers mois)</h2>
        <div className="glass-card p-5">
          <div className="flex items-end gap-3 h-48">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                <span className="text-[10px] text-gray-500 font-medium truncate">
                  {m.ca >= 1000 ? `${(m.ca / 1000).toFixed(1)}k` : formatEuros(m.ca)}
                </span>
                <div
                  className="w-full bg-[#CC0000] rounded-t-md hover:bg-[#AA0000] transition-colors"
                  style={{ height: `${Math.max((m.ca / maxCa) * 100, 2)}%` }}
                />
                <span className="text-[10px] text-gray-400 capitalize">{m.month}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
