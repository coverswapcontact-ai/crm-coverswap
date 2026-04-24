import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORAIRE - endpoint diagnostic stats leads.
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

  const result: Record<string, unknown> = { now: now.toISOString() };
  const errors: string[] = [];

  async function step(name: string, fn: () => Promise<unknown>) {
    try {
      result[name] = await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
    }
  }

  await step("total", () => prisma.lead.count());
  await step("today", () => prisma.lead.count({ where: { createdAt: { gte: startOfDay } } }));
  await step("last7d", () => prisma.lead.count({ where: { createdAt: { gte: d7 } } }));
  await step("last30d", () => prisma.lead.count({ where: { createdAt: { gte: d30 } } }));
  await step("recent20", () =>
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
    })
  );

  if (errors.length) result.errors = errors;
  return NextResponse.json(result);
}
