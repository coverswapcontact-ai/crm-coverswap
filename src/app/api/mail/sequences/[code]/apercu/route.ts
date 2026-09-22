import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { apercuEtape, type CodeSequence } from "@/lib/mail/sequences";

export const dynamic = "force-dynamic";

/** GET ?rang=1&cle=… : l'aperçu d'une étape avec les données d'un vrai client. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const rang = Number(requete.nextUrl.searchParams.get("rang") ?? "1") || 1;
    return NextResponse.json(await apercuEtape(code as CodeSequence, rang, requete.nextUrl.searchParams.get("cle") ?? undefined));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/sequences/[code]/apercu");
  }
}
