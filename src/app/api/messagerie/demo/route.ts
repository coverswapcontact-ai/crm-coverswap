import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { analyserSuivi } from "@/lib/messagerie/analyse";
import { creerDemoMessagerie } from "@/lib/messagerie/demo";
import { suiviPour } from "@/lib/messagerie/suivis";

export const dynamic = "force-dynamic";

/**
 * POST : crée le dossier « Démo Messagerie » (lead fictif, numéro de la plage de fiction) et l'analyse tout de suite :
 * A1 prêt et l'alerte sur le téléphone, comme pour un vrai lead. L'ancienne démo est archivée (rien ne se supprime).
 */
export async function POST() {
  try {
    const maintenant = new Date();
    const { leadId, archives } = await creerDemoMessagerie(maintenant);
    const suivi = await suiviPour({ leadId });
    if (suivi) await analyserSuivi(suivi.id, maintenant);
    return NextResponse.json({ leadId, suiviId: suivi?.id ?? null, archives });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/demo");
  }
}
