import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { appliquerActionLeads, schemaActionLeads } from "@/lib/prospects/menage";

export const dynamic = "force-dynamic";

/**
 * POST { action, ids, motif? } : actions rapides de la liste Leads, sur un ou
 * plusieurs leads — ARCHIVER (motif), RESTAURER, TRAITER, REPRENDRE. Rend les
 * leads réellement changés : c'est ce que le bouton « Annuler » défait.
 */
export async function POST(requete: NextRequest) {
  try {
    return NextResponse.json(await appliquerActionLeads(analyser(schemaActionLeads, await lireCorpsJson(requete))));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/leads/actions");
  }
}
