import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { demanderReleve } from "@/lib/messages/taches";

/** POST : relevé de la boîte mail en tâche de fond (jamais bloquant). */
export async function POST() {
  try {
    await demanderReleve();
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/relever");
  }
}
