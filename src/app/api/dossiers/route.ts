import { NextRequest, NextResponse } from "next/server";
import { analyser, lireFormulaire, reponseErreur, texteFormulaire } from "@/lib/dossiers/api";
import { lirePage } from "@/lib/commun/pagination";
import { creerDossier, pageDossiers, schemaCreation } from "@/lib/dossiers/dossiers";
import { ErreurMetier } from "@/lib/dossiers/erreurs";

/** GET ?page=1&vue=EN_COURS|TOUS|A_FAIRE&q=…&inactifs=0 : une page de 50 dossiers, filtrée ici (mission 13, lot 6). */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const vue = parametres.get("vue");
    const { page, parPage } = lirePage(parametres);
    return NextResponse.json(
      await pageDossiers({
        page,
        parPage,
        vue: vue === "TOUS" || vue === "A_FAIRE" ? vue : "EN_COURS",
        recherche: parametres.get("q")?.slice(0, 120) ?? undefined,
        masquerInactifs: parametres.get("inactifs") === "0",
      })
    );
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
