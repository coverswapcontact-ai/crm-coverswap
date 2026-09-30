import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { repondreTache, schemaReponse } from "@/lib/a-faire/reponses";
import { idDeTache } from "../../parametres";

export const dynamic = "force-dynamic";

/**
 * POST /api/a-faire/<id>/reponse { reponse: FAIT | PLUS_TARD | PAS_A_FAIRE, quand?, date?, raison?, texte?, motifPerte?,
 * precisionPerte? } : la réponse de Lucas. Rend la tâche à jour, l'effet programmé sur la source (parti dans 6 s :
 * « Annuler » l'arrête encore) et la règle proposée s'il y en a une. 409 si la tâche est déjà close, ou pour « Fait »
 * sur une validation sensible (elle passe par « À valider »).
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idDeTache((await params).id);
    const entree = analyser(schemaReponse, await lireCorpsJson(requete));
    const resultat = await repondreTache(
      id,
      {
        reponse: entree.reponse,
        quand: entree.quand ?? undefined,
        date: entree.date ?? undefined,
        raison: entree.raison ?? undefined,
        texte: entree.texte ?? undefined,
        motifPerte: entree.motifPerte ?? undefined,
        precisionPerte: entree.precisionPerte ?? undefined,
      },
      new Date()
    );
    return NextResponse.json({ ...resultat, annulable: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/[id]/reponse");
  }
}
