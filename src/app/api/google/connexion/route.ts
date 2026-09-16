import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { COOKIE_ETAT, debuterConnexion } from "@/lib/google/connexion";

export const dynamic = "force-dynamic";

/** GET : envoie vers l'écran de consentement de Google (la personne est connectée au CRM). */
export async function GET() {
  try {
    const { url, etat } = debuterConnexion();
    const reponse = NextResponse.redirect(url);
    reponse.cookies.set(COOKIE_ETAT, etat, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google",
      maxAge: 600,
    });
    return reponse;
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/google/connexion");
  }
}
