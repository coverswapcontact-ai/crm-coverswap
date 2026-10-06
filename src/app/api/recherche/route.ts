import { NextResponse, type NextRequest } from "next/server";
import { chercherContacts } from "@/lib/assistant/recherche";
import { reponseErreur } from "@/lib/commun/api";
import { ErreurMetier } from "@/lib/commun/erreurs";

export const dynamic = "force-dynamic";

/** Deux caractères au moins : une lettre seule ramènerait la moitié de la base. */
export const LONGUEUR_MIN = 2;

/**
 * Mission 22 — la recherche globale de la coque v2 (⌘K / Ctrl K, loupe) : `GET /api/recherche?q=` rend les candidats
 * de `chercherContacts` (la même fonction que l'outil `chercher` du connecteur) — dossier, client ou lead, par nom,
 * téléphone, e-mail, adresse, ville ou numéro de devis / facture — avec le `chemin` à ouvrir. Huit résultats au plus.
 */
export async function GET(requete: NextRequest) {
  try {
    const q = (new URL(requete.url).searchParams.get("q") ?? "").trim();
    if (q.length < LONGUEUR_MIN) throw new ErreurMetier(`Tape ${LONGUEUR_MIN} caractères au moins.`, 400);
    const resultats = await chercherContacts(q, { limite: 8 });
    return NextResponse.json({ resultats });
  } catch (erreur) {
    return reponseErreur(erreur, "GET /api/recherche");
  }
}
