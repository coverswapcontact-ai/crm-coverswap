import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const createCommandeSchema = z.object({
  chantierId: z.string().min(1, "Chantier requis"),
  reference: z.string().min(1, "Reference requise"),
  quantiteML: z.number().positive(),
  prixMatiere: z.number().min(0),
  fournisseur: z.string().optional(),
  emailFournisseur: z.string().email().optional(),
  statut: z.string().optional(),
  dateCommande: z.string().optional(),
  dateReceptionEstimee: z.string().optional(),
});

const updateCommandeSchema = z.object({
  id: z.string().min(1),
  reference: z.string().optional(),
  quantiteML: z.number().positive().optional(),
  prixMatiere: z.number().min(0).optional(),
  fournisseur: z.string().optional(),
  emailFournisseur: z.string().email().optional(),
  statut: z.string().optional(),
  dateCommande: z.string().optional(),
  dateReceptionEstimee: z.string().optional(),
  dateReceptionReelle: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chantierId = searchParams.get("chantierId");
    const statut = searchParams.get("statut");

    const where: Record<string, unknown> = {};
    if (chantierId) where.chantierId = chantierId;
    if (statut) where.statut = statut;

    const commandes = await prisma.commande.findMany({
      where,
      include: { chantier: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(commandes);
  } catch (error) {
    console.error("GET /api/commandes error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation des commandes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createCommandeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (data.dateCommande) data.dateCommande = new Date(data.dateCommande as string);
    if (data.dateReceptionEstimee)
      data.dateReceptionEstimee = new Date(data.dateReceptionEstimee as string);

    const commande = await prisma.commande.create({
      data: data as Parameters<typeof prisma.commande.create>[0]["data"],
      include: { chantier: true },
    });

    revalidatePath("/commandes");
    return NextResponse.json(commande, { status: 201 });
  } catch (error) {
    console.error("POST /api/commandes error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la creation de la commande" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = updateCommandeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { id, ...rest } = parsed.data;
    const data: Record<string, unknown> = { ...rest };
    if (data.dateCommande) data.dateCommande = new Date(data.dateCommande as string);
    if (data.dateReceptionEstimee)
      data.dateReceptionEstimee = new Date(data.dateReceptionEstimee as string);
    if (data.dateReceptionReelle)
      data.dateReceptionReelle = new Date(data.dateReceptionReelle as string);

    const commande = await prisma.commande.update({
      where: { id },
      data,
      include: { chantier: true },
    });

    revalidatePath("/commandes");
    return NextResponse.json(commande);
  } catch (error) {
    console.error("PUT /api/commandes error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour de la commande" },
      { status: 500 }
    );
  }
}
