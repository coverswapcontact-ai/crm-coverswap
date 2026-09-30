import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { noterCommencement } from "@/lib/a-faire/durees";
import { idDeTache } from "../../parametres";

export const dynamic = "force-dynamic";

/** POST /api/a-faire/<id>/commencer : le raccourci vient d'être ouvert (mesure du temps réel). Sans effet sur une tâche close. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idDeTache((await params).id);
    return NextResponse.json({ commence: await noterCommencement(id, new Date()) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/[id]/commencer");
  }
}
