import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const createLeadSchema = z.object({
  nom: z.string().min(1, "Nom requis"),
  prenom: z.string().min(1, "Prenom requis"),
  telephone: z.string().min(1, "Telephone requis"),
  ville: z.string().min(1, "Ville requise"),
  email: z.string().email().optional(),
  codePostal: z.string().optional(),
  source: z.string().optional(),
  statut: z.string().optional(),
  typeProjet: z.string().optional(),
  referenceChoisie: z.string().optional(),
  mlEstimes: z.number().optional(),
  prixDevis: z.number().optional(),
  lienSimulation: z.string().optional(),
  scoreSignature: z.number().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const statut = searchParams.get("statut");
    const source = searchParams.get("source");
    const typeProjet = searchParams.get("typeProjet");
    const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20"), 1), 100);
    const allowedSortFields = ["createdAt", "nom", "prenom", "ville", "scoreSignature", "prixDevis", "updatedAt"];
    const sortByParam = searchParams.get("sortBy") || "createdAt";
    const sortBy = allowedSortFields.includes(sortByParam) ? sortByParam : "createdAt";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" as const : "desc" as const;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { nom: { contains: search } },
        { prenom: { contains: search } },
        { email: { contains: search } },
        { telephone: { contains: search } },
        { ville: { contains: search } },
      ];
    }

    if (statut) where.statut = statut;
    if (source) where.source = source;
    if (typeProjet) where.typeProjet = typeProjet;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ]);

    return NextResponse.json({
      leads,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/leads error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation des leads" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createLeadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Auto-calculate score if not provided
    const data = { ...parsed.data };
    if (!data.scoreSignature || data.scoreSignature === 0) {
      let score = 0;
      const sourceScores: Record<string, number> = {
        META_ADS: 15, TIKTOK: 10, INSTAGRAM: 15,
        ORGANIQUE: 25, REFERENCE: 40, AUTRE: 10,
      };
      score += sourceScores[data.source || "AUTRE"] || 10;

      const hour = new Date().getHours();
      if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;

      const nearMontpellier = ["montpellier", "lattes", "perols", "castelnau", "mauguio"];
      const cityLower = data.ville.toLowerCase();
      if (nearMontpellier.some(c => cityLower.includes(c))) score += 20;

      const projectScores: Record<string, number> = {
        CUISINE: 25, SDB: 20, MEUBLES: 15, PRO: 20, AUTRE: 10,
      };
      score += projectScores[data.typeProjet || "CUISINE"] || 10;

      if (data.email) score += 5;
      if (data.telephone && data.telephone.length >= 10) score += 5;

      data.scoreSignature = Math.min(score, 100);
    }

    const lead = await prisma.lead.create({ data });

    revalidatePath("/leads");
    revalidatePath("/dashboard");
    return NextResponse.json(lead, { status: 201 });
  } catch (error) {
    console.error("POST /api/leads error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la creation du lead" },
      { status: 500 }
    );
  }
}
