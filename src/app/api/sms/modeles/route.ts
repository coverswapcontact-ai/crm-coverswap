import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { etatFournisseur } from "@/lib/sms/fournisseurs";
import { listerModeles } from "@/lib/sms/modeles";

export const dynamic = "force-dynamic";

/** GET : les messages types et l'état du fournisseur de SMS (Paramètres → Messagerie SMS). */
export async function GET() {
  try {
    return NextResponse.json({ modeles: await listerModeles(), fournisseur: etatFournisseur() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/sms/modeles");
  }
}
