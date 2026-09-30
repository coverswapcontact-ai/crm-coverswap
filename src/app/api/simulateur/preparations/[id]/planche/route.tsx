import type { NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { imageEchantillon } from "@/lib/simulateur/catalogue";
import { construirePlanche } from "@/lib/simulateur/moteur/planche";
import { lirePreparation } from "@/lib/simulateur/preparation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET : la planche des teintes d'une préparation — l'« Image 2 » que l'on joint
 * dans ChatGPT (et, mission 15, celle que le moteur V2 joint à l'API). Fond
 * neutre, échantillons grands et carrés, chacun étiqueté par sa lettre et sa
 * zone, avec la référence et le nom de la teinte. Construite par
 * `moteur/planche.tsx` (réutilisable hors requête). ?telecharger=1 : en pièce jointe.
 */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const preparation = await lirePreparation(id);
    const tuiles = await Promise.all(preparation.zones.map(async (z) => ({ etiquette: z.etiquette, ref: z.ref, nom: z.nom, resume: z.resume, image: await imageEchantillon(z.ref) })));
    const png = await construirePlanche(tuiles, `CoverSwap · ${preparation.typeLibelle}`);
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${requete.nextUrl.searchParams.get("telecharger") ? "attachment" : "inline"}; filename="planche-teintes-${id.slice(-6)}.png"`,
      },
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/simulateur/preparations/[id]/planche");
  }
}
