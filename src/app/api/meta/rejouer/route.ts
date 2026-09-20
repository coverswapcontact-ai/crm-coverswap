import { NextResponse, type NextRequest } from "next/server";
import { lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { rejouerLeadMeta } from "@/lib/meta/leads";
import { santeMeta } from "@/lib/meta/sante";

export const dynamic = "force-dynamic";

/**
 * Remet en file un lead Meta reçu mais pas encore entré dans le CRM.
 * Sans `leadgenId`, rejoue tous ceux qui attendent (après l'accord d'une
 * permission Meta, par exemple).
 */
export async function POST(requete: NextRequest) {
  try {
    const corps = (await lireCorpsJson(requete)) as { leadgenId?: unknown };
    const sante = await santeMeta({ interrogerMeta: false });
    const cibles =
      typeof corps?.leadgenId === "string" && corps.leadgenId
        ? [corps.leadgenId]
        : sante.echecs.leads.map((lead) => lead.leadgenId);

    const resultats: { leadgenId: string; ok: boolean; erreur?: string }[] = [];
    for (const leadgenId of cibles) {
      try {
        await rejouerLeadMeta(leadgenId);
        resultats.push({ leadgenId, ok: true });
      } catch (erreur) {
        resultats.push({ leadgenId, ok: false, erreur: erreur instanceof Error ? erreur.message : "échec" });
      }
    }
    return NextResponse.json({ rejoues: resultats.filter((r) => r.ok).length, resultats });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/meta/rejouer");
  }
}
