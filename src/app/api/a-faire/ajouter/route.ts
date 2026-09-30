import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ajouterTache, schemaAjout } from "@/lib/a-faire/reponses";

export const dynamic = "force-dynamic";

/** POST /api/a-faire/ajouter { titre, echeance?, leadId?, dossierId?, clientId?, raison? } : une tâche à moi. Rend la tâche. */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaAjout, await lireCorpsJson(requete));
    const tache = await ajouterTache(
      { titre: entree.titre, echeance: entree.echeance ?? null, leadId: entree.leadId ?? null, dossierId: entree.dossierId ?? null, clientId: entree.clientId ?? null, raison: entree.raison ?? null, condition: entree.condition ?? null },
      new Date()
    );
    return NextResponse.json({ tache }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/ajouter");
  }
}
