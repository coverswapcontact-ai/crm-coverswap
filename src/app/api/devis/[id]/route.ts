import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { z } from "zod/v4";
import { sendConversionEvent, devisStatutToConversion } from "@/lib/meta";

const updateDevisSchema = z.object({
  statut: z.string().optional(),
  reference: z.string().optional(),
  nomReference: z.string().optional(),
  gamme: z.string().optional(),
  complexite: z.number().int().min(1).max(3).optional(),
  mlTotal: z.number().positive().optional(),
  fraisDeplacement: z.number().min(0).optional(),
  objet: z.string().optional(),
  lignesAdditionnelles: z.string().optional(), // JSON string
  notesInternes: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  // Champs recalculés côté serveur si fournis
  prixVenteHTml: z.number().optional(),
  prixMatiere: z.number().optional(),
  prixVente: z.number().optional(),
  margeNette: z.number().optional(),
  acompte30: z.number().optional(),
  solde70: z.number().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const devis = await prisma.devis.findUnique({
      where: { id },
      include: { lead: true, facture: true },
    });

    if (!devis) {
      return NextResponse.json({ error: "Devis non trouve" }, { status: 404 });
    }

    return NextResponse.json(devis);
  } catch (error) {
    console.error("GET /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recuperation du devis" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateDevisSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Donnees invalides", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = { ...parsed.data };
    if (data.expiresAt) {
      data.expiresAt = new Date(data.expiresAt as string);
    }

    // Lire l'état actuel pour détecter les transitions
    const before = await prisma.devis.findUnique({
      where: { id },
      include: { facture: true, lead: true },
    });
    if (!before) {
      return NextResponse.json({ error: "Devis non trouvé" }, { status: 404 });
    }

    const devis = await prisma.devis.update({
      where: { id },
      data,
      include: { lead: true, facture: true },
    });

    // -----------------------------------------------------------------------
    // Sync automatique du statut du Lead en fonction du statut du Devis
    // -----------------------------------------------------------------------
    if (parsed.data.statut && parsed.data.statut !== before.statut) {
      const newDevisStatut = parsed.data.statut;
      const leadStatutMap: Record<string, string> = {
        BROUILLON: "CONTACTE",
        ENVOYE: "DEVIS_ENVOYE",
        SIGNE: "SIGNE",
        REFUSE: "PERDU",
      };
      const targetLeadStatut = leadStatutMap[newDevisStatut];
      // Ne pas écraser un statut déjà plus avancé (CHANTIER_PLANIFIE, TERMINE)
      const advanced = ["CHANTIER_PLANIFIE", "TERMINE"];
      if (
        targetLeadStatut &&
        !advanced.includes(devis.lead.statut) &&
        devis.lead.statut !== targetLeadStatut
      ) {
        await prisma.lead.update({
          where: { id: devis.leadId },
          data: { statut: targetLeadStatut },
        });
      }
    }

    // -----------------------------------------------------------------------
    // Transition vers SIGNE → créer la facture si pas déjà existante
    // (ou la "ressusciter" si elle était ANNULEE)
    // -----------------------------------------------------------------------
    if (parsed.data.statut === "SIGNE" && before.statut !== "SIGNE") {
      if (devis.facture) {
        // Réactiver une facture annulée
        if (devis.facture.statut === "ANNULEE") {
          await prisma.facture.update({
            where: { id: devis.facture.id },
            data: { statut: "ACOMPTE_EN_ATTENTE" },
          });
        }
      } else {
        await prisma.$transaction(async (tx) => {
          const year = new Date().getFullYear();
          const lastFacture = await tx.facture.findFirst({
            orderBy: { numero: "desc" },
            where: { numero: { startsWith: `FACT-${year}` } },
          });
          const num = lastFacture
            ? parseInt(lastFacture.numero.split("-").pop()!) + 1
            : 1;
          const numero = `FACT-${year}-${String(num).padStart(4, "0")}`;
          await tx.facture.create({
            data: {
              numero,
              montantTotal: devis.prixVente,
              devisId: devis.id,
            },
          });
        });
      }
      revalidatePath("/factures");
    }

    // -----------------------------------------------------------------------
    // Annulation d'un devis SIGNE → marquer la facture comme ANNULEE
    // (réversibilité totale, pas de suppression)
    // -----------------------------------------------------------------------
    if (
      before.statut === "SIGNE" &&
      parsed.data.statut &&
      parsed.data.statut !== "SIGNE" &&
      devis.facture &&
      devis.facture.statut !== "ANNULEE"
    ) {
      await prisma.facture.update({
        where: { id: devis.facture.id },
        data: { statut: "ANNULEE" },
      });
      revalidatePath("/factures");
    }

    // -----------------------------------------------------------------------
    // Meta Conversions API — remonter l'événement pour optimiser les pubs
    // (non bloquant, fire-and-forget)
    // -----------------------------------------------------------------------
    if (parsed.data.statut && parsed.data.statut !== before.statut) {
      const conv = devisStatutToConversion(parsed.data.statut);
      if (conv) {
        sendConversionEvent({
          eventName: conv.eventName,
          email: devis.lead.email || undefined,
          phone: devis.lead.telephone || undefined,
          firstName: devis.lead.prenom,
          lastName: devis.lead.nom,
          city: devis.lead.ville || undefined,
          value: parsed.data.statut === "SIGNE" ? devis.prixVente : undefined,
          eventId: `devis-${devis.id}-${parsed.data.statut}`,
        }).catch(() => {}); // jamais bloquant
      }
    }

    // Recharger pour refléter changements facture/lead
    const fresh = await prisma.devis.findUnique({
      where: { id },
      include: { lead: true, facture: true },
    });

    revalidatePath("/devis");
    revalidatePath(`/devis/${id}`);
    revalidatePath("/leads");
    revalidatePath(`/leads/${devis.leadId}`);
    return NextResponse.json(fresh);
  } catch (error) {
    console.error("PUT /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise a jour du devis" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await prisma.devis.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/devis/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression du devis" },
      { status: 500 }
    );
  }
}
