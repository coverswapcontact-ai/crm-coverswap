import { NextRequest, NextResponse } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/dossiers/api";
import { chargerDetail, modifierDossier, schemaModification } from "@/lib/dossiers/dossiers";
import { completerDetail } from "@/lib/dossiers/situation";

// Mission 22 (A3) : le détail lu porte aussi `espace` (l'état de l'espace client) et `taches` (les tâches du dossier,
// Aujourd'hui puis Plus tard) — ajout de champs, le reste inchangé.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await completerDetail(await chargerDetail(id)));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]");
  }
}

/** Coordonnées client, objet, source, montant estimé, prochaine action, date de chantier. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaModification, await lireCorpsJson(request));
    await modifierDossier(id, entree);
    return NextResponse.json(await chargerDetail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/dossiers/[id]");
  }
}
