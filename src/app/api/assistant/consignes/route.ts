import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { CONSIGNES_DEFAUT, POSITIONNEMENT_DEFAUT, enregistrerConsignes, enregistrerPositionnement, lireConsignes, lirePositionnement } from "@/lib/assistant/consignes";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

async function vue() {
  const [consignes, positionnement] = await Promise.all([lireConsignes(), lirePositionnement()]);
  return { consignes, positionnement, defauts: { consignes: CONSIGNES_DEFAUT, positionnement: POSITIONNEMENT_DEFAUT } };
}

/** GET : les consignes et le positionnement que Claude lit à chaque session (avec les textes par défaut, pour « revenir au défaut »). */
export async function GET() {
  try {
    return NextResponse.json(await vue());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/assistant/consignes");
  }
}

const schema = z.object({ consignes: z.string().trim().min(50).max(20_000).optional(), positionnement: z.string().trim().min(20).max(20_000).optional() });

/** PATCH { consignes?, positionnement? } : Lucas écrit ; vide = retour au texte par défaut. */
export async function PATCH(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.consignes !== undefined) await enregistrerConsignes(entree.consignes, "LUCAS");
    if (entree.positionnement !== undefined) await enregistrerPositionnement(entree.positionnement, "LUCAS");
    return NextResponse.json(await vue());
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/assistant/consignes");
  }
}
