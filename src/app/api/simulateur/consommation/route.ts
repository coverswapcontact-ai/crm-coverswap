import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { consommation } from "@/lib/simulateur/consommation";
import { reglagesSimulateur } from "@/lib/simulateur/reglages";
import { coutEstime, modeleImage } from "@/lib/simulations/generation";
import { QUALITES } from "@/lib/simulations/prix";

export const dynamic = "force-dynamic";

/**
 * GET : le compteur de crédit — consommation du mois (site et CRM), solde estimé, coût d'une génération.
 * Mission 15 (partie 2) : `coutParEchantillons` est celui de la qualité de l'espace et du CRM (Paramètres),
 * `coutParQualite` donne les trois qualités ; `reglages` rappelle le moteur, la planche et les qualités.
 */
export async function GET() {
  try {
    const reglages = await reglagesSimulateur();
    return NextResponse.json({
      ...(await consommation()),
      modele: modeleImage(),
      coutParEchantillons: [1, 2, 3, 4].map((n) => coutEstime(n, reglages.qualiteEspace)),
      coutParQualite: Object.fromEntries(QUALITES.map((q) => [q, [1, 2, 3, 4].map((n) => coutEstime(n, q))])),
      reglages,
      cle: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/consommation");
  }
}
