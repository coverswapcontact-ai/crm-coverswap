import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { proposerFusions } from "@/lib/clients/doublons";

/** POST : cherche les fiches en double maintenant ; chaque paire devient une proposition à valider. */
export async function POST() {
  try {
    return NextResponse.json({ nouvelles: await proposerFusions() });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/doublons");
  }
}
