import { NextRequest, NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { creerPublication, dossiersAvecPhotosApres, listerPublications } from "@/lib/site/publications";

// Derrière la session (proxy en refus par défaut) : ce que le CRM publie sur le site.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [publications, dossiers] = await Promise.all([listerPublications(), dossiersAvecPhotosApres()]);
    return NextResponse.json({ publications, dossiers });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/publications");
  }
}

export async function POST(request: NextRequest) {
  try {
    const publication = await creerPublication(await request.json());
    return NextResponse.json({ publication }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/publications");
  }
}
