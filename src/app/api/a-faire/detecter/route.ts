import { NextResponse } from "next/server";
import { reponseErreur } from "@/lib/commun/api";
import { passeComplete, resumePasse } from "@/lib/a-faire/detection";
import { listeTaches } from "@/lib/a-faire/lecture";

export const dynamic = "force-dynamic";

/**
 * POST /api/a-faire/detecter : « Actualiser » — un passage de tous les détecteurs maintenant, puis la liste à jour.
 * `nouvelles` (créées ou revenues) et `cochees` (par le CRM) pour le message de l'écran ; `resume` pour le journal.
 */
export async function POST() {
  try {
    const bilan = await passeComplete(new Date());
    const r = bilan.reconciliation;
    return NextResponse.json({ resume: resumePasse(bilan), nouvelles: r.crees + r.rouvertes, cochees: r.cochees, liste: await listeTaches(new Date()) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/a-faire/detecter");
  }
}
