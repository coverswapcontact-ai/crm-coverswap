import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { dossiersArchives } from "@/lib/dossiers/archivage";

export const dynamic = "force-dynamic";

/** GET : les dossiers archivés (les 200 derniers), pour les retrouver et les restaurer. */
export async function GET() {
  try {
    return NextResponse.json({ dossiers: await dossiersArchives() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/archives");
  }
}
