import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { fetchMetaLead, sendConversionEvent } from "@/lib/meta";
import { Resend } from "resend";

// ============================================================================
// GET — Vérification webhook Meta (hub.challenge)
// Meta envoie GET ?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=XXX
// ============================================================================
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_VERIFY_TOKEN || process.env.WEBHOOK_SECRET;

  if (mode === "subscribe" && token === verifyToken && challenge) {
    console.log("[meta-webhook] Vérification réussie");
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Vérification échouée" }, { status: 403 });
}

// ============================================================================
// POST — Réception des leads Meta Lead Ads
// Meta envoie: { object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id, ... } }] }] }
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Meta envoie toujours { object: "page", entry: [...] }
    if (body.object !== "page" || !body.entry) {
      return NextResponse.json({ error: "Format non reconnu" }, { status: 400 });
    }

    const results: { leadgenId: string; leadId: string; success: boolean }[] = [];

    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;

        const leadgenId = change.value?.leadgen_id;
        const formId = change.value?.form_id;
        const pageId = change.value?.page_id;

        if (!leadgenId) continue;

        // Fetch les données réelles du lead via Graph API
        const metaLead = await fetchMetaLead(leadgenId);
        if (!metaLead) {
          console.error(`[meta-webhook] Impossible de récupérer lead ${leadgenId}`);
          results.push({ leadgenId, leadId: "", success: false });
          continue;
        }

        // Dedup par téléphone/email
        const normalizedPhone = (metaLead.telephone || "").replace(/\D/g, "");
        let existing = null;
        if (normalizedPhone || metaLead.email) {
          const candidates = await prisma.lead.findMany({
            where: {
              OR: [
                normalizedPhone ? { telephone: { contains: normalizedPhone.slice(-9) } } : undefined,
                metaLead.email ? { email: metaLead.email } : undefined,
              ].filter(Boolean) as Record<string, unknown>[],
            },
          });
          existing = candidates[0] || null;
        }

        let lead;
        if (existing) {
          // Enrichir le lead existant
          const updates: Record<string, unknown> = {};
          if (!existing.email && metaLead.email) updates.email = metaLead.email;
          if (existing.ville === "Non renseignée" && metaLead.ville) updates.ville = metaLead.ville;
          if (Object.keys(updates).length > 0) {
            lead = await prisma.lead.update({ where: { id: existing.id }, data: updates });
          } else {
            lead = existing;
          }
        } else {
          // Scoring automatique
          let score = 15; // META_ADS base
          const hour = new Date().getHours();
          if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;
          if (metaLead.email) score += 5;
          if (metaLead.telephone) score += 5;
          score += 25; // CUISINE par défaut

          // Date réelle : celle fournie par Meta (submission), sinon now
          const realCreatedAt = metaLead.createdTime || new Date();

          lead = await prisma.lead.create({
            data: {
              prenom: metaLead.prenom,
              nom: metaLead.nom,
              telephone: metaLead.telephone,
              email: metaLead.email,
              ville: metaLead.ville || "Non renseignée",
              source: "META_ADS",
              typeProjet: "CUISINE",
              scoreSignature: Math.min(score, 100),
              createdAt: realCreatedAt,
              updatedAt: realCreatedAt,
              notes: [
                metaLead.formName ? `Form: ${metaLead.formName}` : null,
                formId ? `FormID: ${formId}` : null,
                pageId ? `PageID: ${pageId}` : null,
                `LeadgenID: ${leadgenId}`,
              ].filter(Boolean).join(" | ") || undefined,
            },
          });
        }

        // Interaction
        await prisma.interaction.create({
          data: {
            type: "NOTE",
            contenu: `Lead Meta Ads reçu${metaLead.formName ? ` (${metaLead.formName})` : ""} — leadgen_id: ${leadgenId}`,
            leadId: lead.id,
          },
        });

        // Conversion API — signaler le lead à Meta pour l'optimisation
        await sendConversionEvent({
          eventName: "Lead",
          email: metaLead.email,
          phone: metaLead.telephone,
          firstName: metaLead.prenom,
          lastName: metaLead.nom,
          city: metaLead.ville,
          eventId: `lead-${lead.id}`,
        });

        // Notification email au gérant pour chaque nouveau lead
        if (!existing) {
          try {
            const resend = new Resend(process.env.RESEND_API_KEY);
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr";
            await resend.emails.send({
              from: process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>",
              to: process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr",
              subject: `🔔 Nouveau lead Meta — ${metaLead.prenom} ${metaLead.nom}`,
              html: `
                <h2>Nouveau lead reçu via Meta Ads</h2>
                <table style="border-collapse:collapse;font-family:sans-serif;">
                  <tr><td style="padding:4px 12px;font-weight:bold;">Nom</td><td>${metaLead.prenom} ${metaLead.nom}</td></tr>
                  <tr><td style="padding:4px 12px;font-weight:bold;">Téléphone</td><td>${metaLead.telephone || "—"}</td></tr>
                  <tr><td style="padding:4px 12px;font-weight:bold;">Email</td><td>${metaLead.email || "—"}</td></tr>
                  <tr><td style="padding:4px 12px;font-weight:bold;">Ville</td><td>${metaLead.ville || "—"}</td></tr>
                  ${metaLead.formName ? `<tr><td style="padding:4px 12px;font-weight:bold;">Formulaire</td><td>${metaLead.formName}</td></tr>` : ""}
                </table>
                <br/>
                <a href="${appUrl}/leads/${lead.id}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Voir dans le CRM</a>
              `,
            });
          } catch (emailErr) {
            console.error("[meta-webhook] Erreur notification email:", emailErr);
            // Non bloquant — le lead est déjà créé
          }
        }

        results.push({ leadgenId, leadId: lead.id, success: true });
      }
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return NextResponse.json({ success: true, results }, { status: 200 });
  } catch (error) {
    console.error("[meta-webhook] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

// CORS pour Meta
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
