import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { purgerSiNecessaire, type ReferenceSimulee } from "@/lib/site/simulations";
import { rendreSimulation, simulationAutorisee } from "@/lib/acces/limite-site";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";
import { entetesCorsSimulateur, ipDuVisiteurSimulateur, origineSimulateurAutorisee, parcoursIdValide, travailIdValide } from "@/lib/site/cors-simulate";
import { genererEtGarderSynchrone } from "@/lib/site/simulation-synchrone";
import { creerTravailSimulation } from "@/lib/simulations/travaux";
import { suivreTravail } from "@/lib/simulations/travaux-lecture";

/**
 * /api/simulate — le simulateur du site, côté génération (Railway, sans plafond de temps).
 *
 * Mission 15 (partie 1) : ASYNCHRONE. Le navigateur appelle d'abord
 * coverswap.fr/api/simulation/prepare (captcha, construction du prompt,
 * signature HMAC), puis transmet ici { prompt, swatchUrls, sig, exp, parcoursId,
 * photo_base64, asynchrone: true }. Vérifications DANS CET ORDRE : expiration,
 * signature, puis quota (une requête forgée ou expirée ne consomme rien), puis
 * purge opportuniste. La photo est écrite sur le volume, un TravailSimulation
 * EN_ATTENTE est créé et sa tâche mise en file ; réponse immédiate 202
 * { ok, travailId, attenteEstimeeS }. Le navigateur suit ensuite par
 * GET /api/simulate?id=&p= (sans quota) ; les images se lisent par /api/simulate/image.
 *
 * Ancien contrat (site d'avant la partie 1, sans `asynchrone`) : réponse
 * synchrone avec l'image — gardé pendant la transition, à retirer en partie 4.
 *
 * Variables d'environnement requises sur Railway :
 *   - OPENAI_API_KEY          (clé OpenAI avec crédits image)
 *   - SIMULATE_TOKEN_SECRET   (même valeur que côté coverswap/Vercel)
 */

export const dynamic = "force-dynamic";
// maxDuration est un concept Vercel ignoré par Railway, mais on le déclare
// haut au cas où ce code tournerait un jour sur une plateforme serverless.
export const maxDuration = 300;

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: entetesCorsSimulateur(req.headers.get("origin")) });
}

