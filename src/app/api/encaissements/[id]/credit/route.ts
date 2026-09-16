import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { schemaCredit } from "@/lib/encaissements/schemas";
import { crediterCheque } from "@/lib/encaissements/service";

/** POST : chèque crédité sur le compte. Rend le dossier à jour s'il y en a un. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossierId = await crediterCheque(id, analyser(schemaCredit, await lireCorpsJson(requete)));
    return NextResponse.json(dossierId ? await chargerDetail(dossierId) : { ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/encaissements/[id]/credit");
  }
}
