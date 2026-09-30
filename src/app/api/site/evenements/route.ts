import { NextRequest, NextResponse } from "next/server";
import { enregistrerEvenementSite, estTypeEvenementSite } from "@/lib/site/evenements";
import { ipDepasseLaLimite, ipDuClient } from "@/lib/acces/limite-site";
import { mesurerRequete, paysDuFuseau } from "@/lib/analytique/mesure";
import { estHoteDuSite, familleDe, hoteDe } from "@/lib/analytique/sources";

/**
 * POST /api/site/evenements — événements de parcours envoyés par le
 * navigateur du visiteur de coverswap.fr. Aucune donnée personnelle acceptée
 * (identifiant de parcours, type, page, utm) ; limité par adresse IP ;
 * origine restreinte au site. Ne renvoie jamais d'erreur bloquante au site.
 *
 * Mission 17 (partie B) — mesure sans cookie (docs/ANALYTIQUE.md § 3, analytique/mesure.ts) : à chaque événement, le
 * CRM calcule l'empreinte du visiteur du jour (IP tronquée + navigateur + sel du jour) et la classe d'appareil, puis
 * OUBLIE l'IP et le navigateur ; les robots sont écartés sans rien écrire (réponse { ok: true } quand même). Champs du
 * corps (tous facultatifs, les anciens envois restent acceptés) :
 *   parcoursId (UUID ; absent : l'empreinte du jour en tient lieu), type, page, meta,
 *   source (ancienne source courte `utm_source[/utm_medium]` ou hôte référent), campagne (utm_campaign),
 *   referent (hôte du site d'où vient la visite), fuseau (fuseau IANA du navigateur → pays),
 *   utmSource | utm_source, utmMedium | utm_medium, utmCampagne | utm_campaign, utmContenu | utm_content
 *   (ou un objet utm: { source, medium, campagne, contenu }), gclid (présent : true — la valeur n'est jamais gardée).
 *
 * Relecture B :
 *  - vie privée (point 7) — AUCUNE ligne ne relie deux jours : l'empreinte du jour n'est écrite que sur les PAGE_VUE,
 *    dont l'identifiant de parcours (qui peut vivre 7 jours dans le simulateur) est REMPLACÉ à la réception par
 *    « v-<empreinte> » ; les autres événements (étapes du simulateur, demandes) gardent leur parcours et n'ont PAS
 *    d'empreinte. Sans parcours, l'événement prend « v-<empreinte> » et garde l'empreinte (rien de durable sur la ligne) ;
 *  - abus (point 8) — IP lue par `ipDuClient` (adresse publique la plus à droite de X-Forwarded-For : celle que le
 *    proxy de Railway a ajoutée, jamais une valeur écrite par le navigateur) ; en production, l'en-tête Origin est
 *    EXIGÉ (coverswap.fr ou www) ; corps de plus de 4 Ko refusé (413, Content-Length puis longueur lue) ; la page est
 *    gardée sans « ?… » ni « #… » (ni paramètres ni ancre : rien de personnel ne s'y glisse).
 */
const CORPS_MAX_OCTETS = 4096;

/** Le corps, lu au plus `max` octets (null au-delà : la lecture s'arrête, rien n'est gardé). */
async function lireCorpsBorne(req: NextRequest, max: number): Promise<string | null> {
  const annonce = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(annonce) && annonce > max) return null;
  if (!req.body) return "";
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.byteLength;
    if (taille > max) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(morceaux));
}

