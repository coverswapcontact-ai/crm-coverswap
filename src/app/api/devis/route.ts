import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";
import { calculerDevis } from "@/lib/calcul-devis";

const createDevisSchema = z.object({
  leadId: z.string().min(1, "Lead requis"),
  reference: z.string().min(1, "Reference requise"),
  mlTotal: z.number().positive("ML doit etre positif"),
  prixHT: z.number().positive("Prix HT doit etre positif"),
  fraisDeplacement: z.number().min(0).optional(),
});

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
      { error: "Erreur lors de la recuperation des devis" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createDevisSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { leadId, reference, mlTotal, prixHT, fraisDeplacement = 0 } = parsed.data;

    // Calculate pricing
    const calcul = calculerDevis(prixHT, mlTotal, fraisDeplacement);

    // ExpiresAt = 30 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Use transaction for atomic numero generation
    const devis = await prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const last = await tx.devis.findFirst({
        orderBy: { numero: "desc" },
        where: { numero: { startsWith: `DEVIS-${year}` } },
      });
      const num = last ? parseInt(last.numero.split("-").pop()!) + 1 : 1;
      const numero = `DEVIS-${year}-${String(num).padStart(4, "0")}`;

      return tx.devis.create({
        data: {
          numero,
          reference,
          mlTotal: calcul.mlArrondi,
          prixMatiere: calcul.prixMatiere,
          prixVente: calcul.prixVente,
          margeNette: calcul.margeNette,
          fraisDeplacement,
          acompte30: calcul.acompte30,
          solde70: calcul.solde70,
          expiresAt,
          leadId,
        },
        include: { lead: true },
      });
    });

    revalidatePath("/devis");
    return NextResponse.json(devis, { status: 201 });
  } catch (error) {
    console.error("POST /api/devis error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la creation du devis" },
      { status: 500 }
    );
  }
}
