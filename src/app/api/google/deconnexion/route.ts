import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { deconnecterGoogle } from "@/lib/google/connexion";

/** POST : révoque l'accès chez Google ; la connexion reste dans l'historique, datée. */
export async function POST() {
  try {
    await deconnecterGoogle();
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/google/deconnexion");
  }
}
