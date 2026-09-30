import { NextRequest, NextResponse } from "next/server";
import { entetesCorsSimulateur, origineSimulateurAutorisee, parcoursIdValide, travailIdValide } from "@/lib/site/cors-simulate";
import { imageTravail } from "@/lib/simulations/travaux-lecture";

/**
 * GET /api/simulate/image?id=<travailId>&p=<parcoursId>&quoi=apres|avant —
 * le rendu (ou la photo avant cadrée) d'un travail PRETE du simulateur du
 * site, servi par adresse : la mémoire du navigateur garde des URL, plus des
 * base64 de plusieurs Mo (mission 15, partie 1). Il faut l'identifiant du
 * travail ET celui du parcours : rien n'est devinable.
 */
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesCorsSimulateur(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = entetesCorsSimulateur(origin);
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  const id = travailIdValide(req.nextUrl.searchParams.get("id"));
  const parcoursId = parcoursIdValide(req.nextUrl.searchParams.get("p"));
  const quoi = req.nextUrl.searchParams.get("quoi") === "avant" ? "avant" : "apres";
  if (!id || !parcoursId) return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });
  try {
    const image = await imageTravail(id, parcoursId, quoi);
    if (!image) return NextResponse.json({ error: "Image introuvable.", reason: "not-found" }, { status: 404, headers: { ...cors, "Cache-Control": "no-store" } });
    return new NextResponse(new Uint8Array(image.contenu), { headers: { ...cors, "Content-Type": image.type, "Cache-Control": "private, max-age=86400", "X-Robots-Tag": "noindex, nofollow" } });
  } catch (err) {
    console.error("[simulate] image illisible :", err);
    return NextResponse.json({ error: "Service indisponible.", reason: "internal" }, { status: 500, headers: cors });
  }
}
