import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { imageEchantillon } from "@/lib/simulateur/catalogue";

export const dynamic = "force-dynamic";

/** GET : l'image d'un échantillon Cover Styl', servie par le CRM (cache sur le volume). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  try {
    const { ref } = await params;
    const contenu = await imageEchantillon(decodeURIComponent(ref));
    return new NextResponse(new Uint8Array(contenu), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800" } });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/echantillons/[ref]");
  }
}
