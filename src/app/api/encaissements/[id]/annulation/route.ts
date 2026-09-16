import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerDetail } from "@/lib/dossiers/dossiers";
import { schemaAnnulation } from "@/lib/encaissements/schemas";
import { annulerEncaissement } from "@/lib/encaissements/service";

/** POST : erreur de saisie : l'encaissement est annulé avec son motif, jamais supprimé. Rend le dossier à jour s'il y en a un. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const dossierId = await annulerEncaissement(id, analyser(schemaAnnulation, await lireCorpsJson(requete)));
    return NextResponse.json(dossierId ? await chargerDetail(dossierId) : { ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/encaissements/[id]/annulation");
  }
}
