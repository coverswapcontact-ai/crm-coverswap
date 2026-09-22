import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { rattacherALaMain } from "@/lib/mail/rattachement";

export const dynamic = "force-dynamic";

const schema = z.object({ clientId: z.string().min(1).max(40), dossierId: z.string().max(40).nullable().optional() });

/** POST { clientId, dossierId? } : rattacher le fil à un client ; l'adresse rejoint sa fiche. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { clientId, dossierId } = analyser(schema, await lireCorpsJson(requete));
    return NextResponse.json(await rattacherALaMain(id, clientId, dossierId ?? null));
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/mail/[id]/rattacher");
  }
}
