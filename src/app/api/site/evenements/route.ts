import { NextRequest, NextResponse } from "next/server";
import { enregistrerEvenementSite, estTypeEvenementSite } from "@/lib/site/evenements";
import { ipDepasseLaLimite } from "@/lib/acces/limite-site";

/**
 * POST /api/site/evenements — événements de parcours envoyés par le
 * navigateur du visiteur de coverswap.fr. Aucune donnée personnelle acceptée
 * (identifiant de parcours, type, page, utm) ; limité par adresse IP ;
 * origine restreinte au site. Ne renvoie jamais d'erreur bloquante au site.
 */
const ORIGINES = ["https://coverswap.fr", "https://www.coverswap.fr"];
const PARCOURS = /^[0-9a-fA-F-]{16,64}$/;

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINES.includes(origin) ? origin : ORIGINES[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const entetes = cors(req.headers.get("origin"));
  const origin = req.headers.get("origin");
  if (origin && !ORIGINES.includes(origin) && process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 403, headers: entetes });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";
  // Un visiteur normal émet quelques dizaines d'événements ; 200 par 10 min coupe seulement un robot.
  if (ipDepasseLaLimite(`evt:${ip}`, Date.now(), 200)) return NextResponse.json({ ok: false, raison: "limite" }, { status: 429, headers: entetes });

  // Le site envoie en text/plain (requête simple, sans pré-vol, compatible sendBeacon).
  let corps: { parcoursId?: unknown; type?: unknown; page?: unknown; source?: unknown; campagne?: unknown; meta?: unknown };
  try {
    corps = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: entetes });
  }
  const parcoursId = typeof corps.parcoursId === "string" && PARCOURS.test(corps.parcoursId) ? corps.parcoursId : null;
  if (!parcoursId || !estTypeEvenementSite(corps.type)) return NextResponse.json({ ok: false }, { status: 400, headers: entetes });
  const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  try {
    await enregistrerEvenementSite({
      parcoursId,
      type: corps.type,
      page: texte(corps.page),
      source: texte(corps.source),
      campagne: texte(corps.campagne),
      meta: corps.meta && typeof corps.meta === "object" ? (corps.meta as Record<string, unknown>) : null,
    });
  } catch (err) {
    console.error("[site/evenements] enregistrement impossible :", err);
  }
  return NextResponse.json({ ok: true }, { headers: entetes });
}
