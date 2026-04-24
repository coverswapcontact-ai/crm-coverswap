import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORAIRE — endpoint diagnostic stats leads.
 * Auth: X-Webhook-Secret (reuse CRM_WEBHOOK_SECRET).
 * A supprimer apres diag.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [
    total,
    today,
    last7d,
    last30d,
    bySource30d,
    bySource7d,
    recent10,
    byDay7d,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.lead.count({ where: { createdAt: { gte: d7 } } }),
    prisma.lead.count({ where: { createdAt: { gte: d30 } } }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: d30 } },
      _count: true,
      orderBy: { _count: { source: "desc" } },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: d7 } },
      _count: true,
      orderBy: { _count: { source: "desc" } },
    }),
    prisma.lead.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        nom: true,
        prenom: true,
        email: true,
        telephone: true,
        ville: true,
        source: true,
        statut: true,
        typeProjet: true,
      },
    }),
    prisma.$queryRaw`
      SELECT strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') as day,
             source,
             COUNT(*) as n
      FROM Lead
      WHERE createdAt >= ${d7.getTime()}
      GROUP BY day, source
      ORDER BY day DESC
    `.catch(() => []),
  ]);

  return NextResponse.json({
    now: now.toISOString(),
    counts: { total, today, last7d, last30d },
    bySource30d: bySource30d.map((r: { source: string; _count: number }) => ({
      source: r.source,
      count: r._count,
    })),
    bySource7d: bySource7d.map((r: { source: string; _count: number }) => ({
      source: r.source,
      count: r._count,
    })),
    byDay7d,
    recent10,
  });
}
