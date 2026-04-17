import prisma from "@/lib/prisma";
import { formatEuros, sourceLabel } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart3, Target, TrendingUp, Layers } from "lucide-react";

export default async function AnalyticsPage() {
  const [
    leadsBySource,
    leadsByStatutAndSource,
    leadsByTypeProjet,
    leadsByStatutAndType,
    totalLeadsCount,
    totalSignedCount,
    devisSignedAgg,
    devisSignedBySource,
    topRefsRaw,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["source"], _count: { id: true } }),
    prisma.lead.groupBy({
      by: ["source", "statut"],
      _count: { id: true },
    }),
    prisma.lead.groupBy({ by: ["typeProjet"], _count: { id: true } }),
    prisma.lead.groupBy({
      by: ["typeProjet", "statut"],
      _count: { id: true },
      _sum: { prixDevis: true },
    }),
    prisma.lead.count(),
    prisma.lead.count({
      where: { statut: { in: ["SIGNE", "CHANTIER_PLANIFIE", "TERMINE"] } },
    }),
    prisma.devis.aggregate({
      where: { statut: "SIGNE" },
      _sum: { prixVente: true, margeNette: true },
    }),
    prisma.devis.findMany({
      where: { statut: "SIGNE" },
      select: { prixVente: true, lead: { select: { source: true } } },
    }),
    prisma.devis.groupBy({
      by: ["reference"],
      where: { statut: "SIGNE" },
      _count: { id: true },
      _sum: { prixVente: true, margeNette: true },
      orderBy: { _sum: { prixVente: "desc" } },
      take: 10,
    }),
  ]);

  const sources = ["META_ADS", "TIKTOK", "INSTAGRAM", "ORGANIQUE", "REFERENCE", "AUTRE"];
  const signedStatuts = ["SIGNE", "CHANTIER_PLANIFIE", "TERMINE"];

  const caBySource = new Map<string, number>();
  devisSignedBySource.forEach((d) => {
    const src = d.lead.source;
    caBySource.set(src, (caBySource.get(src) || 0) + d.prixVente);
  });

  const sourceStats = sources.map((src) => {
    const totalForSource = leadsBySource.find((g) => g.source === src)?._count.id || 0;
    const signedForSource = leadsByStatutAndSource
      .filter((g) => g.source === src && signedStatuts.includes(g.statut))
      .reduce((s, g) => s + g._count.id, 0);
    const lostForSource = leadsByStatutAndSource
      .find((g) => g.source === src && g.statut === "PERDU")?._count.id || 0;
    const ca = caBySource.get(src) || 0;
    const taux = totalForSource > 0 ? Math.round((signedForSource / totalForSource) * 100) : 0;
    return { source: src, label: sourceLabel(src), total: totalForSource, signed: signedForSource, lost: lostForSource, taux, ca };
  });

  const topRefs = topRefsRaw.map((r) => ({
    reference: r.reference,
    count: r._count.id,
    ca: r._sum.prixVente || 0,
    marge: r._sum.margeNette || 0,
  }));

  const typeStatsMap = new Map<string, { total: number; signed: number; ca: number }>();
  leadsByTypeProjet.forEach((g) => {
    typeStatsMap.set(g.typeProjet, { total: g._count.id, signed: 0, ca: 0 });
  });
  leadsByStatutAndType.forEach((g) => {
    if (signedStatuts.includes(g.statut)) {
      const existing = typeStatsMap.get(g.typeProjet) || { total: 0, signed: 0, ca: 0 };
      existing.signed += g._count.id;
      existing.ca += g._sum.prixDevis || 0;
      typeStatsMap.set(g.typeProjet, existing);
    }
  });

  const typeStats = Array.from(typeStatsMap.entries())
    .map(([type, data]) => ({
      type,
      ...data,
      taux: data.total > 0 ? Math.round((data.signed / data.total) * 100) : 0,
    }))
    .sort((a, b) => b.ca - a.ca);

  const totalLeads = totalLeadsCount;
  const totalSigned = totalSignedCount;
  const globalConversion = totalLeads > 0 ? Math.round((totalSigned / totalLeads) * 100) : 0;
  const totalCA = devisSignedAgg._sum.prixVente || 0;
  const totalMarge = devisSignedAgg._sum.margeNette || 0;

  const tauxClass = (t: number) =>
    t >= 30 ? "text-emerald-600" : t >= 15 ? "text-amber-500" : "text-red-500";

  const kpis = [
    { label: "Leads total", value: totalLeads.toString(), icon: Layers, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Conversion", value: `${globalConversion}%`, icon: Target, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "CA signe", value: formatEuros(totalCA), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Marge totale", value: formatEuros(totalMarge), icon: BarChart3, color: "text-[#CC0000]", bg: "bg-red-50" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight">Analytics</h1>
        <p className="text-gray-400 mt-0.5 text-[14px]">Analyse de performance CoverSwap</p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Conversion par source */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-gray-900 px-1">Conversion par source</h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Source</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Leads</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Signes</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Perdus</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Taux</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">CA genere</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceStats.map((s) => (
                  <TableRow key={s.source} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell>
                      <span className="text-[11px] font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                        {s.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-900 text-[13px] text-right">{s.total}</TableCell>
                    <TableCell className="text-emerald-600 font-medium text-[13px] text-right">{s.signed}</TableCell>
                    <TableCell className="text-red-500 text-[13px] text-right">{s.lost}</TableCell>
                    <TableCell className={`text-right text-[13px] font-medium ${tauxClass(s.taux)}`}>{s.taux}%</TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(s.ca)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* Top References */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-gray-900 px-1">Top references (devis signes)</h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Reference</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Nb devis</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">CA</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Marge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topRefs.map((ref) => (
                  <TableRow key={ref.reference} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 font-mono text-[12px]">{ref.reference}</TableCell>
                    <TableCell className="text-gray-900 text-[13px] text-right">{ref.count}</TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(ref.ca)}
                    </TableCell>
                    <TableCell className="text-emerald-600 text-[13px] text-right font-medium">
                      {formatEuros(ref.marge)}
                    </TableCell>
                  </TableRow>
                ))}
                {topRefs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-gray-400 py-8 text-[13px]">
                      Aucun devis signe
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* Type Projet */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-gray-900 px-1">Performance par type de projet</h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-100 hover:bg-transparent">
                  <TableHead className="text-gray-500 text-[12px] font-semibold">Type</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Leads</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Signes</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">Taux</TableHead>
                  <TableHead className="text-gray-500 text-[12px] font-semibold text-right">CA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {typeStats.map((t) => (
                  <TableRow key={t.type} className="border-gray-50 hover:bg-gray-50/60">
                    <TableCell className="text-gray-900 text-[13px] font-medium">{t.type}</TableCell>
                    <TableCell className="text-gray-900 text-[13px] text-right">{t.total}</TableCell>
                    <TableCell className="text-emerald-600 font-medium text-[13px] text-right">{t.signed}</TableCell>
                    <TableCell className={`text-right text-[13px] font-medium ${tauxClass(t.taux)}`}>{t.taux}%</TableCell>
                    <TableCell className="text-right text-[#CC0000] font-semibold text-[13px]">
                      {formatEuros(t.ca)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>
    </div>
  );
}
