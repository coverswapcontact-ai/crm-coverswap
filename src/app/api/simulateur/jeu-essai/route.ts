import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { resoudreContexte } from "@/lib/journal/acteur";
import { N_JEU_MAX, N_JEU_PAR_DEFAUT, collecterJeuEssai, fluxJeuEssai, nomFichierJeu, tracerExportJeuEssai } from "@/lib/simulateur/jeu-essai";

export const dynamic = "force-dynamic";

/**
 * Mission 23 (L1) — GET ?n=150 (1 à 300) : le jeu d'essai du simulateur en zip (photo avant, rendu, meta.json par
 * simulation ; aucune donnée de contact), écrit en flux. Derrière la session (proxy), comme toutes les routes /api.
 * Chaque export est tracé : registre des appels (session « ECRAN ») et une ligne de log.
 */
export async function GET(requete: NextRequest) {
  try {
    const brut = requete.nextUrl.searchParams.get("n");
    const n = brut === null || brut === "" ? N_JEU_PAR_DEFAUT : Number(brut);
    if (!Number.isInteger(n) || n < 1 || n > N_JEU_MAX) throw new ErreurMetier(`Nombre de simulations invalide : entre 1 et ${N_JEU_MAX}.`, 400);
    const maintenant = new Date();
    const jeu = await collecterJeuEssai({ n, maintenant });
    await tracerExportJeuEssai(jeu, (await resoudreContexte()).acteur);
    return new NextResponse(fluxJeuEssai(jeu), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nomFichierJeu(maintenant)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/jeu-essai");
  }
}
