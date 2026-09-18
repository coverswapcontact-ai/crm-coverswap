import { Resend } from "resend";

/**
 * Ce que le visiteur du simulateur lit quand la génération échoue, et l'alerte
 * interne quand la panne est chez nous. Un crédit OpenAI épuisé ne doit jamais
 * être présenté comme un défaut de la photo : la personne doit comprendre et
 * pouvoir laisser ses coordonnées (le site garde sa photo et ses choix).
 *
 * Même classement côté site (coverswap : src/lib/simulateur/erreurs-generation.ts).
 */
export type RaisonEchec = "service-indisponible" | "photo-refusee" | "surcharge" | "delai" | "erreur";

export const MESSAGES_ECHEC: Record<RaisonEchec, string> = {
  "service-indisponible":
    "Le simulateur est momentanément indisponible de notre côté — ni votre photo ni votre connexion ne sont en cause. Votre photo et vos choix sont conservés : laissez-nous vos coordonnées, nous réalisons la simulation pour vous et vous l'envoyons avec votre devis.",
  "photo-refusee": "Cette photo n'a pas pu être traitée (trop sombre, floue, ou contenu refusé par le service d'image). Essayez une autre photo, de face et bien éclairée — ou laissez-nous vos coordonnées, nous ferons la simulation pour vous.",
  surcharge: "Le service d'image est très sollicité à l'instant. Votre photo et vos choix sont conservés : réessayez dans une minute, ou laissez-nous vos coordonnées et nous vous envoyons la simulation.",
  delai: "La génération a pris trop de temps. Votre photo et vos choix sont conservés : réessayez, ou laissez-nous vos coordonnées et nous vous envoyons la simulation.",
  erreur: "La génération n'a pas abouti. Votre photo et vos choix sont conservés : réessayez, ou laissez-nous vos coordonnées et nous vous envoyons la simulation.",
};

/** Classe une réponse d'erreur de l'API d'images d'OpenAI (statut HTTP + corps brut). */
export function classerErreurOpenAI(statut: number | undefined, corps: string | undefined): RaisonEchec {
  const texte = (corps ?? "").toLowerCase();
  // Crédit épuisé, plafond de facturation, compte inactif, clé refusée, organisation non vérifiée : c'est chez nous.
  if (/insufficient_quota|credit_balance|no credits|billing|exceeded your current quota|account_deactivated|invalid_api_key|incorrect api key|must be verified|access_terminated/.test(texte)) return "service-indisponible";
  if (statut === 401 || statut === 403) return "service-indisponible";
  if (statut === 429) return "surcharge";
  if (statut === 400) return /moderation|safety|content_policy|invalid_image|image_|unsupported|too large|could not process/.test(texte) ? "photo-refusee" : "erreur";
  if (statut !== undefined && statut >= 500) return "surcharge";
  return "erreur";
}

const DELAI_ENTRE_ALERTES_MS = 6 * 60 * 60 * 1000;
let derniereAlerte = 0;

/**
 * Prévient le gérant que le simulateur est en panne de notre côté (crédit, clé).
 * Mail interne, au plus un toutes les six heures ; ne bloque jamais la réponse au visiteur.
 */
export async function alerterPanneSimulateur(statut: number | undefined, detail: string, maintenant = Date.now()): Promise<boolean> {
  if (maintenant - derniereAlerte < DELAI_ENTRE_ALERTES_MS) return false;
  if (!process.env.RESEND_API_KEY) return false;
  derniereAlerte = maintenant;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.EMAIL_FROM || "CoverSwap <onboarding@resend.dev>",
      to: process.env.LEAD_NOTIFICATION_EMAIL || "contact@coverswap.fr",
      subject: "Simulateur en panne : crédit ou clé OpenAI à vérifier",
      html: `<p>Le simulateur de coverswap.fr vient de refuser une génération pour une raison qui est de notre côté (crédit OpenAI épuisé, plafond de facturation, clé refusée).</p>
<p><strong>Réponse d'OpenAI</strong> (HTTP ${statut ?? "?"}) : ${detail.replace(/[<>]/g, "").slice(0, 300)}</p>
<p>Les visiteurs voient un message clair et peuvent laisser leurs coordonnées avec leur photo : ces demandes arrivent dans Prospects avec la mention « simulation à réaliser ». À faire : recharger le crédit sur platform.openai.com (Billing), puis vérifier une simulation.</p>
<p>Prochaine alerte au plus tôt dans six heures.</p>`,
    });
    return true;
  } catch (e) {
    console.error("[simulate] alerte de panne non envoyée :", e);
    return false;
  }
}

/** Pour les essais. */
export function reinitialiserAlerte(): void {
  derniereAlerte = 0;
}
