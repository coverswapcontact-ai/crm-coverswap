import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { schemaRejet } from "@/lib/encaissements/schemas";
import { rejeterEncaissement } from "@/lib/encaissements/service";

/** POST : chèque revenu impayé : daté et motivé ; ses imputations cessent de compter. Rend le dossier à jour s'il y en a un. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossierId = await rejeterEncaissement(id, analyser(schemaRejet, await lireCorpsJson(requete)));
    return NextResponse.json(dossierId ? await chargerDetail(dossierId) : { ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/encaissements/[id]/rejet");
  }
}
