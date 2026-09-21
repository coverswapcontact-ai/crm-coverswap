import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { ouvrirEspace, renouvelerEspace, revoquerEspace } from "@/lib/espace/liens";
import { gesteDeLucas, schemaGesteEspace, vueEspaceCrm } from "@/lib/espace/vue-crm";

export const dynamic = "force-dynamic";

/** L'espace client vu du CRM : tout ce que le client y a fait, écrit, validé — et ce qu'il lui reste à faire (espace/vue-crm.ts). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ espace: await vueEspaceCrm(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/espace");
  }
}

const schemaLien = z.object({ action: z.enum(["ouvrir", "revoquer", "renouveler", "accorder"]), nombre: z.number().int().min(1).max(20).optional() });

/**
 * POST { action } : le lien (ouvrir ou prolonger, désactiver, renouveler) et, ancien geste, accorder des simulations.
 * POST { geste, … } : agir à la place du client — valider ou dévalider son projet, le modifier, valider ou dévalider
 * une simulation, retirer une demande ou un accord, accorder des simulations, retirer ou remettre une photo,
 * réinitialiser une étape. Chaque geste est écrit dans l'historique du dossier, avec « par Lucas ».
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const corps = await lireCorpsJson(requete);
    if (corps && typeof corps === "object" && "geste" in corps) {
      await gesteDeLucas(id, analyser(schemaGesteEspace, corps));
      return NextResponse.json({ espace: await vueEspaceCrm(id) });
    }
    const { action, nombre } = analyser(schemaLien, corps);
    if (action === "ouvrir") await ouvrirEspace(id);
    else if (action === "accorder") await gesteDeLucas(id, { geste: "accorder", nombre: nombre ?? 3 });
    else {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: id }, select: { id: true } });
      if (!espace) throw new ErreurMetier("Ce dossier n'a pas encore d'espace client.", 404);
      if (action === "revoquer") await revoquerEspace(espace.id);
      else await renouvelerEspace(espace.id);
    }
    return NextResponse.json({ espace: await vueEspaceCrm(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/espace");
  }
}
