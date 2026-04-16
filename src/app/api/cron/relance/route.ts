import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Resend } from "resend";
import { emailRelanceDevisTemplate } from "@/lib/gmail";
import { revalidatePath } from "next/cache";

// ============================================================================
// GET /api/cron/relance — Auto-relance des devis ENVOYE depuis plus de 3 jours
// Appelable par Railway cron, Vercel cron, ou manuellement.
// Sécurisé par CRON_SECRET en header Authorization.
// ============================================================================
export async function GET(request: NextRequest) {
  // Sécurité : vérifier le token (optionnel en dev)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Trouver les devis ENVOYE depuis > 3 jours, pas encore relancés
    const devisARelancer = await prisma.devis.findMany({
      where: {
        statut: "ENVOYE",
        updatedAt: { lt: threeDaysAgo },
        lead: {
          statut: "DEVIS_ENVOYE", // pas déjà signé/perdu
          email: { not: null },
        },
      },
      include: { lead: true },
    });

    // Vérifier qu'on n'a pas déjà relancé récemment (dans les 5 derniers jours)
    const results: { devisId: string; leadId: string; sent: boolean; reason?: string }[] = [];

    for (const devis of devisARelancer) {
      // Vérifier si une relance a déjà été envoyée dans les 5 derniers jours
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const recentRelance = await prisma.interaction.findFirst({
        where: {
          leadId: devis.leadId,
          type: "EMAIL",
          contenu: { contains: "Relance auto" },
          createdAt: { gt: fiveDaysAgo },
        },
      });

      if (recentRelance) {
        results.push({ devisId: devis.id, leadId: devis.leadId, sent: false, reason: "Relance récente déjà envoyée" });
        continue;
      }

      if (!devis.lead.email) {
        results.push({ devisId: devis.id, leadId: devis.leadId, sent: false, reason: "Pas d'email" });
        continue;
      }

      const { subject, body } = emailRelanceDevisTemplate({
        prenomClient: devis.lead.prenom,
        numero: devis.reference || devis.id.slice(-6),
      });

      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || "CoverSwap <noreply@coverswap.fr>",
          to: devis.lead.email,
          subject,
          html: body.replace(/\n/g, "<br/>"),
        });

        // Logger l'interaction
        await prisma.interaction.create({
          data: {
            type: "EMAIL",
            contenu: `Relance auto — devis ${devis.reference || devis.id.slice(-6)} envoyée à ${devis.lead.email}`,
            leadId: devis.leadId,
          },
        });

        results.push({ devisId: devis.id, leadId: devis.leadId, sent: true });
      } catch (emailErr) {
        console.error(`[cron/relance] Erreur envoi pour devis ${devis.id}:`, emailErr);
        results.push({ devisId: devis.id, leadId: devis.leadId, sent: false, reason: "Erreur envoi" });
      }
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return NextResponse.json({
      success: true,
      total: devisARelancer.length,
      sent: results.filter((r) => r.sent).length,
      results,
    });
  } catch (error) {
    console.error("[cron/relance] Erreur:", error);
    return NextResponse.json(
      { error: "Erreur serveur", message: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
