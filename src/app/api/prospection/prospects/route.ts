import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AGENT_SLUGS, STATUTS_PROSPECT } from "@/lib/prospection/constants";

// GET /api/prospection/prospects?agent={slug}&statut={statut}&limit={n}
// Tri : date de sourcing (createdAt) décroissante.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get("agent");
    const statut = searchParams.get("statut");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "200", 10) || 200, 1),
      500
    );

    if (agent && !(AGENT_SLUGS as readonly string[]).includes(agent)) {
      return NextResponse.json(
        { error: `agent inconnu : "${agent}" (hotels | restaurants)` },
        { status: 400 }
      );
    }
    if (statut && !(STATUTS_PROSPECT as readonly string[]).includes(statut)) {
      return NextResponse.json({ error: `statut inconnu : "${statut}"` }, { status: 400 });
    }

    const where: Record<string, unknown> = {};
    if (agent) where.agentProfile = { slug: agent };
    if (statut) where.statut = statut;

    const [prospects, total] = await Promise.all([
      prisma.prospect.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          nom: true,
          ville: true,
          codePostal: true,
          noteGoogle: true,
          nbAvis: true,
          statut: true,
          createdAt: true,
        },
      }),
      prisma.prospect.count({ where }),
    ]);

    return NextResponse.json({ prospects, total });
  } catch (error) {
    console.error("[api/prospection/prospects]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur de lecture des prospects" },
      { status: 500 }
    );
  }
}
