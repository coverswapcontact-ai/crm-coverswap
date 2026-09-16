import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { declarerNumero, lireRegistre, numerosLibres, schemaDeclaration } from "@/lib/dossiers/registre";

export const dynamic = "force-dynamic";

/** GET : le registre par série ; `?libres=1` : les numéros émis hors du CRM pas encore rattachés à un document. */
export async function GET(requete: NextRequest) {
  try {
    if (requete.nextUrl.searchParams.get("libres") === "1") return NextResponse.json({ libres: await numerosLibres() });
    return NextResponse.json({ series: await lireRegistre() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/numeros");
  }
}

/** POST : déclare un numéro émis hors du CRM ; il ne sera jamais attribué. */
export async function POST(requete: NextRequest) {
  try {
    await declarerNumero(analyser(schemaDeclaration, await lireCorpsJson(requete)));
    return NextResponse.json({ series: await lireRegistre() }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/numeros");
  }
}
