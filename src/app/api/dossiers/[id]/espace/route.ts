import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lienEspace, ouvrirEspace, renouvelerEspace, revoquerEspace } from "@/lib/espace/liens";

export const dynamic = "force-dynamic";

/** L'espace client vu du CRM : le lien, ce que le client y a fait, les simulations déposées. */
async function vueCrm(dossierId: string) {
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId }, include: { simulations: { where: { archiveLe: null }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] } } });
  if (!espace) return null;
  const accord = await prisma.accordDevis.findFirst({ where: { dossierId }, orderBy: { createdAt: "desc" } });
  let souhaits: unknown = null;
  try {
    souhaits = espace.souhaits ? JSON.parse(espace.souhaits) : null;
  } catch {
    souhaits = null;
  }
  return {
    id: espace.id,
    lien: espace.revoqueLe ? null : lienEspace(espace),
    expireLe: espace.expireLe.toISOString(),
    revoqueLe: espace.revoqueLe?.toISOString() ?? null,
    premierAccesLe: espace.premierAccesLe?.toISOString() ?? null,
    dernierAccesLe: espace.dernierAccesLe?.toISOString() ?? null,
    nbAcces: espace.nbAcces,
    souhaits,
    simulations: espace.simulations.map((s) => ({
      id: s.id,
      titre: s.titre,
      description: s.description,
      url: `/api/dossiers/${dossierId}/espace/simulations/${s.id}`,
      choisie: Boolean(s.choisieLe),
      commentaire: s.commentaireClient,
      le: s.createdAt.toISOString(),
    })),
    accord: accord ? { le: accord.createdAt.toISOString(), nom: accord.nomSignataire, numeroDevis: accord.numeroDevis, total: accord.totalHt } : null,
  };
}

export async function GET(_requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ espace: await vueCrm(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/dossiers/[id]/espace");
  }
}

const schema = z.object({ action: z.enum(["ouvrir", "revoquer", "renouveler"]) });

/** POST { action } : ouvrir l'espace (ou prolonger le lien), le désactiver, ou émettre un nouveau lien. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action } = analyser(schema, await lireCorpsJson(requete));
    if (action === "ouvrir") await ouvrirEspace(id);
    else {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: id }, select: { id: true } });
      if (!espace) throw new ErreurMetier("Ce dossier n'a pas encore d'espace client.", 404);
      if (action === "revoquer") await revoquerEspace(espace.id);
      else await renouvelerEspace(espace.id);
    }
    return NextResponse.json({ espace: await vueCrm(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/dossiers/[id]/espace");
  }
}
