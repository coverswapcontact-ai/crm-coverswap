import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { brouillonEnvoiDocument, envoyerDocumentParMail, schemaEnvoiDocument } from "@/lib/mail/service";

type Contexte = { params: Promise<{ id: string; documentId: string }> };

export const dynamic = "force-dynamic";

/** GET : brouillon du mail (destinataire, objet, message), à relire. */
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id, documentId } = await params;
    return NextResponse.json(await brouillonEnvoiDocument(id, documentId));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/documents/[documentId]/mail");
  }
}

/** POST : envoi décidé par la personne (proposition validée, envoi par la file, trace au dossier). */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id, documentId } = await params;
    const proposition = await envoyerDocumentParMail(id, documentId, analyser(schemaEnvoiDocument, await lireCorpsJson(requete)));
    return NextResponse.json(proposition, { status: 202 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/documents/[documentId]/mail");
  }
}
