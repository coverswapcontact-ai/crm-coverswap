import { NextRequest, NextResponse } from "next/server";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { entetesCorsSimulateur, ipDuVisiteurSimulateur, origineSimulateurAutorisee, parcoursIdValide, travailIdValide } from "@/lib/site/cors-simulate";
import { enregistrerDemandePrevenir } from "@/lib/simulations/prevenir";

/**
 * POST /api/simulate/prevenir — « Me prévenir quand c'est prêt » (mission 15,
 * partie 1). Corps : { travailId, parcoursId, email?, telephone?, consentement: true }.
 * La preuve est le couple travail + parcours (un cuid et un UUID : rien de
 * devinable) ; limite par IP. Le lead du parcours est créé ou retrouvé, la
 * demande notée ; UN mail part à la fin si une adresse est donnée et que
 * l'interrupteur NOTIF_SIMULATION_SITE_PRETE est actif. Jamais de SMS.
 */
export const dynamic = "force-dynamic";

const LIMITE_PAR_IP = 12;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesCorsSimulateur(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = entetesCorsSimulateur(origin);
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  const ip = ipDuVisiteurSimulateur(req.headers);
  if (ipDepasseLaLimite(`prevenir:${ip}`, Date.now(), LIMITE_PAR_IP)) {
    return NextResponse.json({ error: "Trop de demandes depuis cette adresse. Réessayez dans quelques minutes.", reason: "rate-limit" }, { status: 429, headers: cors });
  }
  let body: { travailId?: unknown; parcoursId?: unknown; email?: unknown; telephone?: unknown; consentement?: unknown; consentementTexte?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide.", reason: "bad-request" }, { status: 400, headers: cors });
  }
  const travailId = travailIdValide(body.travailId);
  const parcoursId = parcoursIdValide(body.parcoursId);
  if (!travailId || !parcoursId) return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });
  if (body.consentement !== true) return NextResponse.json({ error: "Cochez la case pour être prévenu.", reason: "consentement" }, { status: 400, headers: cors });
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 160) : null;
  const telephone = typeof body.telephone === "string" ? body.telephone.trim().slice(0, 40) : null;
  // Le texte de la case cochée, tel que le visiteur l'a lu : preuve du consentement (à défaut, le CRM connaît le sien).
  const consentementTexte = typeof body.consentementTexte === "string" ? body.consentementTexte.trim().slice(0, 1000) : null;
  try {
    const resultat = await enregistrerDemandePrevenir({ travailId, parcoursId, email: email || null, telephone: telephone || null, ip, consentementTexte });
    return NextResponse.json({ ok: true, notifie: resultat.notifie }, { headers: cors });
  } catch (err) {
    if (err instanceof ErreurMetier) return NextResponse.json({ error: err.message, reason: err.status === 404 ? "not-found" : "invalide" }, { status: err.status, headers: cors });
    console.error("[simulate] « Me prévenir » impossible :", err);
    return NextResponse.json({ error: "Le service ne répond pas : réessayez dans un instant.", reason: "internal" }, { status: 500, headers: cors });
  }
}
