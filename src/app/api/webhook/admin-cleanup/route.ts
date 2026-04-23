import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";

/**
 * TEMPORARY — Cleanup endpoint for removing test leads.
 * Guarded by the WEBHOOK_SECRET header. Will be removed after one-off use.
 *
 * Accepts: { phones: string[] } OR { ids: string[] }
 * Returns: { deleted: { id, prenom, nom, telephone }[] }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  const expected = process.env.WEBHOOK_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: { phones?: string[]; ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const phones = Array.isArray(body.phones) ? body.phones : [];
  const ids = Array.isArray(body.ids) ? body.ids : [];

  if (phones.length === 0 && ids.length === 0) {
    return NextResponse.json({ error: "Fournir phones[] ou ids[]" }, { status: 400 });
  }

  // Find matching leads
  const matches = await prisma.lead.findMany({
    where: {
      OR: [
        ids.length ? { id: { in: ids } } : undefined,
        phones.length ? { telephone: { in: phones } } : undefined,
      ].filter(Boolean) as any,
    },
    select: { id: true, prenom: true, nom: true, telephone: true, email: true },
  });

  if (matches.length === 0) {
    return NextResponse.json({ deleted: [], note: "Aucun lead correspondant" });
  }

  // Cascade delete (Simulation, Interaction, Devis, Chantier tous en onDelete: Cascade)
  await prisma.lead.deleteMany({
    where: { id: { in: matches.map((l) => l.id) } },
  });

  revalidatePath("/leads");
  revalidatePath("/dashboard");

  return NextResponse.json({ deleted: matches, count: matches.length });
}
