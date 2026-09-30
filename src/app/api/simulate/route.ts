import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { purgerSiNecessaire, type ReferenceSimulee } from "@/lib/site/simulations";
import { rendreSimulation, simulationAutorisee } from "@/lib/acces/limite-site";
import { MESSAGES_ECHEC } from "@/lib/site/erreurs-generation";
import { entetesCorsSimulateur, ipDuVisiteurSimulateur, origineSimulateurAutorisee, parcoursIdValide, travailIdValide } from "@/lib/site/cors-simulate";
import { lireSelectionsCorps, resoudreSelections, signatureSelections, signatureValide } from "@/lib/site/contrat-simulate";
import { zonesNonVisiblesPourPhoto } from "@/lib/simulateur/analyses";
import { reglagesSimulateur } from "@/lib/simulateur/reglages";
import { ZONES_MAX, ZONES_SIMULATEUR, type IdZone } from "@/lib/simulateur/zones";
import { creerTravailSimulation, referencesCoherentes, zonesDuTravail } from "@/lib/simulations/travaux";
import { suivreTravail } from "@/lib/simulations/travaux-lecture";

/**
 * /api/simulate — le simulateur du site, côté génération (Railway, sans plafond de temps).
 *
 * Mission 15 (partie 1) : ASYNCHRONE. La photo est écrite sur le volume, un
 * TravailSimulation EN_ATTENTE est créé et sa tâche mise en file ; réponse
 * immédiate 202 { ok, travailId, attenteEstimeeS }. Le navigateur suit ensuite
 * par GET /api/simulate?id=&p= (sans quota) ; les images se lisent par
 * /api/simulate/image.
 *
 * Mission 15 (partie 4) : le site est un simple CLIENT — il n'envoie plus de
 * prompt. Corps : { projet, selections: [{ surface, ref }], sig, exp, parcoursId,
 * photo_base64, asynchrone: true, page, source, campagne }, où `sig` signe
 * { parcoursId, projet, selections, exp } (contrat-simulate.ts). Le CRM relit
 * les zones (source unique) et les références (catalogue) ; le moteur (V1 revu
 * ou V2) construit lui-même la consigne. L'ancien corps asynchrone (prompt +
 * swatchUrls signés) reste accepté le temps du déploiement du site ; le contrat
 * SYNCHRONE d'avant la partie 1 est RETIRÉ (400 « contrat »).
 *
 * Vérifications DANS CET ORDRE : expiration, signature, sélections, zone non
 * visible (409 d'après l'analyse connue), puis quota (une requête forgée,
 * expirée ou refusée ne consomme rien), puis purge opportuniste.
 *
 * Variables d'environnement requises sur Railway :
 *   - OPENAI_API_KEY          (clé OpenAI avec crédits image)
 *   - SIMULATE_TOKEN_SECRET   (même valeur que côté coverswap/Vercel)
 */

export const dynamic = "force-dynamic";
// maxDuration est un concept Vercel ignoré par Railway, mais on le déclare
// haut au cas où ce code tournerait un jour sur une plateforme serverless.
export const maxDuration = 300;

export const MESSAGE_CONTRAT = "Le simulateur a été mis à jour : rechargez la page, votre photo est conservée.";

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

type Corps = {
  asynchrone?: unknown;
  parcoursId?: unknown;
  projet?: unknown;
  selections?: unknown;
  sig?: unknown;
  exp?: unknown;
  photo_base64?: unknown;
  page?: unknown;
  source?: unknown;
  campagne?: unknown;
  /** Ancien corps asynchrone (site d'avant la partie 4) : prompt et adresses signés, références libres. */
  prompt?: unknown;
  swatchUrls?: unknown;
  references?: unknown;
};

const texte = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

/** La demande relue et vérifiée, prête à devenir un travail. */
type Demande = { references: ReferenceSimulee[]; zones: { zone: IdZone; ref: string }[]; prompt: string | null; swatchUrls: string[] };
type Refus = { status: number; raison: string; message: string; zones?: IdZone[] };

async function lireContratSelections(body: Corps, secret: string, parcoursId: string, exp: number, sig: string): Promise<Demande | Refus> {
  const selections = lireSelectionsCorps(body.selections);
  if (!selections) return { status: 400, raison: "bad-request", message: "Sélections illisibles : rechargez la page." };
  const projet = typeof body.projet === "string" ? body.projet : "";
  if (!signatureValide(secret, sig, signatureSelections(secret, { parcoursId, projet, selections, exp }))) {
    console.error("[simulate] signature invalide (sélections)");
    return { status: 401, raison: "bad-signature", message: "Signature invalide." };
  }
  const lecture = await resoudreSelections(projet, selections);
  if (!lecture.ok) return { status: lecture.status, raison: lecture.raison, message: lecture.message };
  return { references: lecture.references, zones: lecture.zones, prompt: null, swatchUrls: [] };
}

