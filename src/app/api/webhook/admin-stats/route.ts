import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Endpoint diagnostic TEMPORAIRE — lecture seule.
 * Auth via header X-Webhook-Secret (même secret que /api/webhook).
 * Retourne:
 *   - count par source
 *   - count par jour (sur les N derniers jours)
 *   - sample des 10 derniers leads
 * À supprimer après usage.
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Total + répartition par source
  const total = await prisma.lead.count();
  const bySource = await prisma.lead.groupBy({
    by: ["source"],
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });

  // Répartition par jour sur les 30 derniers jours
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recent = await prisma.lead.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: {
      id: true,
      prenom: true,
      nom: true,
      telephone: true,
      email: true,
      source: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Agrégation par jour (YYYY-MM-DD en UTC)
  const byDay = new Map<string, { total: number; sources: Record<string, number> }>();
  for (const lead of recent) {
    const day = lead.createdAt.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { total: 0, sources: {} });
    const entry = byDay.get(day)!;
    entry.total++;
    entry.sources[lead.source] = (entry.sources[lead.source] || 0) + 1;
  }

  const byDayArr = Array.from(byDay.entries())
    .map(([day, data]) => ({ day, ...data }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // Liste des 20 derniers leads (pour inspection)
  const latest = recent.slice(0, 20).map((l) => ({
    id: l.id,
    prenom: l.prenom,
    nom: l.nom,
    telephone: l.telephone,
    email: l.email,
    source: l.source,
    createdAt: l.createdAt.toISOString(),
  }));

  return NextResponse.json({
    total,
    bySource: bySource.map((s) => ({ source: s.source, count: s._count._all })),
    last30DaysByDay: byDayArr,
    latest20: latest,
  });
}
