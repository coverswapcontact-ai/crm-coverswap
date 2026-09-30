import { NextRequest, NextResponse } from "next/server";
import { analyseAutorisee } from "@/lib/acces/limite-site";
import { entetesCorsSimulateur, ipDuVisiteurSimulateur, origineSimulateurAutorisee, parcoursIdValide } from "@/lib/site/cors-simulate";
import { demanderAnalyseSite, suivreAnalyseSite } from "@/lib/simulateur/analyses";

/**
 * /api/simulate/analyse — l'analyse de la photo du visiteur (mission 15,
 * partie 2), lancée DÈS la photo chargée, pendant qu'il choisit ses matières.
 *
 * POST { parcoursId, projet, photo_base64 } : la photo est écrite sur le volume
 * et la tâche ANALYSE_PHOTO mise en file ; réponse immédiate
 * { ok, empreinte, statut, analyse? } (l'analyse déjà connue de cette photo
 * revient tout de suite). Preuve : le parcours + une limite de 10 analyses par
 * adresse et par jour, 400 pour tout le site (un appel vision coûte un
 * demi-centime) — comptée seulement quand une analyse est réellement mise en
 * file (202), jamais pour une photo refusée ou une analyse déjà prête.
 * GET ?e=<empreinte>&p=<parcoursId> : l'état, et l'analyse quand elle est prête ;
 * une analyse sautée ou en échec ne rend qu'un code (`raison`), jamais le détail.
 * La génération réutilise l'analyse par l'empreinte de la même photo.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesCorsSimulateur(req.headers.get("origin")) });
}

const empreinteValide = (valeur: unknown): string | undefined => (typeof valeur === "string" && /^[0-9a-f]{64}$/.test(valeur) ? valeur : undefined);

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = { ...entetesCorsSimulateur(origin), "Cache-Control": "no-store" };
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  const empreinte = empreinteValide(req.nextUrl.searchParams.get("e"));
  const parcoursId = parcoursIdValide(req.nextUrl.searchParams.get("p"));
  if (!empreinte || !parcoursId) return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });
  try {
    const etat = await suivreAnalyseSite(empreinte, parcoursId);
    if (!etat) return NextResponse.json({ error: "Analyse introuvable.", reason: "not-found" }, { status: 404, headers: cors });
    return NextResponse.json(etat, { headers: cors });
  } catch (err) {
    console.error("[simulate/analyse] suivi impossible :", err);
    return NextResponse.json({ error: "Service indisponible.", reason: "internal" }, { status: 500, headers: cors });
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = entetesCorsSimulateur(origin);
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  let body: { parcoursId?: unknown; projet?: unknown; photo_base64?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide.", reason: "bad-request" }, { status: 400, headers: cors });
  }
  const parcoursId = parcoursIdValide(body.parcoursId);
  if (!parcoursId) return NextResponse.json({ error: "Identifiant de parcours manquant : rechargez la page.", reason: "parcours" }, { status: 400, headers: cors });
  if (typeof body.photo_base64 !== "string" || !body.photo_base64) return NextResponse.json({ error: "Photo manquante.", reason: "bad-request" }, { status: 400, headers: cors });
  const ip = ipDuVisiteurSimulateur(req.headers);
  try {
    // Le quota n'est demandé (et compté) que si une analyse doit être mise en file.
    const reponse = await demanderAnalyseSite({ parcoursId, piece: typeof body.projet === "string" ? body.projet : "cuisine", photoBase64: body.photo_base64, quota: () => analyseAutorisee(ip) });
    if (!reponse.ok) return NextResponse.json({ error: reponse.message, reason: reponse.raison }, { status: reponse.status, headers: cors });
    return NextResponse.json(reponse, { status: reponse.nouvelle ? 202 : 200, headers: cors });
  } catch (err) {
    console.error("[simulate/analyse] demande impossible :", err);
    return NextResponse.json({ error: "Le service ne répond pas pour l'instant : vous pouvez lancer la simulation sans analyse.", reason: "internal" }, { status: 500, headers: cors });
  }
}