/** Ancien corps asynchrone (prompt signé) : gardé le temps que le site de la partie 4 soit déployé. */
async function lireContratPrompt(body: Corps, secret: string, parcoursId: string, exp: number, sig: string): Promise<Demande | Refus> {
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const swatchUrls = Array.isArray(body.swatchUrls) ? body.swatchUrls.filter((u): u is string => typeof u === "string") : [];
  const attendue = crypto.createHmac("sha256", secret).update(`${prompt}\n${swatchUrls.join(",")}\n${exp}\np:${parcoursId}`).digest("hex");
  if (!signatureValide(secret, sig, attendue)) {
    console.error("[simulate] signature invalide (prompt)");
    return { status: 401, raison: "bad-signature", message: "Signature invalide." };
  }
  const references = Array.isArray(body.references)
    ? (body.references as unknown[]).filter((r): r is ReferenceSimulee => !!r && typeof r === "object" && typeof (r as ReferenceSimulee).ref === "string").slice(0, 5).map((r) => ({ zone: String(r.zone ?? ""), libelle: String(r.libelle ?? ""), ref: String(r.ref), nom: String(r.nom ?? "") }))
    : [];
  const zones = zonesDuTravail(references);
  if (zones.length > ZONES_MAX) return { status: 400, raison: "trop-de-zones", message: `Au plus ${ZONES_MAX} zones par simulation : retirez-en une, vous pourrez relancer une simulation ensuite.` };
  // Moteur V2 : les références (non signées) doivent correspondre aux échantillons signés.
  const reglages = await reglagesSimulateur().catch(() => null);
  if (reglages?.moteur === "V2" && references.length > 0 && !(await referencesCoherentes(references, swatchUrls))) {
    return { status: 400, raison: "references", message: "Les références choisies ne correspondent pas à la demande signée : relancez la simulation." };
  }
  return { references, zones, prompt, swatchUrls };
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

  let body: Corps;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide.", reason: "bad-request" }, { status: 400, headers: cors });
  }
  // Le contrat synchrone (site d'avant la mission 15) n'existe plus : une page restée ouverte recharge.
  if (body.asynchrone !== true) return NextResponse.json({ error: MESSAGE_CONTRAT, reason: "contrat" }, { status: 400, headers: cors });

  const parcoursId = parcoursIdValide(body.parcoursId);
  if (!parcoursId) return NextResponse.json({ error: "Identifiant de parcours manquant : rechargez la page.", reason: "parcours" }, { status: 400, headers: cors });
  const sig = typeof body.sig === "string" ? body.sig : "";
  const exp = typeof body.exp === "number" ? body.exp : Number.NaN;
  const photo_base64 = typeof body.photo_base64 === "string" ? body.photo_base64 : "";
  if (!sig || !Number.isFinite(exp) || !photo_base64) return NextResponse.json({ error: "Paramètres manquants.", reason: "bad-request" }, { status: 400, headers: cors });

  // 1) Expiration de la signature.
  if (Date.now() > exp) return NextResponse.json({ error: "Session expirée, relancez la simulation.", reason: "expired" }, { status: 401, headers: cors });

  // 2) Signature, puis relecture des sélections (nouveau contrat) ou du prompt signé (ancien corps asynchrone).
  const demande = Array.isArray(body.selections) ? await lireContratSelections(body, secret, parcoursId, exp, sig) : typeof body.prompt === "string" ? await lireContratPrompt(body, secret, parcoursId, exp, sig) : ({ status: 400, raison: "bad-request", message: "Paramètres manquants." } satisfies Refus);
  if ("status" in demande) return NextResponse.json({ error: demande.message, reason: demande.raison }, { status: demande.status, headers: cors });

  // 3) Une zone choisie que l'analyse connue de la photo ne voit pas : dit avant de dépenser (jamais à l'aveugle).
  if (demande.zones.length > 0) {
    const nonVisibles = await zonesNonVisiblesPourPhoto(photo_base64, demande.zones.map((z) => z.zone)).catch(() => []);
    if (nonVisibles.length > 0) {
      const libelles = nonVisibles.map((z) => ZONES_SIMULATEUR[z].libelle);
      return NextResponse.json(
        { error: `${libelles.length > 1 ? "Ces zones ne sont pas visibles" : "Cette zone n'est pas visible"} sur votre photo : ${libelles.join(", ")}. Retirez-${libelles.length > 1 ? "les" : "la"}, ou reprenez une photo où ${libelles.length > 1 ? "elles apparaissent" : "elle apparaît"}.`, reason: "zone-non-visible", zones: nonVisibles },
        { status: 409, headers: cors }
      );
    }
  }

  // 4) Limite quotidienne par IP et globale — APRÈS la signature : une requête forgée ne consomme rien.
  const ip = ipDuVisiteurSimulateur(req.headers);
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

  // 5) Le travail est créé, la tâche mise en file, la réponse part tout de suite.
  try {
    const { travailId, attenteEstimeeS } = await creerTravailSimulation({
      parcoursId,
      projet: typeof body.projet === "string" ? body.projet : "cuisine",
      references: demande.references,
      prompt: demande.prompt,
      swatchUrls: demande.swatchUrls,
      photoBase64: photo_base64,
      page: texte(body.page, 200),
      source: texte(body.source, 120),
      campagne: texte(body.campagne, 120),
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
