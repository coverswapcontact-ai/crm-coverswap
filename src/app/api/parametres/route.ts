import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { analyser, lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { dateDepuisJour, estJourValide } from "@/lib/dossiers/dates";
import { enregistrerParametre, parametresPourEcran } from "@/lib/parametres/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ parametres: await parametresPourEcran() });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/parametres");
  }
}

const saisie = z.object({
  cle: z.string("Paramètre manquant.").min(1).max(60),
  valeur: z.union([z.number(), z.string()], "Valeur manquante."),
  valableDu: z.string("Date d'effet invalide.").refine(estJourValide, "Date d'effet invalide."),
  source: z.string().trim().max(300, "Source trop longue.").nullable().optional(),
});

const schema = z.object({ saisies: z.array(saisie).min(1, "Aucune valeur saisie.").max(30) });

/** POST { saisies: [{ cle, valeur, valableDu, source? }] } : nouvelles valeurs datées (les anciennes restent). */
export async function POST(requete: NextRequest) {
  try {
    const { saisies } = analyser(schema, await lireCorpsJson(requete));
    for (const ligne of saisies) {
      await enregistrerParametre({ ...ligne, valableDu: dateDepuisJour(ligne.valableDu) });
    }
    return NextResponse.json({ parametres: await parametresPourEcran() }, { status: 201 });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/parametres");
  }
}
