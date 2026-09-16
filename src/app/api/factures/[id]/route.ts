import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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

// Écran en lecture seule depuis le module Dossiers : les encaissements et les
// nouvelles factures se suivent dans /dossiers.
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
