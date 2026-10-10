import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { estimerRejeu, rejouerEvenements } from "@/lib/messagerie/rejeu";

export const dynamic = "force-dynamic";
// Vingt analyses par l'IA, l'une après l'autre : jusqu'à deux minutes.
export const maxDuration = 300;

const schema = z.object({ ia: z.boolean().default(false), nombre: z.number().int().min(1).max(40).optional() });

/** GET : le coût annoncé d'un rejeu avec l'IA (prix de Paramètres), et pourquoi l'IA n'est pas disponible le cas échéant. */
export async function GET() {
  try {
    return NextResponse.json({ estimation: await estimerRejeu() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/rejeu");
  }
}

/** POST : rejoue à blanc les derniers événements réels (règles fixes ; l'IA si `ia`). Rien n'est écrit dans les dossiers. */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await rejouerEvenements({ ia: entree.ia, nombre: entree.nombre }));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/rejeu");
  }
}
