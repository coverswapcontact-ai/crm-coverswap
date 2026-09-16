import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { schemaEncaissement } from "@/lib/encaissements/schemas";
import { enregistrerEncaissement } from "@/lib/encaissements/service";

/** POST : paiement reçu pour ce dossier (imputé sur la pièce choisie, sinon automatiquement). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schemaEncaissement, await lireCorpsJson(requete));
    await enregistrerEncaissement({ ...entree, dossierId: id });
    return NextResponse.json(await chargerDetail(id), { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/encaissements");
  }
}
