import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";

const interactionSchema = z.object({
  type: z.string().min(1),
  contenu: z.string().min(1),
});

const updateLeadSchema = z.object({
  nom: z.string().min(1).optional(),
  prenom: z.string().min(1).optional(),
  telephone: z.string().min(1).optional(),
  ville: z.string().min(1).optional(),
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
  interaction: interactionSchema.optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        interactions: { orderBy: { createdAt: "desc" } },
        devis: true,
        chantier: true,
      },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead non trouve" }, { status: 404 });
    }

    return NextResponse.json(lead);
  } catch (error) {
    console.error("GET /api/leads/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation du lead" },
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
    const parsed = updateLeadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { interaction, ...leadData } = parsed.data;

    // If there's an interaction to add, create it
    if (interaction) {
      await prisma.interaction.create({
        data: {
          type: interaction.type,
          contenu: interaction.contenu,
          leadId: id,
        },
      });
    }

    // Only update lead fields if there are any (besides interaction)
    let lead;
    if (Object.keys(leadData).length > 0) {
      lead = await prisma.lead.update({
        where: { id },
        data: leadData,
        include: { interactions: { orderBy: { createdAt: "desc" } } },
      });
    } else {
      lead = await prisma.lead.findUnique({
        where: { id },
        include: { interactions: { orderBy: { createdAt: "desc" } } },
      });
    }

    revalidatePath("/leads");
    return NextResponse.json(lead);
  } catch (error) {
    console.error("PUT /api/leads/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour du lead" },
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

    await prisma.lead.delete({ where: { id } });

    revalidatePath("/leads");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/leads/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression du lead" },
      { status: 500 }
    );
  }
}
