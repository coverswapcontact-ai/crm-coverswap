import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { assurerSequences, listerSequences } from "@/lib/mail/sequences";

export const dynamic = "force-dynamic";

const schema = z.object({
  active: z.boolean().optional(),
  mode: z.enum(["VALIDATION", "AUTOMATIQUE"]).optional(),
  plafondJour: z.number().int().min(1).max(50).optional(),
  etapes: z.array(z.object({ rang: z.number().int().min(1).max(10), delaiJours: z.number().int().min(0).max(365), objet: z.string().trim().min(1).max(150), texte: z.string().trim().min(10).max(4000) })).max(10).optional(),
});

/** PATCH : régler une séquence (activer, mode, plafond) ou réécrire ses étapes. */
export async function PATCH(requete: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    await assurerSequences();
    const sequence = await prisma.sequenceMail.findUnique({ where: { code } });
    if (!sequence) throw new ErreurMetier("Séquence introuvable.", 404);
    const entree = analyser(schema, await lireCorpsJson(requete));
    await prisma.$transaction(async (tx) => {
      await tx.sequenceMail.update({ where: { id: sequence.id }, data: { ...(entree.active !== undefined ? { active: entree.active } : {}), ...(entree.mode ? { mode: entree.mode } : {}), ...(entree.plafondJour ? { plafondJour: entree.plafondJour } : {}) } });
      for (const etape of entree.etapes ?? []) {
        await tx.etapeSequence.upsert({
          where: { sequenceId_rang: { sequenceId: sequence.id, rang: etape.rang } },
          create: { sequenceId: sequence.id, ...etape },
          update: { delaiJours: etape.delaiJours, objet: etape.objet, texte: etape.texte },
        });
      }
    });
    return NextResponse.json({ sequences: await listerSequences() });
  } catch (erreur) {
    return reponseErreur(erreur, "PATCH /api/mail/sequences/[code]");
  }
}
