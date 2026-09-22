import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { attribuerTarif, tarifsDesPrestations } from "@/lib/prestations/tarifs";

export const dynamic = "force-dynamic";

/** GET : chaque sous-partie des prestations avec le tarif qui la chiffre (attribué par Lucas, ou trouvé par mots-clés). */
export async function GET() {
  try {
    return NextResponse.json({ lignes: await tarifsDesPrestations() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/prestations/tarifs");
  }
}

const schema = z.object({ cle: z.string().min(3).max(60), presetId: z.string().max(40).nullable() });

/** POST { cle, presetId } : attribuer un tarif à une sous-partie (null : revenir au choix automatique). */
export async function POST(requete: NextRequest) {
  try {
    const { cle, presetId } = analyser(schema, await lireCorpsJson(requete));
    await attribuerTarif(cle, presetId);
    return NextResponse.json({ lignes: await tarifsDesPrestations() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prestations/tarifs");
  }
}
