import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { GROUPES_ENTRANTS, type GroupeEntrants } from "@/lib/prospects/constantes";
import { creerEntrant, listerEntrants, schemaCreationEntrant } from "@/lib/prospects/entrants";

export const dynamic = "force-dynamic";

/** GET ?groupe=A_TRAITER|CONTACTES|ANCIENS|AVEC_DOSSIER|SANS_SUITE|ARCHIVES&source=…&recherche=… */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const groupe = parametres.get("groupe") ?? "";
    const liste = await listerEntrants({
      groupe: (GROUPES_ENTRANTS as readonly string[]).includes(groupe) ? (groupe as GroupeEntrants) : undefined,
      source: parametres.get("source") || undefined,
      recherche: parametres.get("recherche") || undefined,
    });
    return NextResponse.json(liste);
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/prospects/entrants");
  }
}

/** POST : contact saisi à la main ; rend { id, clientId }. */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaCreationEntrant, await lireCorpsJson(requete));
    return NextResponse.json(await creerEntrant(entree), { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/entrants");
  }
}
