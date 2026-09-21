import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { rattacherImagesSimulation } from "@/lib/simulations/images";
import { enregistrerSimulationSite, purgerSiNecessaire, rattacherSimulationsSite, type ReferenceSimulee } from "@/lib/site/simulations";
import { assurerDossierDeSimulation } from "@/lib/dossiers/depuis-lead";
import prisma from "@/lib/prisma";
import { rendreSimulation, simulationAutorisee } from "@/lib/acces/limite-site";
import { genererRendu } from "@/lib/simulations/generation";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";

/**
 * /api/simulate — GÉNÉRATEUR D'IMAGE SANS PLAFOND DE TEMPS.
 *
 * Hébergé sur Railway (serveur Node persistant), cet endpoint n'a PAS la
 * contrainte des 60s de Vercel : gpt-image-1 peut prendre 30-90s sans risque.
 *
 * Flux : le navigateur appelle d'abord coverswap.fr/api/simulation/prepare
 * (rate-limit + lead + construction du prompt + signature HMAC), puis transmet
 * ici { prompt, swatchUrls, sig, exp, leadId, photo_base64 }. On vérifie la
 * signature (anti-falsification/anti-abus), puis le générateur commun
 * (lib/simulations/generation : le même que le simulateur du CRM) télécharge
 * les échantillons, appelle OpenAI et compte la consommation ; on renvoie
 * l'image — et on la rattache, avec la photo d'origine, au lead et à son dossier.
 *
 * Variables d'environnement requises sur Railway :
 *   - OPENAI_API_KEY          (clé OpenAI avec crédits image)
 *   - SIMULATE_TOKEN_SECRET   (même valeur que côté coverswap/Vercel)
 */

export const dynamic = "force-dynamic";
// maxDuration est un concept Vercel ignoré par Railway, mais on le déclare
// haut au cas où ce code tournerait un jour sur une plateforme serverless.
export const maxDuration = 300;

const ALLOWED_ORIGINS = [
  "https://coverswap.fr",
  "https://www.coverswap.fr",
];

