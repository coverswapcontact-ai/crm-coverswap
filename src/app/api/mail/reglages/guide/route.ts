import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { genererGuideStyle } from "@/lib/mail/redaction";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** POST : tirer le guide de style des mails envoyés (un appel à l'IA, à la demande). */
export async function POST() {
  try {
    return NextResponse.json({ guide: await genererGuideStyle("LUCAS") });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/reglages/guide");
  }
}
