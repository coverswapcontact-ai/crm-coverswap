import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { lireCompteurs, poserCompteur, SERIES } from "@/lib/dossiers/compteurs";

export const dynamic = "force-dynamic";

const schemaCompteur = z.object({
  serie: z.enum(SERIES, "Série inconnue."),
  prochain: z.string("Prochain numéro manquant.").trim().min(1, "Prochain numéro manquant.").max(20, "Numéro trop long."),
});

/** GET : les compteurs de l'année (dernier rang attribué, plus haut inscrit, prochain numéro), par série. */
export async function GET() {
  try {
    return NextResponse.json({ compteurs: await lireCompteurs() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/numeros/compteurs");
  }
}

/** PATCH { serie, prochain } : fait repartir une série au numéro donné (jamais derrière un numéro inscrit). */
export async function PATCH(requete: NextRequest) {
  try {
    const entree = analyser(schemaCompteur, await lireCorpsJson(requete));
    const compteur = await poserCompteur(entree);
    return NextResponse.json({ compteur, compteurs: await lireCompteurs() });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/numeros/compteurs");
  }
}
