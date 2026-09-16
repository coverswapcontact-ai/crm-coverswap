import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { demanderSynchronisation } from "@/lib/drive/synchronisation";

/** POST : met la synchronisation du miroir en file ({ verifier: true } pour contrôler Drive élément par élément). */
export async function POST(requete: NextRequest) {
  try {
    const corps = (await requete.json().catch(() => ({}))) as { verifier?: unknown };
    await demanderSynchronisation(corps.verifier === true);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/drive/synchroniser");
  }
}
