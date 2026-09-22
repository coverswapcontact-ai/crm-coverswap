import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { accorderProjets, desactiverLien, espaceDuClient, regenererLien } from "@/lib/espace/gestion";

export const dynamic = "force-dynamic";

const schemaAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerer"), mail: z.boolean().default(false), sms: z.boolean().default(false), texte: z.string().max(700).nullable().optional() }),
  z.object({ action: z.literal("desactiver") }),
  z.object({ action: z.literal("accorder-projet"), nombre: z.number().int().min(1).max(5).default(1) }),
]);

/**
 * POST sur l'espace PERMANENT d'un client (son identifiant) :
 *  - { action: "regenerer", mail, texte } : nouveau lien, l'ancien meurt ; le mail part si coché (texte relu par Lucas ; `sms` reste possible) ;
 *  - { action: "desactiver" } : le lien ne marche plus (rien d'effacé) ;
 *  - { action: "accorder-projet", nombre } : un projet en cours de plus (au-delà de deux).
 * Répond l'espace du client à jour.
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const permanent = await prisma.espacePermanent.findUnique({ where: { id }, select: { id: true, clientId: true } });
    if (!permanent) throw new ErreurMetier("Espace introuvable.", 404);
    const entree = analyser(schemaAction, await lireCorpsJson(requete));
    let resultat: Record<string, unknown> = {};
    if (entree.action === "regenerer") resultat = await regenererLien(id, { mail: entree.mail, sms: entree.sms, texte: entree.texte ?? null });
    else if (entree.action === "desactiver") await desactiverLien(id);
    else resultat = await accorderProjets(id, entree.nombre);
    return NextResponse.json({ ...resultat, ...(await espaceDuClient(permanent.clientId)) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/espaces/[id]");
  }
}
