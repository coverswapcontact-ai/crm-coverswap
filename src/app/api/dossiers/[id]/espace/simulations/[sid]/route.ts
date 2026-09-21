import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import prisma from "@/lib/prisma";
import { imageDeSimulation, retirerSimulation } from "@/lib/espace/service";

export const dynamic = "force-dynamic";

/** GET : l'image d'une simulation, derrière la session du CRM. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    const { contenu, type } = await imageDeSimulation({ dossierId: id }, sid);
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/espace/simulations/[sid]");
  }
}

/** POST : retire la simulation de l'espace du client (archivée, rien ne se supprime). */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    const simulation = await prisma.simulationEspace.findFirst({ where: { id: sid, dossierId: id }, select: { id: true } });
    if (!simulation) throw new ErreurMetier("Simulation introuvable.", 404);
    await retirerSimulation(sid);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/espace/simulations/[sid]");
  }
}
