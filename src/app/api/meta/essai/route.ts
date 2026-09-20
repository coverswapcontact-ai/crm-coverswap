import { NextResponse, type NextRequest } from "next/server";
import { lireCorpsJson, reponseErreur } from "@/lib/commun/api";
import { lancerEssaiMeta } from "@/lib/meta/essai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Mode d'essai de l'intégration Meta : simule un formulaire rempli et prouve
 * que le contact arrive en base avec tous ses champs. Réservé aux personnes
 * connectées (le proxy refuse tout le reste).
 *
 * Corps : { notifier?: boolean } — `false` pour ne pas envoyer la notification.
 */
export async function POST(requete: NextRequest) {
  try {
    const corps = (await lireCorpsJson(requete).catch(() => ({}))) as { notifier?: unknown };
    const rapport = await lancerEssaiMeta({ notifier: corps?.notifier !== false });
    return NextResponse.json({ rapport });
  } catch (erreur) {
    return reponseErreur(erreur, "POST /api/meta/essai");
  }
}
