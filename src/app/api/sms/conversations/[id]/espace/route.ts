import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { preparerLienEspace } from "@/lib/sms/suggestions";

export const dynamic = "force-dynamic";

const schema = z.object({ modele: z.enum(["LIEN_ESPACE", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL"]).optional() });

/**
 * POST : ouvre l'espace client (et le dossier s'il n'existe pas encore) et rend
 * le message prêt à corriger, avec le lien. N'envoie rien : c'est Lucas qui envoie.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schema, await lireCorpsJson(requete).catch(() => ({})));
    return NextResponse.json(await preparerLienEspace(id, entree.modele ?? "LIEN_ESPACE"));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/conversations/[id]/espace");
  }
}
