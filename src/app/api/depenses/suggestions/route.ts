import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { suggestionsSaisie } from "@/lib/depenses/service";

export const dynamic = "force-dynamic";

/** GET : chantiers proposés (le probable en premier) et fournisseurs récents, pour la saisie rapide. */
export async function GET() {
  try {
    return NextResponse.json(await suggestionsSaisie());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/depenses/suggestions");
  }
}
