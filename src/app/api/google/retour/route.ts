import { NextResponse, type NextRequest } from "next/server";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { COOKIE_ETAT, terminerConnexion } from "@/lib/google/connexion";

export const dynamic = "force-dynamic";

/** GET : retour de Google après consentement ; renvoie vers les paramètres avec le résultat. */
export async function GET(requete: NextRequest) {
  const parametres = requete.nextUrl.searchParams;
  const destination = new URL("/parametres", requete.nextUrl.origin);
  try {
    const { compte } = await terminerConnexion({
      code: parametres.get("code"),
      etat: parametres.get("state"),
      etatAttendu: requete.cookies.get(COOKIE_ETAT)?.value ?? null,
      erreur: parametres.get("error"),
    });
    destination.searchParams.set("google", "connecte");
    destination.searchParams.set("compte", compte);
  } catch (erreur) {
    if (!(erreur instanceof ErreurMetier)) console.error("[google] retour :", erreur);
    destination.searchParams.set("google", "erreur");
    destination.searchParams.set("message", erreur instanceof ErreurMetier ? erreur.message : "Connexion impossible : réessaie dans un instant.");
  }
  const reponse = NextResponse.redirect(destination);
  reponse.cookies.delete({ name: COOKIE_ETAT, path: "/api/google" });
  return reponse;
}
