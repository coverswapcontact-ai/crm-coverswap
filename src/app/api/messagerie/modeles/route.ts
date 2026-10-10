import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { MODES_MESSAGE } from "@/lib/messagerie/catalogue";
import { listerMessagesDeLaListe, modifierModeDeLaListe, modifierTexteDeLaListe } from "@/lib/messagerie/modeles";

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({ cle: z.string().min(1).max(40), texte: z.string().max(2000).nullable() }),
  z.object({ code: z.string().min(1).max(10), mode: z.enum(MODES_MESSAGE).nullable() }),
]);

/** GET : les 41 messages de la liste, leurs variantes, le texte et le mode en vigueur (Paramètres → SMS). */
export async function GET() {
  try {
    return NextResponse.json({ messages: await listerMessagesDeLaListe() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/modeles");
  }
}

/** PATCH : un texte (`cle`, `texte` ; null = revenir au texte de départ) ou un mode (`code`, `mode` ; null = celui de la liste). */
export async function PATCH(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    const message = "cle" in entree ? await modifierTexteDeLaListe(entree.cle, entree.texte) : await modifierModeDeLaListe(entree.code, entree.mode);
    return NextResponse.json({ message });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/messagerie/modeles");
  }
}
