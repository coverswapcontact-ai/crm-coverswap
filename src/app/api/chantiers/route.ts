import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const createChantierSchema = z.object({
  leadId: z.string().min(1, "Lead requis"),
  dateIntervention: z.string().min(1, "Date intervention requise"),
  adresse: z.string().min(1, "Adresse requise"),
  reference: z.string().min(1, "Reference requise"),
  mlCommandes: z.number().positive(),
  prixMatiere: z.number().min(0),
  margeNette: z.number(),
  statut: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statut = searchParams.get("statut");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const where: Record<string, unknown> = {};
    if (statut) where.statut = statut;

    const [chantiers, total] = await Promise.all([
      prisma.chantier.findMany({
        where,
        include: { lead: true, commandes: true },
        orderBy: { dateIntervention: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.chantier.count({ where }),
    ]);

    return NextResponse.json({
      chantiers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/chantiers error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation des chantiers" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createChantierSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { dateIntervention, ...rest } = parsed.data;

    const chantier = await prisma.chantier.create({
      data: {
        ...rest,
        dateIntervention: new Date(dateIntervention),
      },
      include: { lead: true, commandes: true },
    });

    revalidatePath("/chantiers");
    return NextResponse.json(chantier, { status: 201 });
  } catch (error) {
    console.error("POST /api/chantiers error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la creation du chantier" },
      { status: 500 }
    );
  }
}
