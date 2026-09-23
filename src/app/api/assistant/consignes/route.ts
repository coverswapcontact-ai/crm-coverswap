import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { CLE_CONSIGNES, CLE_POSITIONNEMENT, CLES_TEXTE, CONSIGNES_DEFAUT, POSITIONNEMENT_DEFAUT, enregistrerConsignes, enregistrerPositionnement, lireConsignes, lirePositionnement, listerVersions, restaurerVersion } from "@/lib/assistant/consignes";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";

export const dynamic = "force-dynamic";

async function vue() {
  const [consignes, positionnement, versionsConsignes, versionsPositionnement] = await Promise.all([lireConsignes(), lirePositionnement(), listerVersions(CLE_CONSIGNES), listerVersions(CLE_POSITIONNEMENT)]);
  return { consignes, positionnement, defauts: { consignes: CONSIGNES_DEFAUT, positionnement: POSITIONNEMENT_DEFAUT }, versions: { consignes: versionsConsignes, positionnement: versionsPositionnement } };
}

/** GET : les consignes et le positionnement que Claude lit à chaque session (avec les textes par défaut, pour « revenir au défaut »). */
export async function GET() {
  try {
    return NextResponse.json(await vue());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/assistant/consignes");
  }
}

const schema = z.object({ consignes: z.string().trim().min(50).max(20_000).optional(), positionnement: z.string().trim().min(20).max(20_000).optional(), restaurer: z.object({ texte: z.enum(["consignes", "positionnement"]), numero: z.number().int().min(1) }).optional() });

/** PATCH { consignes?, positionnement?, restaurer? } : Lucas écrit (chaque enregistrement fait une version) ; « restaurer » remet une version. */
export async function PATCH(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.consignes !== undefined) await enregistrerConsignes(entree.consignes, "LUCAS");
    if (entree.positionnement !== undefined) await enregistrerPositionnement(entree.positionnement, "LUCAS");
    if (entree.restaurer) await restaurerVersion(CLES_TEXTE[entree.restaurer.texte], entree.restaurer.numero, "LUCAS");
    return NextResponse.json(await vue());
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/assistant/consignes");
  }
}
