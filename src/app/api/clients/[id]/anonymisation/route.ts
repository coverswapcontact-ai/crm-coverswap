import { NextResponse, type NextRequest } from "next/server";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { chargerFiche } from "@/lib/clients/fiches";
import { apercuAnonymisation } from "@/lib/rgpd/anonymisation";
import { anonymiserClient, schemaDemandeAnonymisation } from "@/lib/rgpd/conservation";

type Contexte = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** GET : ce que l'anonymisation effacerait, ce qu'elle garde, ce qui l'empêche. */
export async function GET(_requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    return NextResponse.json(await apercuAnonymisation(id));
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/clients/[id]/anonymisation");
  }
}

/** POST { motif, commentaire?, confirmation: true } : anonymise la fiche (définitif). */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const proposition = await anonymiserClient(id, analyser(schemaDemandeAnonymisation, await lireCorpsJson(requete)));
    return NextResponse.json({ proposition, client: await chargerFiche(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/anonymisation");
  }
}