/** Suivi d'un travail : `?id=<travailId>&p=<parcoursId>`. 404 sans détail si le parcours ne correspond pas. */
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = { ...entetesCorsSimulateur(origin), "Cache-Control": "no-store" };
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });
  const id = travailIdValide(req.nextUrl.searchParams.get("id"));
  const parcoursId = parcoursIdValide(req.nextUrl.searchParams.get("p"));
  if (!id || !parcoursId) return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });
  try {
    const suivi = await suivreTravail(id, parcoursId);
    if (!suivi) return NextResponse.json({ error: "Simulation introuvable.", reason: "not-found" }, { status: 404, headers: cors });
    return NextResponse.json(suivi, { headers: cors });
  } catch (err) {
    console.error("[simulate] suivi impossible :", err);
    return NextResponse.json({ error: "Service indisponible.", reason: "internal" }, { status: 500, headers: cors });
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = entetesCorsSimulateur(origin);
  if (!origineSimulateurAutorisee(origin)) return NextResponse.json({ error: "Origine non autorisée.", reason: "origin" }, { status: 403, headers: cors });

  const secret = process.env.SIMULATE_TOKEN_SECRET;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!secret || !apiKey) {
    console.error("[simulate] config manquante:", { hasSecret: !!secret, hasKey: !!apiKey });
    return NextResponse.json({ error: MESSAGES_ECHEC["service-indisponible"], reason: "service-indisponible" }, { status: 503, headers: cors });
  }

  let body: {
    prompt?: string;
    swatchUrls?: string[];
    sig?: string;
    exp?: number;
    leadId?: string;
    referenceChoisie?: string;
    photo_base64?: string;
    // Parcours sans coordonnées (simulateur v2) : la simulation est gardée ici, rattachée plus tard au lead.
    parcoursId?: string;
    projet?: string;
    references?: ReferenceSimulee[];
    page?: string;
    source?: string;
    campagne?: string;
    /** Mission 15 : nouveau contrat (travail + suivi). Absent : ancien contrat synchrone. */
    asynchrone?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400, headers: cors });
  }

  const { prompt, sig, exp, leadId, referenceChoisie, photo_base64, projet, page, source, campagne } = body;
  const swatchUrls = Array.isArray(body.swatchUrls) ? body.swatchUrls.filter((u): u is string => typeof u === "string") : [];
  const parcoursId = parcoursIdValide(body.parcoursId);
  const references = Array.isArray(body.references)
    ? body.references.filter((r): r is ReferenceSimulee => !!r && typeof r === "object" && typeof r.ref === "string").slice(0, 5).map((r) => ({ zone: String(r.zone ?? ""), libelle: String(r.libelle ?? ""), ref: String(r.ref), nom: String(r.nom ?? "") }))
    : [];
  const ip = ipDuVisiteurSimulateur(req.headers);

  if (!prompt || !sig || !exp || !photo_base64) {
    return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });
  }

  // 1) Expiration du jeton
  if (Date.now() > exp) {
    return NextResponse.json({ error: "Session expirée, relancez la simulation.", reason: "expired" }, { status: 401, headers: cors });
  }

  // 2) Vérification HMAC (anti-falsification prompt + anti-détournement swatchUrls
  //    + leadId : personne ne peut rattacher une image à la fiche d'un autre).
  //    Sans leadId (ancien site), l'ancienne forme reste acceptée.
  const cle = leadId ? leadId : parcoursId ? `p:${parcoursId}` : null;
  const base = `${prompt}\n${swatchUrls.join(",")}\n${exp}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(cle ? `${base}\n${cle}` : base)
    .digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.error("[simulate] signature invalide");
    return NextResponse.json({ error: "Signature invalide.", reason: "bad-signature" }, { status: 401, headers: cors });
  }

  // 3) Limite quotidienne par IP et globale — APRÈS la signature : une requête forgée ne consomme rien.
  const quota = simulationAutorisee(ip);
  if (!quota.ok) {
    return NextResponse.json(
      {
        error:
          quota.raison === "global"
            ? "Le quota quotidien de simulations est atteint pour l'ensemble du site. Réessayez demain ou demandez un devis : nous ferons la simulation pour vous."
            : "Vous avez atteint la limite de simulations gratuites pour aujourd'hui. Demandez un devis : nous ferons la simulation pour vous.",
        reason: quota.raison === "global" ? "global-quota" : "ip-quota",
      },
      { status: 429, headers: cors }
    );
  }
  await purgerSiNecessaire();

  // 4) Nouveau contrat : le travail est créé, la tâche mise en file, la réponse part tout de suite.
  if (body.asynchrone === true) {
    if (!parcoursId) return NextResponse.json({ error: "Identifiant de parcours manquant : rechargez la page.", reason: "parcours" }, { status: 400, headers: cors });
    try {
      const { travailId, attenteEstimeeS } = await creerTravailSimulation({
        parcoursId,
        projet: typeof projet === "string" ? projet : "cuisine",
        references,
        prompt,
        swatchUrls,
        photoBase64: photo_base64,
        page: typeof page === "string" ? page : null,
        source: typeof source === "string" ? source : null,
        campagne: typeof campagne === "string" ? campagne : null,
        ipOrigine: ip === "inconnue" ? null : ip,
      });
      return NextResponse.json({ ok: true, travailId, attenteEstimeeS }, { status: 202, headers: cors });
    } catch (err) {
      // Panne de notre côté : le quota compté juste avant est rendu au visiteur.
      rendreSimulation(ip);
      console.error("[simulate] création du travail impossible :", err);
      return NextResponse.json({ error: "Le service de simulation ne répond pas pour l'instant. Votre photo et vos choix sont conservés : réessayez dans un instant.", reason: "internal" }, { status: 500, headers: cors });
    }
  }

  // 5) Ancien contrat (transition) : génération et stockage dans la requête.
  const reponse = await genererEtGarderSynchrone({ prompt, swatchUrls, photoBase64: photo_base64, ip, leadId, referenceChoisie, parcoursId, projet, references, page, source, campagne });
  return NextResponse.json(reponse.corps, { status: reponse.status, headers: cors });
}
