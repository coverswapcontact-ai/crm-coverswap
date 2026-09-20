import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerEntrant, modifierEntrant, schemaModificationEntrant } from "@/lib/prospects/entrants";
import { marquerFicheVue } from "@/lib/meta/leads";

export const dynamic = "force-dynamic";

export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entrant = await chargerEntrant(id);
    // La fiche est ouverte : plus de relance « lead non traité » pour celle-ci.
    await marquerFicheVue(id);
    return NextResponse.json({ entrant });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/prospects/entrants/[id]");
  }
}

/** PATCH : coordonnées, type de projet, notes, statut (avec motif pour « Sans suite »). */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const avertissements = await modifierEntrant(id, analyser(schemaModificationEntrant, await lireCorpsJson(requete)));
    return NextResponse.json({ entrant: await chargerEntrant(id), avertissements });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/prospects/entrants/[id]");
  }
}
