import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/** Diagnostic TEMPORAIRE — GET = stats, DELETE = purge par IDs. Auth via webhook secret. */
function checkAuth(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  const expected = process.env.WEBHOOK_SECRET;
  return !!expected && secret === expected;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const total = await prisma.lead.count();
  const bySource = await prisma.lead.groupBy({
    by: ["source"],
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recent = await prisma.lead.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: {
      id: true, prenom: true, nom: true, telephone: true, email: true, source: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

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

  const latest = recent.slice(0, 30).map((l) => ({
    id: l.id, prenom: l.prenom, nom: l.nom, telephone: l.telephone, email: l.email,
    source: l.source, createdAt: l.createdAt.toISOString(),
  }));

  return NextResponse.json({
    total,
    bySource: bySource.map((s) => ({ source: s.source, count: s._count._all })),
    last30DaysByDay: byDayArr,
    latest30: latest,
  });
}

export async function DELETE(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  let body: { ids?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "Fournir ids[]" }, { status: 400 });

  const matches = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, prenom: true, nom: true, telephone: true, email: true },
  });
  if (matches.length === 0) return NextResponse.json({ deleted: [], note: "Aucun lead correspondant" });

  await prisma.lead.deleteMany({ where: { id: { in: matches.map((l) => l.id) } } });
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return NextResponse.json({ deleted: matches, count: matches.length });
}
