import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { classerLot } from "@/lib/a-faire/reponses";
import { cleDeLot } from "../../../parametres";

export const dynamic = "force-dynamic";

/** POST /api/a-faire/lots/<lot>/classer : « Tout classer ». Rend { classees, effets, laissees, le } ; annulable (…/annuler { le }). */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ lot: string }> }) {
  try {
    const lot = cleDeLot((await params).lot);
    return NextResponse.json(await classerLot(lot, new Date()));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/lots/[lot]/classer");
  }
}
