import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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

// Écran en lecture seule depuis le module Dossiers : plus de changement de
// statut, de facture créée à la signature ni de suppression par cette route.
function lectureSeule() {
  return NextResponse.json(
    { error: "Lecture seule : les devis et les factures s'émettent désormais depuis Dossiers (/dossiers)." },
    { status: 410 }
  );
}

export async function PUT() {
  return lectureSeule();
}

export async function DELETE() {
  return lectureSeule();
}
