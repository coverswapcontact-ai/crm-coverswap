import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statut = searchParams.get("statut");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Record<string, unknown> = {};
    if (statut) where.statut = statut;

    const [factures, total] = await Promise.all([
      prisma.facture.findMany({
        where,
        include: { devis: { include: { lead: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.facture.count({ where }),
    ]);

    return NextResponse.json({
      factures,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/factures error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation des factures" },
      { status: 500 }
    );
  }
}
