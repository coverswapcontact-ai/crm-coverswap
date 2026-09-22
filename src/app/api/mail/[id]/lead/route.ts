import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { creerLeadDepuisMail } from "@/lib/mail/rattachement";

export const dynamic = "force-dynamic";

/** POST : créer un lead (source « mail ») depuis la demande d'un inconnu. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await creerLeadDepuisMail(id, { notifier: false }));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/lead");
  }
}
