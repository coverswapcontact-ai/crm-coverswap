import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.commande.delete({ where: { id } });
    revalidatePath("/commandes");
    revalidatePath("/dashboard");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/commandes/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression de la commande" },
      { status: 500 }
    );
  }
}
