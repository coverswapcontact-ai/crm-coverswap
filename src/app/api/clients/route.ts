import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { CATEGORIES_CLIENT, SOURCES_CLIENT, type CategorieClient, type SourceClient } from "@/lib/clients/constantes";
import { creerClientManuel, listerClients, schemaCreationClient } from "@/lib/clients/fiches";

export const dynamic = "force-dynamic";

/** GET /api/clients?recherche=…&categorie=…&source=…&archives=1&limite=… */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const categorie = parametres.get("categorie") ?? "";
    const source = parametres.get("source") ?? "";
    const clients = await listerClients({
      recherche: parametres.get("recherche") ?? undefined,
      categorie: (CATEGORIES_CLIENT as readonly string[]).includes(categorie) ? (categorie as CategorieClient) : undefined,
      source: (SOURCES_CLIENT as readonly string[]).includes(source) ? (source as SourceClient) : undefined,
      archives: parametres.get("archives") === "1",
      limite: Number(parametres.get("limite")) || undefined,
    });
    return NextResponse.json({ clients });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/clients");
  }
}

/** POST : nouvelle fiche client ; 409 si un client a déjà cet e-mail ou ce numéro (sauf `forcer`). */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaCreationClient, await lireCorpsJson(requete));
    return NextResponse.json({ id: await creerClientManuel(entree) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients");
  }
}
