import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ouvrirDossierDuLead } from "@/lib/dossiers/depuis-lead";

export const dynamic = "force-dynamic";

/**
 * POST : ouvre le dossier de ce lead — coordonnées, projet, source, réponses,
 * photos et simulations repris — ou rend celui qu'il a déjà. Le lead sort
 * alors de la liste Leads.
 */
export async function POST(_requete: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await ouvrirDossierDuLead(id, { motif: "BOUTON" }));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/leads/[id]/dossier");
  }
}
