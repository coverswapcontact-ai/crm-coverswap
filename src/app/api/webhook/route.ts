import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";

// Rate limiting (in-memory, resets on cold start)
const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Accept both Meta/n8n format AND internal format
const webhookSchema = z.object({
  // Meta Lead Ads fields (via n8n)
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  form_name: z.string().optional(),
  ad_name: z.string().optional(),
  campaign_name: z.string().optional(),
  // Internal CoverSwap fields
  nom: z.string().optional(),
  prenom: z.string().optional(),
  telephone: z.string().optional(),
  ville: z.string().optional(),
  codePostal: z.string().optional(),
  source: z.string().optional(),
  typeProjet: z.string().optional(),
  referenceChoisie: z.string().optional(),
  mlEstimes: z.number().optional(),
  prixDevis: z.number().optional(),
  lienSimulation: z.string().optional(),
  notes: z.string().optional(),
});

function normalizeData(body: z.infer<typeof webhookSchema>) {
  // Detect Meta/n8n format
  const isMeta = !!(body.first_name || body.last_name || body.phone);

  const prenom = body.prenom || body.first_name || "Inconnu";
  const nom = body.nom || body.last_name || "Inconnu";
  const telephone = body.telephone || body.phone || "";
  const email = body.email || undefined;
  const ville = body.ville || body.city || "Non renseignée";
  const source = body.source || (isMeta ? "META_ADS" : "AUTRE");

  const metaNotes = [
    body.form_name ? `Formulaire: ${body.form_name}` : null,
    body.ad_name ? `Pub: ${body.ad_name}` : null,
    body.campaign_name ? `Campagne: ${body.campaign_name}` : null,
  ].filter(Boolean).join(" | ");

  const notes = body.notes || metaNotes || undefined;

  return {
    prenom, nom, telephone, email, ville,
    codePostal: body.codePostal,
    source,
    typeProjet: body.typeProjet || "CUISINE",
    referenceChoisie: body.referenceChoisie,
    prixDevis: body.prixDevis,
    mlEstimes: body.mlEstimes,
    lienSimulation: body.lienSimulation,
    notes,
  };
}

function calculateScore(data: ReturnType<typeof normalizeData>): number {
  let score = 0;

  // Source scoring
  const sourceScores: Record<string, number> = {
    META_ADS: 15, TIKTOK: 10, INSTAGRAM: 15,
    ORGANIQUE: 25, REFERENCE: 40, AUTRE: 10,
  };
  score += sourceScores[data.source] || 10;

  // Time scoring (9h-12h or 14h-18h = peak hours)
  const hour = new Date().getHours();
  if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;

  // City scoring (proximity to Montpellier)
  const nearMontpellier = ["montpellier", "lattes", "perols", "castelnau", "mauguio", "palavas", "grabels", "juvignac", "saint-jean-de-vedas", "villeneuve-les-maguelone"];
  const majorCities = ["nimes", "beziers", "sete", "perpignan", "narbonne", "ales", "lunel"];
  const cityLower = data.ville.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (nearMontpellier.some(c => cityLower.includes(c))) score += 20;
  else if (majorCities.some(c => cityLower.includes(c))) score += 10;

  // Project type scoring
  const projectScores: Record<string, number> = {
    CUISINE: 25, SDB: 20, MEUBLES: 15, PRO: 20, AUTRE: 10,
  };
  score += projectScores[data.typeProjet] || 10;

  // Contact info bonus
  if (data.email) score += 5;
  if (data.telephone && data.telephone.length >= 10) score += 5;

  return Math.min(score, 100);
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "Trop de requêtes. Réessayez dans 1 minute." }, { status: 429 });
    }

    // Auth check
    if (!process.env.WEBHOOK_SECRET) {
      console.error("WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Configuration serveur manquante" }, { status: 500 });
    }
    const secret = request.headers.get("x-webhook-secret") || request.headers.get("X-Webhook-Secret");
    if (secret !== process.env.WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides", details: parsed.error.issues }, { status: 400 });
    }

    const data = normalizeData(parsed.data);

    // Validate minimum required data
    if (!data.nom || data.nom === "Inconnu" && !data.telephone) {
      return NextResponse.json({ error: "Nom ou téléphone requis au minimum" }, { status: 400 });
    }

    const scoreSignature = calculateScore(data);

    const lead = await prisma.lead.create({
      data: { ...data, scoreSignature },
    });

    // Create initial interaction
    await prisma.interaction.create({
      data: {
        type: "NOTE",
        contenu: `Lead reçu via webhook (${data.source})${data.notes ? ` — ${data.notes}` : ""}`,
        leadId: lead.id,
      },
    });

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return NextResponse.json({ success: true, leadId: lead.id, score: scoreSignature }, { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Erreur serveur", message: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

// CORS preflight for n8n/testing tools
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret, x-webhook-secret",
    },
  });
}
