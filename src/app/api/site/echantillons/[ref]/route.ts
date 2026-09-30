import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { imageEchantillon, vignetteEchantillon } from "@/lib/simulateur/catalogue";

/**
 * GET /api/site/echantillons/<ref>[?l=320] — l'échantillon d'une référence Cover
 * Styl' pour le simulateur PUBLIC du site (mission 15, partie 4) : la vignette
 * de 320 px de la grille du catalogue (`?l=320`, ~20 Ko), ou l'échantillon
 * entier (vue agrandie). Même cache sur le volume que l'espace client
 * (`/api/espace/<jeton>/echantillons`) et que le CRM : rien de privé, rien
 * d'écrit à la demande du visiteur. Route publique (routes-publiques.ts).
 */
export const dynamic = "force-dynamic";

const REF_VALIDE = /^[A-Za-z0-9_-]{1,24}$/;

export async function GET(requete: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  let id: string;
  try {
    id = decodeURIComponent(ref);
  } catch {
    return NextResponse.json({ error: "Référence invalide." }, { status: 400 });
  }
  if (!REF_VALIDE.test(id)) return NextResponse.json({ error: "Référence invalide." }, { status: 400 });
  const vignette = requete.nextUrl.searchParams.get("l") === "320";
  try {
    const contenu = vignette ? await vignetteEchantillon(id) : await imageEchantillon(id);
    return new NextResponse(new Uint8Array(contenu), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800, s-maxage=604800", "Access-Control-Allow-Origin": "*" },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/site/echantillons/[ref]");
  }
}
