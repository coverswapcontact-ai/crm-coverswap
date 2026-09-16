import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ERREUR_MOTIF_ARCHIVAGE, motifDArchivage } from "@/lib/journal/archivage";
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

/** Archive le chantier et ses commandes (rien ne se supprime) : corps JSON { motif }. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const motif = await motifDArchivage(request);
    if (!motif) return NextResponse.json({ error: ERREUR_MOTIF_ARCHIVAGE }, { status: 400 });
    const archiveLe = new Date();
    await prisma.$transaction([
      prisma.chantier.update({ where: { id }, data: { archiveLe, archiveMotif: motif } }),
      prisma.commande.updateMany({
        where: { chantierId: id, archiveLe: null },
        data: { archiveLe, archiveMotif: `Chantier archivé : ${motif}` },
      }),
    ]);
    revalidatePath("/chantiers");
    revalidatePath("/commandes");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/chantiers/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'archivage du chantier" },
      { status: 500 }
    );
  }
}
