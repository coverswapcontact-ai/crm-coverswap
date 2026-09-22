import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { synchroniserBoite } from "@/lib/mail/boite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST : relire la boîte tout de suite (à l'ouverture de l'onglet), sans attendre le passage de la minute. */
export async function POST() {
  try {
    return NextResponse.json({ bilan: await synchroniserBoite() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/synchroniser");
  }
}
