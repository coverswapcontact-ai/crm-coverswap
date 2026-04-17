import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { promises as fs } from "fs";
import path from "path";
import { resolveUploadsDir } from "@/lib/uploads";
import { Resend } from "resend";

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
  // Simulation images (base64 data URLs or raw base64)
  imageBefore: z.string().optional(),
  imageAfter: z.string().optional(),
  imageOriginal: z.string().optional(),
});

function normalizeData(body: z.infer<typeof webhookSchema>) {
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
  const sourceScores: Record<string, number> = {
    META_ADS: 15, TIKTOK: 10, INSTAGRAM: 15,
    ORGANIQUE: 25, REFERENCE: 40, AUTRE: 10,
    SITE_SIMULATEUR: 30, SITE_DEVIS: 45, SITE_CONTACT: 35,
  };
  score += sourceScores[data.source] || 10;

  const hour = new Date().getHours();
  if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;

  const nearMontpellier = ["montpellier", "lattes", "perols", "castelnau", "mauguio", "palavas", "grabels", "juvignac", "saint-jean-de-vedas", "villeneuve-les-maguelone"];
  const majorCities = ["nimes", "beziers", "sete", "perpignan", "narbonne", "ales", "lunel"];
  const cityLower = data.ville.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (nearMontpellier.some(c => cityLower.includes(c))) score += 20;
  else if (majorCities.some(c => cityLower.includes(c))) score += 10;

  const projectScores: Record<string, number> = {
    CUISINE: 25, SDB: 20, MEUBLES: 15, PRO: 20, AUTRE: 10,
  };
  score += projectScores[data.typeProjet] || 10;

  if (data.email) score += 5;
  if (data.telephone && data.telephone.length >= 10) score += 5;

  return Math.min(score, 100);
}

// Normalize phone for dedup comparison: keep only digits, strip leading 0/33
function normalizePhone(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length === 11) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