function corsHeaders(origin: string | null): Record<string, string> {
  // En développement, le site local (localhost:3000) appelle le CRM local ; jamais en production.
  const local = process.env.NODE_ENV !== "production" && origin !== null && /^http:\/\/localhost:\d+$/.test(origin);
  const allowed = origin && (ALLOWED_ORIGINS.includes(origin) || local) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  const secret = process.env.SIMULATE_TOKEN_SECRET;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!secret || !apiKey) {
    console.error("[simulate] config manquante:", { hasSecret: !!secret, hasKey: !!apiKey });
    return NextResponse.json(
      { error: MESSAGES_ECHEC["service-indisponible"], reason: "service-indisponible" },
      { status: 503, headers: cors }
    );
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400, headers: cors });
  }

  const { prompt, swatchUrls = [], sig, exp, leadId, referenceChoisie, photo_base64, projet, page, source, campagne } = body;
  const parcoursId = typeof body.parcoursId === "string" && /^[0-9a-fA-F-]{16,64}$/.test(body.parcoursId) ? body.parcoursId : undefined;
  const references = Array.isArray(body.references)
    ? body.references.filter((r): r is ReferenceSimulee => !!r && typeof r === "object" && typeof r.ref === "string").slice(0, 5).map((r) => ({ zone: String(r.zone ?? ""), libelle: String(r.libelle ?? ""), ref: String(r.ref), nom: String(r.nom ?? "") }))
    : [];
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "inconnue";

  if (!prompt || !sig || !exp || !photo_base64) {
    return NextResponse.json(
      { error: "Paramètres manquants.", reason: "bad-request" },
      { status: 400, headers: cors }
    );
  }

  // 0) Limite quotidienne par IP et globale (la limite du site, en mémoire serverless, n'est qu'indicative)
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

  // 1) Expiration du jeton
  if (Date.now() > exp) {
    return NextResponse.json(
      { error: "Session expirée, relancez la simulation.", reason: "expired" },
      { status: 401, headers: cors }
    );
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
    return NextResponse.json(
      { error: "Signature invalide.", reason: "bad-signature" },
      { status: 401, headers: cors }
    );
  }

  try {
    // 3) Génération : échantillons, cadrage, OpenAI, consommation — le générateur commun.
    const rawBase64 = photo_base64.replace(/^data:image\/\w+;base64,/, "");
    const resultat = await genererRendu({ prompt, swatchUrls, photo: Buffer.from(rawBase64, "base64"), origine: "SITE" });
    if (!resultat.ok) {
      // Panne de notre côté (crédit épuisé, clé refusée) : le quota est rendu au visiteur,
      // qui lit un message clair et peut laisser ses coordonnées ; le gérant est prévenu par mail.
      if (resultat.raison === "service-indisponible" || resultat.raison === "config") rendreSimulation(ip);
      const raison = resultat.raison === "config" ? "service-indisponible" : resultat.raison;
      return NextResponse.json({ error: resultat.message, reason: raison }, { status: resultat.status, headers: cors });
    }
    const b64 = resultat.image.toString("base64");
    const cadrage = { avant: resultat.avant };
    const startMs = Date.now() - resultat.dureeMs;

    // 6) Photo avant + rendu après : sur la simulation du lead (ancien parcours), ou
    //    gardés avec le parcours en attendant la demande de devis (jamais bloquant).
    let simulationId: string | null = null;
    let simulationSiteId: string | null = null;
    if (!leadId && parcoursId) {
      try {
        const gardee = await enregistrerSimulationSite({
          parcoursId,
          projet: typeof projet === "string" ? projet.slice(0, 40) : "cuisine",
          references,
          imageAvantBase64: photo_base64,
          imageApresBase64: `data:image/png;base64,${b64}`,
          page: typeof page === "string" ? page.slice(0, 200) : null,
          source: typeof source === "string" ? source.slice(0, 120) : null,
          campagne: typeof campagne === "string" ? campagne.slice(0, 120) : null,
          ipOrigine: ip === "inconnue" ? null : ip,
          dureeMs: Date.now() - startMs,
        });
        simulationSiteId = gardee.id;
        console.log(`[simulate] simulation gardée parcours=${parcoursId} id=${gardee.id}`);
        // La personne a déjà laissé ses coordonnées pendant ce parcours : la nouvelle simulation rejoint sa fiche et son dossier.
        const connu = await prisma.lead.findFirst({ where: { parcoursId }, orderBy: { createdAt: "desc" }, select: { id: true } });
        if (connu) {
          await rattacherSimulationsSite(connu.id, parcoursId, [gardee.id]);
          await assurerDossierDeSimulation(connu.id);
        }
      } catch (err) {
        console.error("[simulate] simulation du parcours non gardée (non bloquant) :", err);
      }
    }
    if (leadId) {
      try {
        simulationId = await rattacherImagesSimulation(leadId, photo_base64, `data:image/png;base64,${b64}`, referenceChoisie ?? null);
        console.log(`[simulate] images rattachées lead=${leadId} simulation=${simulationId ?? "?"}`);
        await assurerDossierDeSimulation(leadId);
      } catch (err) {
        console.error("[simulate] rattachement des images impossible (non bloquant) :", err);
      }
    }

    return NextResponse.json(
      // imageAvant : la photo au cadrage exact du rendu (rognée au format du modèle), pour un avant / après superposable.
      { success: true, image: `data:image/png;base64,${b64}`, imageAvant: cadrage.avant ? `data:image/jpeg;base64,${cadrage.avant.toString("base64")}` : null, simulationId, simulationSiteId },
      { headers: cors }
    );
  } catch (err) {
    console.error("[simulate] erreur:", err);
    return NextResponse.json(
      { error: "Service indisponible.", reason: "internal" },
      { status: 500, headers: cors }
    );
  }
}
