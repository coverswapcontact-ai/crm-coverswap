import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { rattacherImagesSimulation } from "@/lib/simulations/images";
import { enregistrerSimulationSite, purgerSiNecessaire, type ReferenceSimulee } from "@/lib/site/simulations";
import { rendreSimulation, simulationAutorisee } from "@/lib/acces/limite-site";
import { cadrerPourGeneration, recadrerRendu, tailleSelonRatio } from "@/lib/simulations/cadrage";
import { MESSAGES_ECHEC, alerterPanneSimulateur, classerErreurOpenAI } from "@/lib/site/erreurs-generation";

/**
 * /api/simulate — GÉNÉRATEUR D'IMAGE SANS PLAFOND DE TEMPS.
 *
 * Hébergé sur Railway (serveur Node persistant), cet endpoint n'a PAS la
 * contrainte des 60s de Vercel : gpt-image-1 peut prendre 30-90s sans risque.
 *
 * Flux : le navigateur appelle d'abord coverswap.fr/api/simulation/prepare
 * (rate-limit + lead + construction du prompt + signature HMAC), puis transmet
 * ici { prompt, swatchUrls, sig, exp, leadId, photo_base64 }. On vérifie la
 * signature (anti-falsification/anti-abus), on télécharge les swatches, on
 * appelle OpenAI, on renvoie l'image — et on la rattache, avec la photo
 * d'origine, à la simulation du lead créé par prepare (le CRM, c'est ici).
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

// Seul l'hôte S3 Cover Styl' est autorisé pour les swatches (anti-SSRF).
const ALLOWED_SWATCH_HOST = "ssi.s3.fr-par.scw.cloud";

// OpenAI peut être lent (quality high + input_fidelity high = 60-150s).
// Railway n'a aucun plafond ; on coupe à 180s seulement pour ne pas pendre.
const OPENAI_TIMEOUT_MS = 180_000;

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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

/* ── Détection dimensions JPEG/PNG depuis un buffer ── */
function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + buf.readUInt16BE(offset + 2);
    }
  }
  return null;
}

async function downloadSwatch(url: string): Promise<Buffer | null> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== ALLOWED_SWATCH_HOST) {
      console.error(`[simulate] swatch host refusé: ${parsed.hostname}`);
      return null;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
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
    // 3) Téléchargement des swatches (tous requis ; échec = on refuse plutôt
    //    que laisser l'IA inventer une couleur)
    const swatchBuffers: Buffer[] = [];
    for (const url of swatchUrls) {
      const buf = await downloadSwatch(url);
      if (!buf) {
        return NextResponse.json(
          {
            error: "Impossible de charger les références de texture. Réessayez dans un instant.",
            reason: "swatch-download-failed",
          },
          { status: 502, headers: cors }
        );
      }
      swatchBuffers.push(buf);
    }

    // 4) Photo client + détection de taille de sortie (match aspect ratio)
    const rawBase64 = photo_base64.replace(/^data:image\/\w+;base64,/, "");
    const photoBuffer = Buffer.from(rawBase64, "base64");
    // La photo est mise au format du modèle avant l'envoi (lib/simulations/cadrage) : sans cela le
    // modèle recadre à sa façon et le rendu n'est plus superposable à l'original.
    const dims = getImageDimensions(photoBuffer);
    const cadrage = await cadrerPourGeneration(photoBuffer, dims ? tailleSelonRatio(dims.width, dims.height) : "1024x1024");
    const outputSize = cadrage.taille;

    // 5) Appel OpenAI — réglage COÛT/QUALITÉ optimal :
    //    - input_fidelity "high" : LE levier qui corrige les 3 symptômes
    //      (dérive de teinte, application partielle, modifs parasites de la
    //      cuisine). Préserve l'image d'entrée + respecte les swatches. ON LE GARDE.
    //    - quality "medium" : suffisant ici. Le passage à "high" triplait le coût
    //      (~0,20€ vs ~0,07€/simulation) sans gain sur CES problèmes précis, qui
    //      dépendent de input_fidelity + du prompt, pas du niveau de quality.
    const formData = new FormData();
    // Modèle réglable sans redéploiement du code (OPENAI_IMAGE_MODEL), gpt-image-1 par défaut.
    formData.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
    formData.append("prompt", prompt);
    formData.append("size", outputSize);
    formData.append("quality", "medium");
    formData.append("input_fidelity", "high");
    formData.append(
      "image[]",
      new Blob([new Uint8Array(cadrage.photo)], { type: cadrage.type }),
      "kitchen.png"
    );
    swatchBuffers.forEach((buf, i) => {
      formData.append(
        "image[]",
        new Blob([new Uint8Array(buf)], { type: "image/jpeg" }),
        `texture_${i}.jpg`
      );
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    const startMs = Date.now();

    let imageRes: Response;
    try {
      imageRes = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
      console.error(`[simulate] OpenAI ${isAbort ? "timeout" : "fetch error"} après ${Date.now() - startMs}ms:`, err);
      return NextResponse.json(
        {
          error: isAbort ? MESSAGES_ECHEC.delai : MESSAGES_ECHEC.surcharge,
          reason: isAbort ? "delai" : "surcharge",
        },
        { status: isAbort ? 504 : 502, headers: cors }
      );
    }
    clearTimeout(timeoutId);

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => "");
      const raison = classerErreurOpenAI(imageRes.status, errText);
      console.error(`[simulate] OpenAI HTTP ${imageRes.status} (${raison}):`, errText.slice(0, 400));
      // Panne de notre côté (crédit épuisé, clé refusée) : le visiteur le lit tel quel et peut laisser
      // ses coordonnées ; le gérant est prévenu par mail, au plus une fois toutes les six heures.
      if (raison === "service-indisponible") {
        rendreSimulation(ip);
        void alerterPanneSimulateur(imageRes.status, errText);
      }
      return NextResponse.json({ error: MESSAGES_ECHEC[raison], reason: raison, status: imageRes.status }, { status: raison === "service-indisponible" ? 503 : 502, headers: cors });
    }

    const data = await imageRes.json();
    const b64Brut: string | undefined = data.data?.[0]?.b64_json;
    const b64 = b64Brut ? (await recadrerRendu(Buffer.from(b64Brut, "base64"), cadrage)).toString("base64") : undefined;
    if (!b64) {
      console.error("[simulate] réponse OpenAI sans b64_json");
      return NextResponse.json(
        { error: "Aucune image générée. Réessayez.", reason: "no-image-data" },
        { status: 502, headers: cors }
      );
    }

    console.log(`[simulate] OK en ${Date.now() - startMs}ms (size ${outputSize}, zone ${cadrage.zone ? `${cadrage.zone.width}x${cadrage.zone.height}` : "entière"}, ${swatchBuffers.length} swatches)`, JSON.stringify(data.usage ?? {}));

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
      } catch (err) {
        console.error("[simulate] simulation du parcours non gardée (non bloquant) :", err);
      }
    }
    if (leadId) {
      try {
        simulationId = await rattacherImagesSimulation(leadId, photo_base64, `data:image/png;base64,${b64}`, referenceChoisie ?? null);
        console.log(`[simulate] images rattachées lead=${leadId} simulation=${simulationId ?? "?"}`);
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
