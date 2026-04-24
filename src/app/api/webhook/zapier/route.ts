import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { sendConversionEvent } from "@/lib/meta";
import { Resend } from "resend";

// ============================================================================
// WEBHOOK — Zapier bridge pour leads Meta Ads
// ============================================================================
// Tant que l'app CoverSwap CRM n'a pas l'Advanced Access à `leads_retrieval`,
// on passe par Zapier qui reçoit le lead Meta puis POST ici.
//
// Config Zapier (action "Webhooks by Zapier" → POST) :
//   URL         : https://crm.coverswap.fr/api/webhook/zapier?secret=WEBHOOK_SECRET
//   Method      : POST
//   Data Pass-Through : No
//   Data        : clés ci-dessous mappées depuis le trigger Facebook Lead Ads
//
// Champs attendus (tous optionnels sauf au moins un identifiant) :
//   first_name, last_name, full_name
//   phone_number (ou phone, telephone)
//   email
//   city (ou ville)
//   form_name, form_id, page_id, leadgen_id
//   created_time (ISO8601 ; sinon now())
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const expected = process.env.WEBHOOK_SECRET || process.env.META_VERIFY_TOKEN;

    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "Non autorise" }, { status: 403 });
    }

    const body = await request.json();

    // Parse prénom / nom — full_name en priorité (cohérent avec meta webhook)
    let prenom = "Inconnu";
    let nom = "Inconnu";
    if (body.full_name) {
      const parts = String(body.full_name).trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        prenom = parts[0];
        nom = parts[0];
      } else if (parts.length >= 2) {
        prenom = parts[0];
        nom = parts.slice(1).join(" ");
      }
    } else {
      prenom = body.first_name || body.prenom || "Inconnu";
      nom = body.last_name || body.nom || "Inconnu";
    }

    const telephone = String(body.phone_number || body.phone || body.telephone || "");
    const email: string | undefined = body.email || undefined;
    const ville: string | undefined = body.city || body.ville || undefined;
    const formName: string | undefined = body.form_name || undefined;
    const leadgenId: string | undefined = body.leadgen_id || body.lead_id || undefined;
    const formId: string | undefined = body.form_id || undefined;
    const pageId: string | undefined = body.page_id || undefined;

    // Date réelle de soumission (fournie par Zapier/Meta), sinon now
    let realCreatedAt = new Date();
    if (body.created_time) {
      const d = new Date(body.created_time);
      if (!isNaN(d.getTime())) realCreatedAt = d;
    }

    // Dedup par téléphone (9 derniers chiffres) ou email
    const normalizedPhone = telephone.replace(/\D/g, "");
    let existing = null;
    if (normalizedPhone || email) {
      const candidates = await prisma.lead.findMany({
        where: {
          OR: [
            normalizedPhone ? { telephone: { contains: normalizedPhone.slice(-9) } } : undefined,
            email ? { email } : undefined,
          ].filter(Boolean) as Record<string, unknown>[],
        },
      });
      existing = candidates[0] || null;
    }

    let lead;
    if (existing) {
      const updates: Record<string, unknown> = {};
      if (!existing.email && email) updates.email = email;
      if (existing.ville === "Non renseignée" && ville) updates.ville = ville;
      if (Object.keys(updates).length > 0) {
        lead = await prisma.lead.update({ where: { id: existing.id }, data: updates });
      } else {
        lead = existing;
      }
    } else {
      // Scoring (identique au webhook meta direct)
      let score = 15; // META_ADS base
      const hour = new Date().getHours();
      if ((hour >= 9 && hour <= 12) || (hour >= 14 && hour <= 18)) score += 10;
      if (email) score += 5;
      if (telephone) score += 5;
      score += 25; // CUISINE par défaut

      lead = await prisma.lead.create({
        data: {
          prenom,
          nom,
          telephone: telephone || "",
          email,
          ville: ville || "Non renseignée",
          source: "META_ADS",
          typeProjet: "CUISINE",
          scoreSignature: Math.min(score, 100),
          createdAt: realCreatedAt,
          updatedAt: realCreatedAt,
          notes:
            [
              formName ? `Form: ${formName}` : null,
              formId ? `FormID: ${formId}` : null,
              pageId ? `PageID: ${pageId}` : null,
              leadgenId ? `LeadgenID: ${leadgenId}` : null,
              `Via: Zapier`,
            ]
              .filter(Boolean)
              .join(" | ") || undefined,
        },
      });
    }

    // Interaction (trace)
    await prisma.interaction.create({
      data: {
        type: "NOTE",
        contenu: `Lead Meta Ads via Zapier${formName ? ` (${formName})` : ""}${
          leadgenId ? ` — leadgen_id: ${leadgenId}` : ""
        }`,
        leadId: lead.id,
      },
    });

    // Conversion API — remonter le Lead à Meta pour l'optimisation
    await sendConversionEvent({
      eventName: "Lead",
      email,
      phone: telephone,
      firstName: prenom,
      lastName: nom,
      city: ville,
      eventId: `lead-${lead.id}`,
    });

    // Notification mail au gérant (nouveaux leads seulement)
    if (!existing) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr";
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>",
          to: process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr",
          subject: `🔔 Nouveau lead Meta — ${prenom} ${nom}`,
          html: `
            <h2>Nouveau lead reçu via Meta Ads (bridge Zapier)</h2>
            <table style="border-collapse:collapse;font-family:sans-serif;">
              <tr><td style="padding:4px 12px;font-weight:bold;">Nom</td><td>${prenom} ${nom}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Téléphone</td><td>${telephone || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Email</td><td>${email || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Ville</td><td>${ville || "—"}</td></tr>
              ${formName ? `<tr><td style="padding:4px 12px;font-weight:bold;">Formulaire</td><td>${formName}</td></tr>` : ""}
            </table>
            <br/>
            <a href="${appUrl}/leads/${lead.id}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Voir dans le CRM</a>
          `,
        });
      } catch (emailErr) {
        console.error("[zapier-webhook] Erreur notification email:", emailErr);
        // non bloquant
      }
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        created: !existing,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[zapier-webhook] Erreur:", error);
    return NextResponse.json(
      {
        error: "Erreur serveur",
        message: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 }
    );
  }
}

// GET = healthcheck pour Zapier ("Test Request" pendant la config)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expected = process.env.WEBHOOK_SECRET || process.env.META_VERIFY_TOKEN;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    endpoint: "zapier-webhook",
    message: "Prêt à recevoir des leads depuis Zapier",
  });
}

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
