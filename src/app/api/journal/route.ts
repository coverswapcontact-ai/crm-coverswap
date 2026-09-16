import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { lireJournal } from "@/lib/journal/lecture";

export const dynamic = "force-dynamic";

/** GET /api/journal?dossierId=…|clientId=…&modele=…&id=…&famille=HUMAIN|AGENT|…&du=AAAA-MM-JJ&au=…&suite=… */
export async function GET(requete: NextRequest) {
  try {
    const parametres = requete.nextUrl.searchParams;
    const texte = (nom: string) => parametres.get(nom)?.trim() || undefined;
    return NextResponse.json(
      await lireJournal({
        dossierId: texte("dossierId"),
        clientId: texte("clientId"),
        modele: texte("modele"),
        enregistrementId: texte("id"),
        famille: texte("famille"),
        du: texte("du"),
        au: texte("au"),
        suite: texte("suite"),
        limite: Number(parametres.get("limite")) || undefined,
      })
    );
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/journal");
  }
}
