import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { consommation } from "@/lib/simulateur/consommation";
import { coutEstime, modeleImage } from "@/lib/simulations/generation";

export const dynamic = "force-dynamic";

/** GET : le compteur de crédit — consommation du mois (site et CRM), solde estimé, coût d'une génération. */
export async function GET() {
  try {
    return NextResponse.json({ ...(await consommation()), modele: modeleImage(), coutParEchantillons: [1, 2, 3, 4].map(coutEstime), cle: Boolean(process.env.OPENAI_API_KEY) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/consommation");
  }
}
