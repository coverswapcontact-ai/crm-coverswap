import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { enregistrerVersion, lirePrompt, restaurerVersion, texteDeVersion } from "@/lib/simulateur/bibliotheque";
import { etiquettes, rendrePrompt, verifierModele } from "@/lib/simulateur/rendu";
import { typeSurface } from "@/lib/simulateur/types-surface";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enregistrer"), texte: z.string().max(12_000, "Prompt trop long (12 000 caractères au plus)."), note: z.string().max(300).nullable().optional() }),
  z.object({ action: z.literal("restaurer"), numero: z.number().int().min(1) }),
  z.object({ action: z.literal("verifier"), texte: z.string().max(12_000) }),
]);

/** Teintes d'exemple de l'aperçu : on voit où tombe chaque morceau du prompt sans rien préparer. */
const EXEMPLE = 'Cover Styl\' AA01 "Beige Oak" — wood-grain decor (chêne, beige): base tone light warm beige (about #C8B08E); grain soft, low-contrast, running vertically (bottom to top) on this surface, […].';

/** GET ?version=N : le prompt d'un type (version en service et historique), ou le texte d'une version ancienne. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const version = Number(requete.nextUrl.searchParams.get("version"));
    if (version > 0) return NextResponse.json({ numero: version, texte: await texteDeVersion(type, version) });
    return NextResponse.json({ prompt: await lirePrompt(type) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/prompts/[type]");
  }
}

/**
 * POST { action } :
 *   enregistrer { texte, note? } → nouvelle version, mise en service ;
 *   restaurer { numero }        → l'ancien texte revient, sous un nouveau numéro ;
 *   verifier { texte }          → contrôles et aperçu rendu avec des teintes d'exemple, sans rien enregistrer.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type: id } = await params;
    const type = typeSurface(id);
    if (!type) throw new ErreurMetier("Type de surface inconnu.", 404);
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.action === "enregistrer") return NextResponse.json({ prompt: await enregistrerVersion(id, entree) });
    if (entree.action === "restaurer") return NextResponse.json({ prompt: await restaurerVersion(id, entree.numero) });
    const controle = verifierModele(entree.texte, type);
    const lettres = etiquettes(type, type.zones);
    const apercu = controle.erreurs.length ? null : rendrePrompt(entree.texte, { type, zones: type.zones.map((zone) => ({ zone, etiquette: lettres.get(zone)!, teinte: EXEMPLE })), format: "landscape 3:2" });
    return NextResponse.json({ ...controle, apercu });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/simulateur/prompts/[type]");
  }
}
