import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { archiverDossier, restaurerDossier } from "@/lib/dossiers/archivage";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("archiver"), motif: z.string("Indique pourquoi.").trim().min(3, "Indique pourquoi ce dossier est archivé.").max(300) }),
  z.object({ action: z.literal("restaurer") }),
]);

/**
 * POST { action: "archiver", motif } : le dossier sort de Dossiers, son lead revient dans Leads avec ses
 * simulations et ses photos, son espace client est désactivé. Refusé s'il porte un document émis, un paiement,
 * une dépense ou un accord. POST { action: "restaurer" } : l'inverse. Rien n'est supprimé.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entree = analyser(schema, await lireCorpsJson(requete));
    if (entree.action === "archiver") return NextResponse.json({ ok: true, ...(await archiverDossier(id, entree.motif)) });
    await restaurerDossier(id);
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/archivage");
  }
}
