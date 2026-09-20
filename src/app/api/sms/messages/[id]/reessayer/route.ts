import { NextResponse, type NextRequest } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { reessayerSms } from "@/lib/sms/envoi";
import { publierEvenementSms } from "@/lib/sms/flux";

export const dynamic = "force-dynamic";

/** POST : remet en file un envoi en échec. */
export async function POST(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sms = await reessayerSms(id);
    publierEvenementSms({ genre: "STATUT", conversationId: sms.conversationId, smsId: sms.id });
    return NextResponse.json({ statut: sms.statut });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/sms/messages/[id]/reessayer");
  }
}
