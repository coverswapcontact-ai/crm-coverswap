import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get("leadId");
    const statut = searchParams.get("statut");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Record<string, unknown> = {};
    if (leadId) where.leadId = leadId;
    if (statut) where.statut = statut;

    const [devisList, total] = await Promise.all([
      prisma.devis.findMany({
        where,
        include: { lead: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.devis.count({ where }),
    ]);

    return NextResponse.json({
      devis: devisList,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/devis error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la récupération des devis" },
      { status: 500 }
    );
  }
}

// Écran en lecture seule depuis le module Dossiers : un seul chemin d'émission,
// donc une seule numérotation (src/lib/dossiers/numerotation.ts).
export async function POST() {
  return NextResponse.json(
    { error: "Lecture seule : les devis et les factures s'émettent désormais depuis Dossiers (/dossiers)." },
    { status: 410 }
  );
}
