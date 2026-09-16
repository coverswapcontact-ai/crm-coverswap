import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { schemaCreationDepense } from "@/lib/depenses/constantes";
import { creerDepense, listerDepenses } from "@/lib/depenses/service";
import { anneeDemandee } from "@/lib/finances/annee";

export const dynamic = "force-dynamic";

/** GET : dépenses de l'année, totaux par catégorie, dépenses à rattacher. */
export async function GET(requete: NextRequest) {
  try {
    return NextResponse.json(await listerDepenses(anneeDemandee(requete.nextUrl.searchParams)));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/depenses");
  }
}

/** POST (multipart) : champ `donnees` (JSON) et, facultatif, `justificatif` (photo ou PDF). */
export async function POST(requete: NextRequest) {
  try {
    const formulaire = await lireFormulaire(requete);
    let donnees: unknown;
    try {
      donnees = JSON.parse(texteFormulaire(formulaire, "donnees"));
    } catch {
      throw new ErreurMetier("Dépense illisible : renvoie la saisie.", 400);
    }
    const justificatif = formulaire.get("justificatif");
    const { depense, dejaRecue } = await creerDepense(
      analyser(schemaCreationDepense, donnees),
      justificatif instanceof File && justificatif.size > 0 ? justificatif : null
    );
    return NextResponse.json({ depense, dejaRecue }, { status: dejaRecue ? 200 : 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/depenses");
  }
}
