import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { contexteDuContact } from "@/lib/mail/contexte";

export const dynamic = "force-dynamic";

/** GET ?client=…|lead=…|dossier=… : le contexte d'un contact, pour écrire un nouveau mail. */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    return NextResponse.json({ contexte: await contexteDuContact({ clientId: parametres.get("client"), leadId: parametres.get("lead"), dossierId: parametres.get("dossier") }) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/contexte");
  }
}
