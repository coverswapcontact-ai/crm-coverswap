import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { detailMail } from "@/lib/mail/detail";

export const dynamic = "force-dynamic";

/** GET : la conversation entière, les pièces, le contexte du client, les brouillons et les envois. */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await detailMail(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/mail/[id]");
  }
}
