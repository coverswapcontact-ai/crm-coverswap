import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { toutNettoyer } from "@/lib/mail/vues";

export const dynamic = "force-dynamic";

/** POST : « Tout nettoyer » — archive et marque lu ce qui ne demande rien (réversible, rien n'est supprimé). */
export async function POST() {
  try {
    return NextResponse.json(await toutNettoyer());
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/nettoyer");
  }
}
