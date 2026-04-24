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

  try {
    const [
      total,
      today,
      last7d,
      last30d,
      bySource30d,
      bySource7d,
      byStatut,
      recent20,
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.lead.count({ where: { createdAt: { gte: d7 } } }),
      prisma.lead.count({ where: { createdAt: { gte: d30 } } }),
      prisma.lead.groupBy({
        by: ["source"],
        where: { createdAt: { gte: d30 } },
        _count: { id: true },
      }),
      prisma.lead.groupBy({
        by: ["source"],
        where: { createdAt: { gte: d7 } },
        _count: { id: true },
      }),
      prisma.lead.groupBy({
        by: ["statut"],
        _count: { id: true },
      }),
      prisma.lead.findMany({
        take: 20,
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
    ]);

    return NextResponse.json({
      now: now.toISOString(),
      counts: { total, today, last7d, last30d },
      bySource30d: bySource30d.map((r) => ({ source: r.source, count: r._count.id })),
      bySource7d: bySource7d.map((r) => ({ source: r.source, count: r._count.id })),
      byStatut: byStatut.map((r) => ({ statut: r.statut, count: r._count.id })),
      recent20,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "stats-failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
