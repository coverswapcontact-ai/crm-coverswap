import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { archiverAnciensLeads } from "@/lib/prospects/menage";

export const dynamic = "force-dynamic";

/**
 * POST : « Archiver les anciens leads » (mission 25, lot 6) — les leads « À appeler » reçus avant le 25/09/2026, d'un
 * geste de Lucas (le nombre exact est montré avant, `compteurs.anciens` de la liste). Rend les leads archivés : c'est
 * ce que « Annuler » restaure.
 */
export async function POST() {
  try {
    return NextResponse.json(await archiverAnciensLeads());
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/leads/anciens");
  }
}
