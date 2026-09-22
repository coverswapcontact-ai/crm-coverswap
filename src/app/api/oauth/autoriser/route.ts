import { NextResponse, type NextRequest } from "next/server";
import { adresseCrm } from "@/lib/assistant/definition";
import { reponseErreurOAuth } from "@/lib/oauth/reponses";
import { utilisateurConnecte } from "@/lib/oauth/session";
import { ErreurOAuth, accorder, demandeAutorisation, refuser } from "@/lib/oauth/serveur";

export const dynamic = "force-dynamic";

/**
 * Décision de Lucas sur la page de consentement (formulaire). Route PRIVÉE :
 * le proxy exige la session du CRM ; l'origine de la requête doit être le CRM
 * lui-même (pas de formulaire posé ailleurs).
 */
export async function POST(requete: NextRequest) {
  try {
    const origine = requete.headers.get("origin") ?? (requete.headers.get("referer") ? new URL(requete.headers.get("referer")!).origin : null);
    const attendue = new URL(adresseCrm()).origin;
    const hote = requete.headers.get("host");
    if (!origine || (origine !== attendue && new URL(origine).host !== hote)) throw new ErreurOAuth("invalid_request", "Le consentement ne peut être donné que depuis la page du CRM.", 403);
    const utilisateur = await utilisateurConnecte();
    if (!utilisateur) throw new ErreurOAuth("access_denied", "Connexion au CRM requise.", 401);
    const form = await requete.formData();
    const champs: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === "string") champs[k] = v;
    const demande = await demandeAutorisation(champs);
    const destination = champs.decision === "accorder" ? await accorder(demande, utilisateur) : refuser(demande);
    return NextResponse.redirect(destination, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch (erreur) {
    return reponseErreurOAuth(erreur, "POST /api/oauth/autoriser");
  }
}
