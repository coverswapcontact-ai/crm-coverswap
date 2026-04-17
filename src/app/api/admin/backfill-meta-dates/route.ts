import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// ============================================================================
// BACKFILL — Rétablit les dates réelles des leads Meta importés avec NOW().
// Pour chaque lead source=META_ADS, on extrait le leadgen_id depuis :
//   1. le champ notes (format "LeadgenID: 123...") pour les nouveaux
//   2. l'interaction NOTE "leadgen_id: 123..." pour les anciens
// Puis on interroge Graph API pour récupérer created_time réel.
//
// Protection : requiert ?secret=... = WEBHOOK_SECRET ou META_VERIFY_TOKEN
// Usage : POST /api/admin/backfill-meta-dates?secret=XXX
// ============================================================================

const GRAPH_API = "https://graph.facebook.com/v21.0";

async function fetchMetaCreatedTime(leadgenId: string, token: string): Promise<Date | null> {
  try {
    const res = await fetch(
      `${GRAPH_API}/${leadgenId}?fields=created_time&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.created_time) return null;
    const d = new Date(data.created_time);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function extractLeadgenId(text: string | null | undefined): string | null {
  if (!text) return null;
  // Match "LeadgenID: 123..." OU "leadgen_id: 123..."
  const m = text.match(/leadgen[_ ]?id[: ]\s*(\d+)/i);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expected = process.env.WEBHOOK_SECRET || process.env.META_VERIFY_TOKEN;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN manquant" }, { status: 500 });
  }

  const leads = await prisma.lead.findMany({
    where: { source: "META_ADS" },
    include: {
      interactions: {
        where: { contenu: { contains: "leadgen_id" } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  let fixed = 0;
  let skipped = 0;
  let failed = 0;
  const details: Array<{ id: string; name: string; oldDate: string; newDate?: string; status: string }> = [];

  for (const lead of leads) {
    const leadgenId =
      extractLeadgenId(lead.notes) ||
      extractLeadgenId(lead.interactions[0]?.contenu);

    if (!leadgenId) {
      skipped++;
      details.push({
        id: lead.id,
        name: `${lead.prenom} ${lead.nom}`,
        oldDate: lead.createdAt.toISOString(),
        status: "no_leadgen_id",
      });
      continue;
    }

    const realDate = await fetchMetaCreatedTime(leadgenId, token);
    if (!realDate) {
      failed++;
      details.push({
        id: lead.id,
        name: `${lead.prenom} ${lead.nom}`,
        oldDate: lead.createdAt.toISOString(),
        status: "graph_api_failed",
      });
      continue;
    }

    // Ne pas mettre à jour si déjà correct (tolérance 1h)
    const diff = Math.abs(lead.createdAt.getTime() - realDate.getTime());
    if (diff < 3600 * 1000) {
      skipped++;
      details.push({
        id: lead.id,
        name: `${lead.prenom} ${lead.nom}`,
        oldDate: lead.createdAt.toISOString(),
        newDate: realDate.toISOString(),
        status: "already_correct",
      });
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { createdAt: realDate, updatedAt: realDate },
    });

    fixed++;
    details.push({
      id: lead.id,
      name: `${lead.prenom} ${lead.nom}`,
      oldDate: lead.createdAt.toISOString(),
      newDate: realDate.toISOString(),
      status: "fixed",
    });

    // Throttle pour éviter rate limit Meta
    await new Promise((r) => setTimeout(r, 150));
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return NextResponse.json({
    total: leads.length,
    fixed,
    skipped,
    failed,
    details,
  });
}

// GET = preview (nombre de leads concernés, sans modification)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expected = process.env.WEBHOOK_SECRET || process.env.META_VERIFY_TOKEN;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  const leads = await prisma.lead.findMany({
    where: { source: "META_ADS" },
    select: {
      id: true,
      prenom: true,
      nom: true,
      createdAt: true,
      notes: true,
      interactions: {
        where: { contenu: { contains: "leadgen_id" } },
        select: { contenu: true },
        take: 1,
      },
    },
  });

  const preview = leads.map((l) => ({
    id: l.id,
    name: `${l.prenom} ${l.nom}`,
    createdAt: l.createdAt.toISOString(),
    leadgenId:
      extractLeadgenId(l.notes) ||
      extractLeadgenId(l.interactions[0]?.contenu),
  }));

  return NextResponse.json({
    total: leads.length,
    withLeadgenId: preview.filter((p) => p.leadgenId).length,
    withoutLeadgenId: preview.filter((p) => !p.leadgenId).length,
    sample: preview.slice(0, 10),
  });
}
