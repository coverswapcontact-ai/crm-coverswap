import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { modifierModele } from "@/lib/sms/modeles";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    libelle: z.string().trim().min(2).max(120),
    texte: z.string("Le texte du message est vide.").trim().min(1, "Le texte du message est vide.").max(600, "Message type trop long (600 caractères au plus)."),
    actif: z.boolean(),
  })
  .partial();

/** PATCH : corrige un message type, ou le coupe (l'accusé de réception ne part plus s'il est coupé). */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ modele: await modifierModele(id, analyser(schema, await lireCorpsJson(requete))) });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/sms/modeles/[id]");
  }
}
