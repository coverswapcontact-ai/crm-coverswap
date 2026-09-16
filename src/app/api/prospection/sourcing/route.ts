import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { sourceProspects } from "@/lib/prospection/sourcing";
import { AGENT_SLUGS } from "@/lib/prospection/constants";

const sourcingSchema = z.object({
  agentSlug: z.enum(AGENT_SLUGS),
  // Plafond optionnel de nouveaux prospects pour cette exécution (défaut 60)
  maxNouveaux: z.number().int().min(1).max(200).optional(),
});

// POST /api/prospection/sourcing { agentSlug } → ResultatSourcing
// Exécution longue (15 villes × pagination + avis, throttle 200ms) : ~30-90s.
export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = sourcingSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Requête invalide : { agentSlug: "hotels" | "restaurants" } attendu' },
        { status: 400 }
      );
    }

    const resultat = await sourceProspects(parsed.data.agentSlug, {
      maxNouveaux: parsed.data.maxNouveaux,
    });
    return NextResponse.json(resultat);
  } catch (error) {
    console.error("[api/prospection/sourcing]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur lors du sourcing" },
      { status: 500 }
    );
  }
}
