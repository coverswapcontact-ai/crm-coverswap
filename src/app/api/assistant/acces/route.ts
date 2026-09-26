import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { vueAcces } from "@/lib/assistant/vues-parametres";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { revoquerClient, revoquerJeton, revoquerTout } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

/** GET : adresse du serveur, applications connectées et leurs jetons (jamais leur valeur), catalogue des outils. */
export async function GET() {
  try {
    return NextResponse.json(await vueAcces());
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/assistant/acces");
  }
}

const schema = z.union([z.object({ clientId: z.string().min(1).max(2000) }), z.object({ jetonId: z.string().min(1).max(40) }), z.object({ tout: z.literal(true) })]);

/** DELETE { clientId } | { jetonId } | { tout: true } : révocation (rien n'est effacé, les lignes restent datées). */
export async function DELETE(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    const motif = "Révoqué par Lucas (Paramètres)";
    if ("clientId" in entree) await revoquerClient(entree.clientId, motif);
    else if ("jetonId" in entree) await revoquerJeton(entree.jetonId, motif);
    else await revoquerTout(motif);
    return NextResponse.json(await vueAcces());
  } catch (erreur) {
    return reponseErreur(erreur, "DELETE /api/assistant/acces");
  }
}
