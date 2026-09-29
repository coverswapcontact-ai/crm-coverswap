import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { relancesProposables } from "@/lib/relances/proposables";

export const dynamic = "force-dynamic";

/**
 * GET /api/relances[?dossierId=…] : les relances proposables aujourd'hui (mission 14, partie 6) — devis (SMS à copier,
 * mail à valider s'il y en a un) et espaces sans photo ni simulation ; `dossierId` restreint à un dossier (sa fiche).
 * N'écrit rien. Derrière la session (proxy, refus par défaut).
 */
export async function GET(requete: NextRequest) {
  try {
    const dossierId = requete.nextUrl.searchParams.get("dossierId")?.trim().slice(0, 40) || undefined;
    return NextResponse.json(await relancesProposables(new Date(), { dossierId }));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/relances");
  }
}
