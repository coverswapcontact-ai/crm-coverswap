import { NextResponse, type NextRequest } from "next/server";
import { chargerEcran } from "@/app/(pilotage)/analytique/charger";
import { lireRequete } from "@/components/pilotage/analytique/requete";
import { reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytique?onglet=ensemble|publicite|seo|site|argent&p=7j|30j|90j|mois|12m (ou &du=&au=)&source= — l'écran
 * d'un onglet de l'Analytique (JSON du contrat src/lib/analytique/types.ts) et l'état des sources de données. Mêmes
 * règles que la page /analytique : une valeur inconnue retombe sur le défaut.
 */
export async function GET(requete: NextRequest) {
  try {
    return NextResponse.json(await chargerEcran(lireRequete(requete.nextUrl.searchParams)));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/analytique");
  }
}
