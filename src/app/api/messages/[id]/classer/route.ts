import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { CATEGORIES_HORS_CLIENTS } from "@/lib/messages/constantes";
import { classerMessage } from "@/lib/messages/tri";

type Contexte = { params: Promise<{ id: string }> };

const schema = z.object({ categorie: z.enum(CATEGORIES_HORS_CLIENTS, "Choisis un classement.") });

/** POST { categorie } : hors clients (fournisseur, administratif, personnel, autre). */
export async function POST(requete: NextRequest, { params }: Contexte) {
  try {
    const { id } = await params;
    const { categorie } = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await classerMessage(id, categorie));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messages/[id]/classer");
  }
}
