import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { MOTIFS_PERTE } from "@/lib/dossiers/constants";
import { ISSUES_APRES_APPEL, apresAppel } from "@/lib/messagerie/gestes";
import { suiviPour } from "@/lib/messagerie/suivis";
import { avecImages, premiersSms, vueDuMessage } from "@/lib/messagerie/vues";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    leadId: z.string().max(40).optional(),
    dossierId: z.string().max(40).optional(),
    issue: z.enum(ISSUES_APRES_APPEL),
    delai: z.enum(["1S", "2S", "1M"]).optional(),
    motifPerte: z.enum(MOTIFS_PERTE).optional(),
    perteCommentaire: z.string().trim().max(2000).optional(),
    note: z.string().trim().max(2000).optional(),
    rappelLe: z.iso.datetime().nullable().optional(),
  })
  .refine((v) => v.leadId || v.dossierId, "Indique le contact ou le dossier concerné.");

/**
 * POST : la feuille de fin d'appel (« Qu'est-ce qui s'est dit ? »), depuis n'importe quel écran. L'appel est noté par
 * la fonction de toujours (`noterAppel`) ; la messagerie ajoute « Va signer », « Réfléchit », « Échantillons » et
 * rend le message préparé (A2, A4, A5, P1, Q5…), prêt à ouvrir dans Messages.
 */
export async function POST(requete: NextRequest) {
  try {
    const entree = analyser(schema, await lireCorpsJson(requete));
    const suivi = await suiviPour({ leadId: entree.leadId, dossierId: entree.dossierId }, { geste: true });
    if (!suivi) throw new ErreurMetier("Contact introuvable.", 404);
    const r = await apresAppel({ suiviId: suivi.id, issue: entree.issue, delai: entree.delai, motifPerte: entree.motifPerte, perteCommentaire: entree.perteCommentaire, note: entree.note, rappelLe: entree.rappelLe ? new Date(entree.rappelLe) : null });
    return NextResponse.json({
      ...(r.suite ?? {}),
      sms: null,
      resume: r.resume ?? "Appel noté.",
      proposerSansSuite: r.proposerSansSuite,
      suiviId: r.suiviId,
      messagerie: r.proposee ? (await avecImages([vueDuMessage(r.proposee, (await premiersSms([r.proposee.suiviId])).has(r.proposee.suiviId))]))[0] : null,
    });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/messagerie/apres-appel");
  }
}
