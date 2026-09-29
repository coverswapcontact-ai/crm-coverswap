import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { noterSmsCopie, schemaCopie } from "@/lib/sms/copie";

export const dynamic = "force-dynamic";

/**
 * POST { code, texte, leadId | dossierId, relance? } : Lucas a copié ce SMS pour le coller dans Messages — copier
 * vaut envoi (mission 14, partie 5). Le texte est tracé tel qu'il a été copié, modifié ou non ; rien n'est envoyé.
 */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaCopie, await lireCorpsJson(requete));
    return NextResponse.json({ copie: await noterSmsCopie({ ...entree, origine: "ECRAN" }) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/copie");
  }
}
