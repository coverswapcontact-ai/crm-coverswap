import { NextRequest, NextResponse } from "next/server";
import { POIDS_MAX_PHOTO, conversionRefusee, preparerPhotoSite } from "@/lib/site/conversion-photo";
import { entetesCorsSimulateur, ipDuVisiteurSimulateur, origineSimulateurAutorisee, parcoursIdValide } from "@/lib/site/cors-simulate";

/**
 * POST /api/simulate/photo — la photo du visiteur préparée par le CRM quand son
 * navigateur ne sait pas la décoder (HEIC), mission 15 (partie 4). Corps
 * multipart : `parcoursId`, `photo` (le fichier tel quel, 25 Mo au plus).
 * Réponse : `{ ok, photo_base64, largeur, hauteur, convertie }` — la même data
 * URL JPEG réduite que le navigateur produit lui-même quand il sait lire la
 * photo. Rien n'est écrit sur le volume ni en base : une conversion, une
 * réponse. Origine vérifiée ; 20 conversions par adresse et 60 pour tout le
 * site par 10 min (`LIMITE_CONVERSIONS`), une conversion à la fois.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesCorsSimulateur(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = entetesCorsSimulateur(origin);
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  const ip = ipDuVisiteurSimulateur(req.headers);
  const refus = conversionRefusee(ip);
  if (refus === "ip") {
    return NextResponse.json({ error: "Trop de photos envoyées en peu de temps : réessayez dans quelques minutes.", reason: "ip-quota" }, { status: 429, headers: cors });
  }
  if (refus === "global") {
    return NextResponse.json({ error: "Le service de conversion est très demandé en ce moment : réessayez dans quelques minutes, ou envoyez une capture d'écran de la photo.", reason: "global-quota" }, { status: 429, headers: cors });
  }
  let formulaire: FormData;
  try {
    formulaire = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envoi illisible : reprenez la photo.", reason: "bad-request" }, { status: 400, headers: cors });
  }
  const parcoursId = parcoursIdValide(formulaire.get("parcoursId"));
  if (!parcoursId) return NextResponse.json({ error: "Identifiant de parcours manquant : rechargez la page.", reason: "parcours" }, { status: 400, headers: cors });
  const photo = formulaire.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) return NextResponse.json({ error: "Photo manquante.", reason: "bad-request" }, { status: 400, headers: cors });
  if (photo.size > POIDS_MAX_PHOTO) return NextResponse.json({ error: "Cette photo dépasse 25 Mo. Choisissez une photo plus légère, ou faites une capture d'écran.", reason: "trop-lourde" }, { status: 400, headers: cors });
  try {
    const nom = photo instanceof File ? photo.name : "";
    const preparee = await preparerPhotoSite(Buffer.from(await photo.arrayBuffer()), nom, photo.type);
    if (!preparee.ok) return NextResponse.json({ error: preparee.message, reason: preparee.raison }, { status: 400, headers: cors });
    return NextResponse.json({ ok: true, photo_base64: preparee.dataUrl, largeur: preparee.largeur, hauteur: preparee.hauteur, convertie: preparee.convertie }, { headers: cors });
  } catch (err) {
    console.error("[simulate/photo] conversion impossible :", err);
    return NextResponse.json({ error: "Le service ne répond pas pour l'instant : réessayez, ou envoyez une capture d'écran de la photo.", reason: "internal" }, { status: 500, headers: cors });
  }
}
