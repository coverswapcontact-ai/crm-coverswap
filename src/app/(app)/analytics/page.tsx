import prisma from "@/lib/prisma";
import { formatEuros, sourceLabel } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  // Use groupBy and aggregations instead of loading all records
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

  // Conversion stats per source
  const sources = ["META_ADS", "TIKTOK", "INSTAGRAM", "ORGANIQUE", "REFERENCE", "AUTRE"];
  const signedStatuts = ["SIGNE", "CHANTIER_PLANIFIE", "TERMINE"];

  // Build CA by source from devis
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

    return {
      source: src,
      label: sourceLabel(src),
      total: totalForSource,
      signed: signedForSource,
      lost: lostForSource,
      taux,
      ca,
    };
  });

  // Top references
  const topRefs = topRefsRaw.map((r) => ({
    reference: r.reference,
    count: r._count.id,
    ca: r._sum.prixVente || 0,
    marge: r._sum.margeNette || 0,
  }));

  // Type projet stats
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

  // Global KPIs
  const totalLeads = totalLeadsCount;
  const totalSigned = totalSignedCount;
  const globalConversion = totalLeads > 0 ? Math.round((totalSigned / totalLeads) * 100) : 0;
  const totalCA = devisSignedAgg._sum.prixVente || 0;
  const totalMarge = devisSignedAgg._sum.margeNette || 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-gray-400 mt-1">Analyse de performance CoverSwap</p>
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Leads Total", value: totalLeads.toString(), icon: Layers, color: "text-blue-400" },
          { label: "Taux Conversion", value: `${globalConversion}%`, icon: Target, color: "text-yellow-400" },
          { label: "CA Signe", value: formatEuros(totalCA), icon: TrendingUp, color: "text-green-400" },
          { label: "Marge Totale", value: formatEuros(totalMarge), icon: BarChart3, color: "text-emerald-400" },
        ].map((kpi) => (
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

      {/* Conversion par source */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Conversion par Source</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Source</TableHead>
                <TableHead className="text-gray-400 text-right">Leads</TableHead>
                <TableHead className="text-gray-400 text-right">Signes</TableHead>
                <TableHead className="text-gray-400 text-right">Perdus</TableHead>
                <TableHead className="text-gray-400 text-right">Taux</TableHead>
                <TableHead className="text-gray-400 text-right">CA Genere</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceStats.map((s) => (
                <TableRow key={s.source} className="border-white/10 hover:bg-white/5">
                  <TableCell>
                    <Badge variant="outline" className="border-white/20 text-white">
                      {s.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-white text-right">{s.total}</TableCell>
                  <TableCell className="text-green-400 text-right">{s.signed}</TableCell>
                  <TableCell className="text-red-400 text-right">{s.lost}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={
                        s.taux >= 30
                          ? "text-green-400"
                          : s.taux >= 15
                            ? "text-yellow-400"
                            : "text-red-400"
                      }
                    >
                      {s.taux}%
                    </span>
                  </TableCell>
                  <TableCell className="text-red-400 font-bold text-right">
                    {formatEuros(s.ca)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top References */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Top References (Devis Signes)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Reference</TableHead>
                <TableHead className="text-gray-400 text-right">Nb Devis</TableHead>
                <TableHead className="text-gray-400 text-right">CA</TableHead>
                <TableHead className="text-gray-400 text-right">Marge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topRefs.map((ref) => (
                <TableRow key={ref.reference} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white font-mono">{ref.reference}</TableCell>
                  <TableCell className="text-white text-right">{ref.count}</TableCell>
                  <TableCell className="text-red-400 font-bold text-right">
                    {formatEuros(ref.ca)}
                  </TableCell>
                  <TableCell className="text-green-400 text-right">
                    {formatEuros(ref.marge)}
                  </TableCell>
                </TableRow>
              ))}
              {topRefs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-gray-500 py-8">
                    Aucun devis signe
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Conversion par Type Projet */}
      <Card className="bg-[#262626] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Performance par Type de Projet</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-gray-400">Type</TableHead>
                <TableHead className="text-gray-400 text-right">Leads</TableHead>
                <TableHead className="text-gray-400 text-right">Signes</TableHead>
                <TableHead className="text-gray-400 text-right">Taux</TableHead>
                <TableHead className="text-gray-400 text-right">CA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeStats.map((t) => (
                <TableRow key={t.type} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-white">{t.type}</TableCell>
                  <TableCell className="text-white text-right">{t.total}</TableCell>
                  <TableCell className="text-green-400 text-right">{t.signed}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={
                        t.taux >= 30
                          ? "text-green-400"
                          : t.taux >= 15
                            ? "text-yellow-400"
                            : "text-red-400"
                      }
                    >
                      {t.taux}%
                    </span>
                  </TableCell>
                  <TableCell className="text-red-400 font-bold text-right">
                    {formatEuros(t.ca)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
