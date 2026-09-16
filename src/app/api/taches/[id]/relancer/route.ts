import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { relancerTache } from "@/lib/taches/file";

export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await relancerTache(id).catch((erreur: unknown) => {
      throw new ErreurMetier(erreur instanceof Error ? erreur.message : "Relance impossible.", 409);
    });
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/taches/[id]/relancer");
  }
}
