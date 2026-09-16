import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { schemaCorrectionEncaissement } from "@/lib/encaissements/schemas";
import { modifierEncaissement } from "@/lib/encaissements/service";

/** PATCH : correction d'un paiement (montant, date, moyen, référence, payeur, note), tracée. Rend le dossier à jour s'il y en a un. */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossierId = await modifierEncaissement(id, analyser(schemaCorrectionEncaissement, await lireCorpsJson(requete)));
    return NextResponse.json(dossierId ? await chargerDetail(dossierId) : { ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/encaissements/[id]");
  }
}
