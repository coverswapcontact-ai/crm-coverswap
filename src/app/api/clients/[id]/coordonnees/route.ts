import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { ajouterCoordonnee, chargerFiche } from "@/lib/clients/fiches";

const schema = z.object({
  nature: z.enum(["email", "telephone"], "Type de coordonnée invalide."),
  valeur: z.string("Valeur manquante.").trim().min(1, "Valeur manquante.").max(160),
  libelle: z
    .string()
    .trim()
    .max(40, "Libellé trop long.")
    .nullable()
    .optional()
    .transform((valeur) => valeur || null),
});

/** POST { nature, valeur, libelle? } : ajoute une adresse ou un numéro à la fiche. */
export async function POST(requete: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { nature, valeur, libelle } = analyser(schema, await lireCorpsJson(requete));
    await ajouterCoordonnee(id, nature, valeur, libelle);
    return NextResponse.json({ client: await chargerFiche(id) }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/clients/[id]/coordonnees");
  }
}
