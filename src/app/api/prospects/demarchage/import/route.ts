import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { importerProspects, schemaImportProspects } from "@/lib/prospects/demarchage";

/** POST : contenu d'un export de prospects (scripts/exporter-prospects.ts). Ajoute ce qui manque, n'écrase rien. */
export async function POST(requete: NextRequest) {
  try {
    const fichier = analyser(schemaImportProspects, await lireCorpsJson(requete));
    return NextResponse.json(await importerProspects(fichier));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/prospects/demarchage/import");
  }
}
