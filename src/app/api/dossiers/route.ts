import { NextRequest, NextResponse } from "next/server";
import { analyser, lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/dossiers/api";
import { creerDossier, listerDossiers, schemaCreation } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

export async function GET() {
  try {
    return NextResponse.json({ dossiers: await listerDossiers() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers");
  }
}

/**
 * Ouverture d'un dossier. Corps multipart : `donnees` (JSON des champs) et
 * `photos` (au moins un fichier). Le navigateur envoie la première photo ici
 * et les suivantes une à une sur /api/dossiers/[id]/photos : au-delà de 10 Mo,
 * le corps d'une requête est tronqué par le middleware.
 */
export async function POST(request: NextRequest) {
  try {
    const formulaire = await lireFormulaire(request);
    let donnees: unknown;
    try {
      donnees = JSON.parse(texteFormulaire(formulaire, "donnees"));
    } catch {
      throw new ErreurMetier("Requête invalide : champs du dossier illisibles.");
    }
    const entree = analyser(schemaCreation, donnees);
    const photos = formulaire.getAll("photos").filter((valeur): valeur is File => valeur instanceof File);
    const id = await creerDossier(entree, photos);
    return NextResponse.json({ id }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers");
  }
}
