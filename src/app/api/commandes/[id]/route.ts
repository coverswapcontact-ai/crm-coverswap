import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ERREUR_MOTIF_ARCHIVAGE, motifDArchivage } from "@/lib/journal/archivage";

/** Archive la commande (rien ne se supprime) : corps JSON { motif }. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const motif = await motifDArchivage(request);
    if (!motif) return NextResponse.json({ error: ERREUR_MOTIF_ARCHIVAGE }, { status: 400 });
    await prisma.commande.update({ where: { id }, data: { archiveLe: new Date(), archiveMotif: motif } });
    revalidatePath("/commandes");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/commandes/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'archivage de la commande" },
      { status: 500 }
    );
  }
}
