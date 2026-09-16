import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { schemaEncaissement } from "@/lib/encaissements/schemas";
import { enregistrerEncaissement } from "@/lib/encaissements/service";

/** POST : paiement reçu pour une facture du registre (facture hors dossier comprise). */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schemaEncaissement, await lireCorpsJson(requete));
    if (!entree.numeroDocumentId) throw new ErreurMetier("Indique la facture que ce paiement règle.", 400);
    const { encaissement, dossierId } = await enregistrerEncaissement(entree);
    return NextResponse.json({ id: encaissement.id, dossierId }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/encaissements");
  }
}
