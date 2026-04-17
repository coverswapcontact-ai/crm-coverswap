import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const updateFactureSchema = z.object({
  acompteRecu: z.boolean().optional(),
  soldeRecu: z.boolean().optional(),
  statut: z.string().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const facture = await prisma.facture.findUnique({
      where: { id },
      include: { devis: { include: { lead: true } } },
    });

    if (!facture) {
      return NextResponse.json(
        { error: "Facture non trouvee" },
        { status: 404 }
      );
    }

    return NextResponse.json(facture);
  } catch (error) {
    console.error("GET /api/factures/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation de la facture" },
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
    const parsed = updateFactureSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};

    if (parsed.data.acompteRecu === true) {
      data.acompteRecu = true;
      data.acompteDate = new Date();
      data.statut = "ACOMPTE_RECU";
    }

    if (parsed.data.soldeRecu === true) {
      data.soldeRecu = true;
      data.soldeDate = new Date();
      data.statut = "SOLDEE";
    }

    if (parsed.data.statut && !data.statut) {
      data.statut = parsed.data.statut;
    }

    const facture = await prisma.facture.update({
      where: { id },
      data,
      include: { devis: { include: { lead: true } } },
    });

    revalidatePath("/factures");
    return NextResponse.json(facture);
  } catch (error) {
    console.error("PUT /api/factures/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour de la facture" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.facture.delete({ where: { id } });
    revalidatePath("/factures");
    revalidatePath("/dashboard");
    revalidatePath("/finances");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/factures/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression de la facture" },
      { status: 500 }
    );
  }
}
