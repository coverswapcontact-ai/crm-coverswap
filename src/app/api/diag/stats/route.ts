import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * TEMPORAIRE - endpoint diagnostic stats + cleanup test leads.
 * Auth: X-Webhook-Secret.
 * GET = stats. DELETE = nettoyage des leads matching un filtre name/email.
 * A supprimer apres.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function auth(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  return !!secret && secret === process.env.WEBHOOK_SECRET;
}

export async function GET(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const result: Record<string, unknown> = { now: now.toISOString() };
  const errors: string[] = [];
  async function step(name: string, fn: () => Promise<unknown>) {
    try { result[name] = await fn(); } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await step("total", () => prisma.lead.count());
  await step("today", () => prisma.lead.count({ where: { createdAt: { gte: startOfDay } } }));
  await step("last7d", () => prisma.lead.count({ where: { createdAt: { gte: d7 } } }));
  await step("last30d", () => prisma.lead.count({ where: { createdAt: { gte: d30 } } }));
  if (errors.length) result.errors = errors;
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  if (!auth(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Nettoyage des leads de test crees par Claude
  const testNames = [
    "Pipeline Check Contact",
    "Pipeline Check Devis",
    "VERIF CRASH",
    "Test Post-Deploy",
  ];
  const deleted = [];
  for (const full of testNames) {
    const parts = full.split(" ");
    // Le schema stocke prenom + nom separement. Je filtre par email special ou nom exact.
    const res = await prisma.lead.deleteMany({
      where: {
        OR: [
          { AND: [{ prenom: parts[0] }, { nom: parts.slice(1).join(" ") }] },
          { email: { contains: "pipeline-check" } },
          { email: { contains: "test-postdeploy" } },
        ],
      },
    });
    deleted.push({ name: full, count: res.count });
  }
  return NextResponse.json({ deleted });
}