/** L'adresse de la page sans paramètres ni ancre (« /simulateur?ref=…#x » → « /simulateur »). */
const pageSansParametres = (page: string | null) => (page ? page.split(/[?#]/)[0] || "/" : null);
const ORIGINES = ["https://coverswap.fr", "https://www.coverswap.fr"];
const PARCOURS = /^[0-9a-fA-F-]{16,64}$/;

function cors(origin: string | null): Record<string, string> {
  return {
    // En développement, le site local (localhost:3000) est accepté ; jamais en production.
    "Access-Control-Allow-Origin": origin && (ORIGINES.includes(origin) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin))) ? origin : ORIGINES[0],
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
  // En production, l'origine est exigée : un appel sans Origin (curl, script) n'est pas un navigateur sur coverswap.fr.
  if (process.env.NODE_ENV === "production" && (!origin || !ORIGINES.includes(origin))) {
    return NextResponse.json({ ok: false }, { status: 403, headers: entetes });
  }
  const ip = ipDuClient(req.headers);
  // Un visiteur normal émet quelques dizaines d'événements ; 200 par 10 min coupe seulement un robot.
  if (ipDepasseLaLimite(`evt:${ip}`, Date.now(), 200)) return NextResponse.json({ ok: false, raison: "limite" }, { status: 429, headers: entetes });

  // Le site envoie en text/plain (requête simple, sans pré-vol, compatible sendBeacon).
  let corps: Record<string, unknown>;
  const texteCorps = await lireCorpsBorne(req, CORPS_MAX_OCTETS).catch(() => "");
  if (texteCorps === null) return NextResponse.json({ ok: false, raison: "trop long" }, { status: 413, headers: entetes });
  try {
    corps = JSON.parse(texteCorps);
    if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new Error("corps");
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: entetes });
  }
  // Un identifiant de parcours mal formé est refusé ; absent, il est permis (mesure au visiteur du jour).
  const parcoursRecu = corps.parcoursId;
  const parcoursId = typeof parcoursRecu === "string" && PARCOURS.test(parcoursRecu) ? parcoursRecu : null;
  if ((parcoursRecu !== undefined && parcoursRecu !== null && !parcoursId) || !estTypeEvenementSite(corps.type)) return NextResponse.json({ ok: false }, { status: 400, headers: entetes });
  const type = corps.type;
  const texte = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const utm = corps.utm && typeof corps.utm === "object" ? (corps.utm as Record<string, unknown>) : {};
  const utmSource = texte(corps.utmSource ?? corps.utm_source ?? utm.source);
  const utmMedium = texte(corps.utmMedium ?? corps.utm_medium ?? utm.medium);
  const campagne = texte(corps.campagne ?? corps.utmCampagne ?? corps.utm_campaign ?? utm.campagne ?? utm.campaign);
  const contenu = texte(corps.utmContenu ?? corps.utm_content ?? corps.contenu ?? utm.contenu ?? utm.content);
  const gclid = corps.gclid === true || corps.gclid === 1 || corps.gclid === "1" || (typeof corps.gclid === "string" && corps.gclid.trim().length > 3);
  const referentBrut = hoteDe(texte(corps.referent, 300));
  const referent = referentBrut && !estHoteDuSite(referentBrut) ? referentBrut : null;
  const sourceAncienne = texte(corps.source);
  const source = sourceAncienne ?? (utmSource ? (utmMedium ? `${utmSource}/${utmMedium}` : utmSource) : referent);
  try {
    const mesure = await mesurerRequete({ ip: ip === "inconnue" ? null : ip, userAgent: req.headers.get("user-agent") });
    // Robot, aperçu de lien, outil de test : rien n'est compté.
    if (mesure.robot) return NextResponse.json({ ok: true }, { headers: entetes });
    const metaRecue = corps.meta && typeof corps.meta === "object" && !Array.isArray(corps.meta) ? (corps.meta as Record<string, unknown>) : null;
    const complements = { ...(contenu ? { utm_content: contenu } : {}), ...(gclid ? { gclid: true } : {}) };
    const meta = metaRecue || Object.keys(complements).length ? { ...(metaRecue ?? {}), ...complements } : null;
    // Vie privée : l'empreinte du jour seulement sur une ligne sans parcours durable (voir l'en-tête).
    const pageVue = type === "PAGE_VUE" || !parcoursId;
    await enregistrerEvenementSite({
      parcoursId: pageVue ? `v-${mesure.visiteur}` : parcoursId,
      type,
      page: pageSansParametres(texte(corps.page, 200)),
      source,
      campagne,
      meta,
      visiteur: pageVue ? mesure.visiteur : null,
      appareil: mesure.appareil,
      pays: paysDuFuseau(texte(corps.fuseau, 64)),
      referent,
      famille: familleDe({ source: utmSource ?? sourceAncienne, medium: utmMedium, campagne, referent, gclid }),
    });
  } catch (err) {
    console.error("[site/evenements] enregistrement impossible :", err);
  }
  return NextResponse.json({ ok: true }, { headers: entetes });
}
