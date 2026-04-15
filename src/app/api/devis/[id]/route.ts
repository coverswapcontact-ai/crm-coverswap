import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const updateDevisSchema = z.object({
  statut: z.string().optional(),
  reference: z.string().optional(),
  fraisDeplacement: z.number().min(0).optional(),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const devis = await prisma.devis.findUnique({
      where: { id },
      include: { lead: true, facture: true },
    });

    if (!devis) {
      return NextResponse.json({ error: "Devis non trouve" }, { status: 404 });
    }

    return NextResponse.json(devis);
  } catch (error) {
    console.error("GET /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation du devis" },
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
    const parsed = updateDevisSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (data.expiresAt) {
      data.expiresAt = new Date(data.expiresAt as string);
    }

    const devis = await prisma.devis.update({
      where: { id },
      data,
      include: { lead: true, facture: true },
    });

    // When statut changes to SIGNE, auto-create Facture with atomic numero generation
    if (parsed.data.statut === "SIGNE" && !devis.facture) {
      const facture = await prisma.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const lastFacture = await tx.facture.findFirst({
          orderBy: { numero: "desc" },
          where: { numero: { startsWith: `FACT-${year}` } },
        });
        const num = lastFacture
          ? parseInt(lastFacture.numero.split("-").pop()!) + 1
          : 1;
        const numero = `FACT-${year}-${String(num).padStart(4, "0")}`;

        return tx.facture.create({
          data: {
            numero,
            montantTotal: devis.prixVente,
            devisId: devis.id,
          },
        });
      });

      revalidatePath("/devis");
      revalidatePath("/factures");
      return NextResponse.json({ ...devis, facture });
    }

    revalidatePath("/devis");
    return NextResponse.json(devis);
  } catch (error) {
    console.error("PUT /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour du devis" },
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

    await prisma.devis.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression du devis" },
      { status: 500 }
    );
  }
}
