import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { envoyerEtape } from "@/lib/mail/sequences";

export const dynamic = "force-dynamic";

const schema = z.object({ action: z.enum(["ENVOYER", "ARRETER"], "Geste inconnu.") });

/** POST { action } : valider (envoyer) l'étape due d'un contact, ou arrêter sa séquence. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = analyser(schema, await lireCorpsJson(requete));
    if (action === "ENVOYER") return NextResponse.json(await envoyerEtape(id));
    await prisma.inscriptionSequence.update({ where: { id }, data: { statut: "ARRETEE", arretMotif: "Arrêtée par Lucas" } });
    return NextResponse.json({ ok: true });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/sequences/inscriptions/[id]");
  }
}
