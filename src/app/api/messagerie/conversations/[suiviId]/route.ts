import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import prisma from "@/lib/prisma";
import { MOTIFS_PERTE } from "@/lib/dossiers/constants";
import {
  ISSUES_APRES_APPEL,
  ajouterNote,
  apresAppel,
  archiverConversation,
  arreterLesSms,
  corrigerOuEnEst,
  lienDeLEspace,
  marquerLu,
  poserRappelManuel,
  redigerAvecIa,
  mettreEnPause,
  preparerMessageLibre,
  rapporterReponse,
} from "@/lib/messagerie/gestes";
import { filDuSuivi, ouEnEstDuSuivi, premiersSms, vueDuMessage } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

/** GET : la conversation d'un client — « Où on en est », les dix dernières lignes du journal, le fil (tous canaux). */
export async function GET(_requete: NextRequest, { params }: { params: Promise<{ suiviId: string }> }) {
  try {
    const { suiviId } = await params;
    const suivi = await prisma.suivi.findUnique({ where: { id: suiviId } });
    if (!suivi) throw new ErreurMetier("Conversation introuvable.", 404);
    const [resume, fil] = await Promise.all([ouEnEstDuSuivi(suiviId), filDuSuivi(suiviId)]);
    const dossier = suivi.dossierId ? await prisma.dossier.findUnique({ where: { id: suivi.dossierId }, select: { etape: true, clientEmail: true, clientVille: true, main: true } }) : null;
    const lead = suivi.leadId ? await prisma.lead.findUnique({ where: { id: suivi.leadId }, select: { email: true, ville: true } }) : null;
    return NextResponse.json({
      suivi: {
        id: suivi.id,
        nom: suivi.nom,
        telephone: suivi.telephone,
        email: dossier?.clientEmail ?? lead?.email ?? null,
        ville: dossier?.clientVille ?? lead?.ville ?? null,
        dossierId: suivi.dossierId,
        leadId: suivi.leadId,
        etape: dossier?.etape ?? null,
        main: dossier?.main ?? null,
        pauseJusquau: suivi.pauseJusquau?.toISOString() ?? null,
        pauseMotif: suivi.pauseMotif,
        stop: Boolean(suivi.stopLe),
        archive: Boolean(suivi.archiveLe),
      },
      ...resume,
      fil,
    });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/messagerie/conversations/[suiviId]");
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lu") }),
  z.object({ action: z.literal("non-lu") }),
  z.object({ action: z.literal("archiver") }),
  z.object({ action: z.literal("desarchiver") }),
  z.object({ action: z.literal("pause"), jusquau: z.iso.datetime("Date invalide."), motif: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("reprendre") }),
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("note"), texte: z.string("La note est vide.").trim().min(2, "La note est vide.").max(4000) }),
  z.object({ action: z.literal("libre"), texte: z.string().trim().max(1600).optional(), code: z.string().max(4).optional(), canal: z.enum(["SMS", "MAIL", "ESPACE"]).optional() }),
  z.object({ action: z.literal("rappel"), le: z.iso.datetime("Date invalide."), prevenir: z.boolean().default(false) }),
  z.object({ action: z.literal("lien") }),
  z.object({ action: z.literal("rediger") }),
  z.object({ action: z.literal("ou-en-est"), situation: z.string().trim().max(120).optional(), client: z.string().trim().max(120).optional(), suite: z.string().trim().max(120).optional() }),
  z.object({
    action: z.literal("apres-appel"),
    issue: z.enum(ISSUES_APRES_APPEL),
    delai: z.enum(["1S", "2S", "1M"]).optional(),
    motifPerte: z.enum(MOTIFS_PERTE).optional(),
    perteCommentaire: z.string().trim().max(2000).optional(),
    rappelLe: z.iso.datetime().optional(),
    note: z.string().trim().max(2000).optional(),
  }),
]);

/**
 * POST : les gestes sur une conversation. JSON { action, … } ; « reponse » (réponse du client rapportée, avec ses
 * photos) arrive en multipart : texte, recuLe (ISO), photos[].
 */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ suiviId: string }> }) {
  try {
    const { suiviId } = await params;
    if ((requete.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const formulaire = await requete.formData();
      const texte = String(formulaire.get("texte") ?? "").slice(0, 1600);
      const recu = String(formulaire.get("recuLe") ?? "");
      const photos = formulaire.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
      const resultat = await rapporterReponse({ suiviId, texte, recuLe: recu && !Number.isNaN(Date.parse(recu)) ? new Date(recu) : null, photos });
      const premier = (await premiersSms([resultat.suiviId])).has(resultat.suiviId);
      return NextResponse.json({ suiviId: resultat.suiviId, photos: resultat.photos, proposee: resultat.proposee ? vueDuMessage(resultat.proposee, premier) : null });
    }
    const entree = analyser(schema, await lireCorpsJson(requete));
    switch (entree.action) {
      case "lu":
      case "non-lu":
        await marquerLu(suiviId, entree.action === "lu");
        return NextResponse.json({ ok: true });
      case "archiver":
      case "desarchiver":
        await archiverConversation(suiviId, entree.action === "archiver");
        return NextResponse.json({ ok: true });
      case "pause":
        await mettreEnPause({ suiviId, jusquau: new Date(entree.jusquau), motif: entree.motif });
        return NextResponse.json({ ok: true });
      case "reprendre":
        await mettreEnPause({ suiviId, jusquau: null });
        return NextResponse.json({ ok: true });
      case "stop":
        await arreterLesSms(suiviId);
        return NextResponse.json({ ok: true });
      case "note": {
        const r = await ajouterNote({ suiviId, texte: entree.texte });
        const cree = r.crees.length ? await prisma.messagePrepare.findFirst({ where: { id: { in: r.crees } }, orderBy: { createdAt: "asc" } }) : null;
        return NextResponse.json({ ouEnEst: r.ouEnEst, proposee: cree ? vueDuMessage(cree, (await premiersSms([suiviId])).has(suiviId)) : null });
      }
      case "libre":
        return NextResponse.json({ message: vueDuMessage(await preparerMessageLibre({ suiviId, texte: entree.texte, code: entree.code, canal: entree.canal }), (await premiersSms([suiviId])).has(suiviId)) });
      case "rappel": {
        const message = await poserRappelManuel({ suiviId, le: new Date(entree.le), prevenir: entree.prevenir });
        return NextResponse.json({ message: message ? vueDuMessage(message, (await premiersSms([suiviId])).has(suiviId)) : null });
      }
      case "lien":
        return NextResponse.json({ lien: await lienDeLEspace(suiviId) });
      case "rediger":
        return NextResponse.json(await redigerAvecIa(suiviId));
      case "ou-en-est":
        return NextResponse.json({ ouEnEst: await corrigerOuEnEst(suiviId, { situation: entree.situation, client: entree.client, suite: entree.suite }) });
      case "apres-appel": {
        const r = await apresAppel({ suiviId, issue: entree.issue, delai: entree.delai, motifPerte: entree.motifPerte, perteCommentaire: entree.perteCommentaire, note: entree.note, rappelLe: entree.rappelLe ? new Date(entree.rappelLe) : null });
        return NextResponse.json({ suiviId: r.suiviId, resume: r.resume, proposerSansSuite: r.proposerSansSuite, proposee: r.proposee ? vueDuMessage(r.proposee, (await premiersSms([r.suiviId])).has(r.suiviId)) : null });
      }
    }
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/conversations/[suiviId]");
  }
}
