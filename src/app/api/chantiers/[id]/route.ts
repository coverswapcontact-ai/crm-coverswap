import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const updateChantierSchema = z.object({
  dateIntervention: z.string().optional(),
  adresse: z.string().optional(),
  reference: z.string().optional(),
  mlCommandes: z.number().optional(),
  prixMatiere: z.number().optional(),
  margeNette: z.number().optional(),
  statut: z.string().optional(),
  acompteRecu: z.boolean().optional(),
  soldeRecu: z.boolean().optional(),
  photosAvant: z.string().optional(),
  photosApres: z.string().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const chantier = await prisma.chantier.findUnique({
      where: { id },
      include: { lead: true, commandes: true },
    });

    if (!chantier) {
      return NextResponse.json(
        { error: "Chantier non trouve" },
        { status: 404 }
      );
    }

    return NextResponse.json(chantier);
  } catch (error) {
    console.error("GET /api/chantiers/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation du chantier" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateChantierSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (data.dateIntervention) {
      data.dateIntervention = new Date(data.dateIntervention as string);
    }

    const chantier = await prisma.chantier.update({
      where: { id },
      data,
      include: { lead: true, commandes: true },
    });

    revalidatePath("/chantiers");
    return NextResponse.json(chantier);
  } catch (error) {
    console.error("PUT /api/chantiers/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour du chantier" },
      { status: 500 }
    );
  }
}
