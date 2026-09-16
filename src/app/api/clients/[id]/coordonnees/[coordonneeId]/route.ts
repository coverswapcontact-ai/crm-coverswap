import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { archiverCoordonnee, chargerFiche, definirPrincipale, modifierCoordonnee } from "@/lib/clients/fiches";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("modifier"),
    nature: z.enum(["email", "telephone"]),
    valeur: z.string("Valeur manquante.").trim().min(1, "Valeur manquante.").max(160).optional(),
    libelle: z.string().trim().max(40, "Libellé trop long.").nullable().optional(),
  }),
  z.object({ action: z.literal("principale"), nature: z.enum(["email", "telephone"]) }),
  z.object({
    action: z.literal("archiver"),
    nature: z.enum(["email", "telephone"]),
    motif: z.string("Motif obligatoire.").trim().min(3, "Motif obligatoire.").max(300),
  }),
]);

/** POST { action: "principale" | "archiver" | "modifier", nature, motif?, valeur?, libelle? } */
export async function POST(
  requete: NextRequest,
  { params }: { params: Promise<{ id: string; coordonneeId: string }> }
) {
  try {
    const { id, coordonneeId } = await params;
    const demande = analyser(schema, await lireCorpsJson(requete));
    if (demande.action === "principale") await definirPrincipale(id, demande.nature, coordonneeId);
    else if (demande.action === "modifier") await modifierCoordonnee(id, demande.nature, coordonneeId, { valeur: demande.valeur, libelle: demande.libelle });
    else await archiverCoordonnee(id, demande.nature, coordonneeId, demande.motif);
    return NextResponse.json({ client: await chargerFiche(id) });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/coordonnees/[coordonneeId]");
  }
}
