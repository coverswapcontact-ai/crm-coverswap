import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * EXPORT TEMPORAIRE — à supprimer après usage.
 * Renvoie les leads créés après une date donnée (défaut : 2026-04-20).
 * Placé hors des préfixes protégés par le middleware. Guardé par token.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("k") !== "cs-export-3k9") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sinceParam = req.nextUrl.searchParams.get("since") || "2026-04-20";
  const since = new Date(`${sinceParam}T00:00:00Z`);

  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      prenom: true,
      nom: true,
      telephone: true,
      email: true,
      ville: true,
      source: true,
      typeProjet: true,
      statut: true,
      notes: true,
    },
  });

  return NextResponse.json({
    since: since.toISOString(),
    count: leads.length,
    withEmail: leads.filter((l) => l.email).length,
    leads,
  });
}