async function findExistingLead(telephone: string, email?: string) {
  const normalized = normalizePhone(telephone);
  const candidates = await prisma.lead.findMany({
    where: {
      OR: [
        telephone ? { telephone } : undefined,
        email ? { email } : undefined,
      ].filter(Boolean) as { telephone?: string; email?: string }[],
    },
    orderBy: { createdAt: "desc" },
  });
  // Refine by normalized phone (covers spaces, + prefix, etc.)
  const match = candidates.find((l) => {
    if (email && l.email && l.email.toLowerCase() === email.toLowerCase()) return true;
    if (normalized && normalizePhone(l.telephone) === normalized) return true;
    return false;
  });
  return match || null;
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB décodés (pour garder la photo originale full size)

// Strip data URL prefix and write base64 to file. Returns relative path.
// Ne throw JAMAIS — retourne null en cas d'échec (lead/simulation restent OK).
async function saveBase64Image(
  base64: string,
  leadId: string,
  simulationId: string,
  filename: string
): Promise<string | null> {
  try {
    if (!base64 || typeof base64 !== "string") return null;
    const m = base64.match(/^data:([^;]+);base64,(.+)$/);
    const raw = m ? m[2] : base64;
    // Vérif taille avant décode
    const approxBytes = Math.floor((raw.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      console.warn(`[webhook] Image trop grosse (${Math.round(approxBytes / 1024)}KB), ignorée`);
      return null;
    }
    const buf = Buffer.from(raw, "base64");
    const baseDir = resolveUploadsDir();
    const dir = path.join(baseDir, leadId, simulationId);
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.writeFile(full, buf);
    return `${leadId}/${simulationId}/${filename}`;
  } catch (err) {
    // Ne jamais casser le webhook pour un échec d'écriture image
    console.error("[webhook] Échec sauvegarde image (non bloquant):", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "Trop de requêtes. Réessayez dans 1 minute." }, { status: 429 });
    }

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

    if (!data.nom || (data.nom === "Inconnu" && !data.telephone)) {
      return NextResponse.json({ error: "Nom ou téléphone requis au minimum" }, { status: 400 });
    }

    // ── DEDUP: existing lead by phone OR email? ──
    const existing = await findExistingLead(data.telephone, data.email);

    let lead;
    let isNew = false;
    if (existing) {
      lead = existing;
      // Enrichissement: met à jour les champs manquants si le nouveau payload les a
      const updates: Record<string, unknown> = {};
      if (!existing.email && data.email) updates.email = data.email;
      if (existing.ville === "Non renseignée" && data.ville !== "Non renseignée") updates.ville = data.ville;
      if (!existing.codePostal && data.codePostal) updates.codePostal = data.codePostal;
      if (!existing.referenceChoisie && data.referenceChoisie) updates.referenceChoisie = data.referenceChoisie;
      if (!existing.mlEstimes && data.mlEstimes) updates.mlEstimes = data.mlEstimes;
      if (!existing.prixDevis && data.prixDevis) updates.prixDevis = data.prixDevis;
      // Si le nouveau lead est un SITE_DEVIS, élever le statut
      if (data.source === "SITE_DEVIS" && existing.statut === "NOUVEAU") {
        updates.statut = "DEVIS_DEMANDE";
      }
      if (Object.keys(updates).length > 0) {
        lead = await prisma.lead.update({ where: { id: existing.id }, data: updates });
      }
    } else {
      isNew = true;
      const scoreSignature = calculateScore(data);
      lead = await prisma.lead.create({
        data: { ...data, scoreSignature },
      });
    }

    // ── Handle simulation (images + record) ──
    const hasImages = !!(parsed.data.imageBefore || parsed.data.imageAfter);
    const isSimulation = data.source === "SITE_SIMULATEUR" || hasImages;

    if (isSimulation) {
      const simulation = await prisma.simulation.create({
        data: {
          leadId: lead.id,
          source: data.source,
          referenceChoisie: data.referenceChoisie,
          mlEstimes: data.mlEstimes,
          prixDevis: data.prixDevis,
          lienSimulation: data.lienSimulation,
          notes: data.notes,
        },
      });

      const imageBeforePath = parsed.data.imageBefore
        ? await saveBase64Image(parsed.data.imageBefore, lead.id, simulation.id, "before.jpg")
        : null;
      const imageAfterPath = parsed.data.imageAfter
        ? await saveBase64Image(parsed.data.imageAfter, lead.id, simulation.id, "after.jpg")
        : null;
      const imageOriginalPath = parsed.data.imageOriginal
        ? await saveBase64Image(parsed.data.imageOriginal, lead.id, simulation.id, "original.jpg")
        : null;

      if (imageBeforePath || imageAfterPath || imageOriginalPath) {
        await prisma.simulation.update({
          where: { id: simulation.id },
          data: { imageBeforePath, imageAfterPath, imageOriginalPath },
        });
      }

      await prisma.interaction.create({
        data: {
          type: "NOTE",
          contenu: `Nouvelle simulation cuisine (${data.source})${data.referenceChoisie ? ` — réf. ${data.referenceChoisie}` : ""}${data.notes ? ` — ${data.notes}` : ""}`,
          leadId: lead.id,
        },
      });
    } else {
      const prefix = isNew ? "Lead reçu via webhook" : "Nouveau contact du client";
      await prisma.interaction.create({
        data: {
          type: "NOTE",
          contenu: `${prefix} (${data.source})${data.notes ? ` — ${data.notes}` : ""}`,
          leadId: lead.id,
        },
      });
    }

    // Notification email au gérant :
    // - tout NOUVEAU lead (peu importe la source)
    // - OU escalade d'un lead existant vers SITE_DEVIS (passage simu → devis)
    const escaladeDevis =
      !isNew &&
      data.source === "SITE_DEVIS" &&
      existing?.source !== "SITE_DEVIS";
    if (isNew || escaladeDevis) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr";
        const sourceLabel: Record<string, string> = {
          SITE_SIMULATEUR: "Simulation IA",
          SITE_DEVIS: "Demande de devis",
          SITE_CONTACT: "Formulaire contact",
          META_ADS: "Meta Ads",
        };
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "CoverSwap <noreply@coverswap.fr>",
          to: "contact@coverswap.fr",
          subject: escaladeDevis
            ? `🔥 Demande de devis — ${data.prenom} ${data.nom}`
            : `🔔 Nouveau lead ${sourceLabel[data.source] || data.source} — ${data.prenom} ${data.nom}`,
          html: `
            <h2>Nouveau lead reçu</h2>
            <table style="border-collapse:collapse;font-family:sans-serif;">
              <tr><td style="padding:4px 12px;font-weight:bold;">Nom</td><td>${data.prenom} ${data.nom}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Téléphone</td><td>${data.telephone || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Email</td><td>${data.email || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Ville</td><td>${data.ville || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Source</td><td>${sourceLabel[data.source] || data.source}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Projet</td><td>${data.typeProjet}</td></tr>
              ${data.referenceChoisie ? `<tr><td style="padding:4px 12px;font-weight:bold;">Référence</td><td>${data.referenceChoisie}</td></tr>` : ""}
            </table>
            <br/>
            <a href="${appUrl}/leads/${lead.id}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Voir dans le CRM</a>
          `,
        });
      } catch (emailErr) {
        console.error("[webhook] Erreur notification email:", emailErr);
      }
    }

    revalidatePath("/leads");
    revalidatePath(`/leads/${lead.id}`);
    revalidatePath("/dashboard");

    return NextResponse.json(
      { success: true, leadId: lead.id, deduped: !isNew },
      { status: 200 }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Erreur serveur", message: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}

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
