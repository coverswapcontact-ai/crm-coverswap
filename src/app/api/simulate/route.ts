import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * /api/simulate — GÉNÉRATEUR D'IMAGE SANS PLAFOND DE TEMPS.
 *
 * Hébergé sur Railway (serveur Node persistant), cet endpoint n'a PAS la
 * contrainte des 60s de Vercel : gpt-image-1 peut prendre 30-90s sans risque.
 *
 * Flux : le navigateur appelle d'abord coverswap.fr/api/simulation/prepare
 * (rate-limit + lead + construction du prompt + signature HMAC), puis transmet
 * ici { prompt, swatchUrls, sig, exp, photo_base64 }. On vérifie la signature
 * (anti-falsification/anti-abus), on télécharge les swatches, on appelle OpenAI,
 * on renvoie l'image.
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

// OpenAI peut être lent ; on coupe à 120s pour ne pas pendre indéfiniment.
const OPENAI_TIMEOUT_MS = 120_000;

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
      { error: "Service non configuré.", reason: "not-configured" },
      { status: 503, headers: cors }
    );
  }

  let body: {
    prompt?: string;
    swatchUrls?: string[];
    sig?: string;
    exp?: number;
    photo_base64?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400, headers: cors });
  }

  const { prompt, swatchUrls = [], sig, exp, photo_base64 } = body;

  if (!prompt || !sig || !exp || !photo_base64) {
    return NextResponse.json(
      { error: "Paramètres manquants.", reason: "bad-request" },
      { status: 400, headers: cors }
    );
  }

  // 1) Expiration du jeton
  if (Date.now() > exp) {
    return NextResponse.json(
      { error: "Session expirée, relancez la simulation.", reason: "expired" },
      { status: 401, headers: cors }
    );
  }

  // 2) Vérification HMAC (anti-falsification prompt + anti-détournement swatchUrls)
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${prompt}\n${swatchUrls.join(",")}\n${exp}`)
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
    const dims = getImageDimensions(photoBuffer);
    let outputSize = "1024x1024";
    if (dims) {
      const ratio = dims.width / dims.height;
      if (ratio > 1.15) outputSize = "1536x1024";
      else if (ratio < 0.85) outputSize = "1024x1536";
    }

    // 5) Appel OpenAI — quality "medium" : on a le temps (pas de plafond Vercel),
    //    donc on privilégie la qualité de rendu sur la vitesse.
    const formData = new FormData();
    formData.append("model", "gpt-image-1");
    formData.append("prompt", prompt);
    formData.append("size", outputSize);
    formData.append("quality", "medium");
    formData.append(
      "image[]",
      new Blob([new Uint8Array(photoBuffer)], { type: "image/png" }),
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
          error: isAbort
            ? "La génération a pris trop de temps. Réessayez."
            : "Service de génération indisponible. Réessayez dans un instant.",
          reason: isAbort ? "openai-timeout" : "openai-network",
        },
        { status: isAbort ? 504 : 502, headers: cors }
      );
    }
    clearTimeout(timeoutId);

    if (!imageRes.ok) {
      const errText = await imageRes.text().catch(() => "");
      console.error(`[simulate] OpenAI HTTP ${imageRes.status}:`, errText.slice(0, 400));
      const userMessage =
        imageRes.status === 400
          ? "L'IA a refusé cette photo (probablement trop sombre, floue ou non conforme). Essayez une autre photo bien éclairée."
          : imageRes.status === 429
          ? "Trop de requêtes vers le service IA. Réessayez dans une minute."
          : "Erreur lors de la génération. Réessayez ou contactez-nous.";
      return NextResponse.json(
        { error: userMessage, reason: "openai-error", status: imageRes.status },
        { status: 502, headers: cors }
      );
    }

    const data = await imageRes.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      console.error("[simulate] réponse OpenAI sans b64_json");
      return NextResponse.json(
        { error: "Aucune image générée. Réessayez.", reason: "no-image-data" },
        { status: 502, headers: cors }
      );
    }

    console.log(`[simulate] OK en ${Date.now() - startMs}ms (size ${outputSize}, ${swatchBuffers.length} swatches)`);
    return NextResponse.json(
      { success: true, image: `data:image/png;base64,${b64}` },
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
