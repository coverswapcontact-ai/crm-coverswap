import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { lienApercu, lienEspace, ouvrirEspace, renouvelerEspace, revoquerEspace } from "@/lib/espace/liens";
import { lireProjet, resumerProjet } from "@/lib/espace/projet";
import { accorderSimulations, quotaSimulations } from "@/lib/espace/service";

export const dynamic = "force-dynamic";

/** L'espace client vu du CRM : le lien, ce que le client y a fait (projet, choix, devis relu), les simulations. */
async function vueCrm(dossierId: string) {
  const espace = await prisma.espaceClient.findUnique({ where: { dossierId }, include: { simulations: { where: { archiveLe: null }, orderBy: [{ ordre: "asc" }, { createdAt: "asc" }] } } });
  if (!espace) return null;
  const [accord, dossier] = await Promise.all([
    prisma.accordDevis.findFirst({ where: { dossierId }, orderBy: { createdAt: "desc" } }),
    prisma.dossier.findUnique({ where: { id: dossierId }, select: { lead: { select: { typeProjet: true } } } }),
  ]);
  let souhaits: unknown = null;
  try {
    souhaits = espace.souhaits ? JSON.parse(espace.souhaits) : null;
  } catch {
    souhaits = null;
  }
  const projet = lireProjet(espace.souhaits);
  let choix: { mode: string; simulationId?: string; zones?: { libelle: string; zone: string; nom: string; ref: string; simulationId: string }[]; commentaire: string | null; le: string } | null = null;
  try {
    choix = espace.choix ? JSON.parse(espace.choix) : null;
  } catch {
    choix = null;
  }
  const expire = espace.expireLe.getTime() < Date.now();
  return {
    id: espace.id,
    lien: espace.revoqueLe ? null : lienEspace(espace),
    apercu: espace.revoqueLe || expire ? null : lienApercu(espace),
    projet: projet ? { resume: resumerProjet(projet, dossier?.lead?.typeProjet ?? "CUISINE"), ...projet } : null,
    choix,
    devis: { consultations: espace.devisConsultations, consulteLe: espace.devisConsulteLe?.toISOString() ?? null, documentId: espace.devisConsulteId },
    propositionDemandeeLe: espace.propositionDemandeeLe?.toISOString() ?? null,
    avis: espace.avis ? (JSON.parse(espace.avis) as { note: number; texte: string }) : null,
    creation: await (async () => {
      const quota = await quotaSimulations(espace);
      return { faites: quota.faites, restantes: quota.restantes, offertes: quota.gratuites + quota.accordees, enCours: quota.enCours.length, demandeesLe: espace.simulationsDemandeesLe?.toISOString() ?? null };
    })(),
    expireLe: espace.expireLe.toISOString(),
    revoqueLe: espace.revoqueLe?.toISOString() ?? null,
    premierAccesLe: espace.premierAccesLe?.toISOString() ?? null,
    dernierAccesLe: espace.dernierAccesLe?.toISOString() ?? null,
    nbAcces: espace.nbAcces,
    souhaits,
    simulations: espace.simulations.filter((s) => s.statut === "PUBLIEE").map((s) => ({
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

const schema = z.object({ action: z.enum(["ouvrir", "revoquer", "renouveler", "accorder"]), nombre: z.number().int().min(1).max(20).optional() });

/** POST { action } : ouvrir l'espace (ou prolonger le lien), le désactiver, émettre un nouveau lien, ou accorder des simulations (nombre). */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { action, nombre } = analyser(schema, await lireCorpsJson(requete));
    if (action === "ouvrir") await ouvrirEspace(id);
    else if (action === "accorder") {
      const espace = await prisma.espaceClient.findUnique({ where: { dossierId: id }, select: { id: true } });
      if (!espace) throw new ErreurMetier("Ce dossier n'a pas encore d'espace client.", 404);
      await accorderSimulations(espace.id, nombre ?? 3);
    }
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
