/**
 * Mission 25 — les notifications de la messagerie sur le téléphone de Lucas : les notifications du CRM installé sur
 * l'écran d'accueil (push web), jamais Telegram (décision du 10/10). Un appui ouvre la carte.
 */
import { alerter } from "@/lib/alertes/canaux";

export type AlerteMessagerie = {
  titre: string;
  texte: string;
  /** Chemin dans le CRM (« /messagerie?message=… »). */
  chemin: string;
  libelleLien?: string;
  telephone?: string | null;
  urgence?: 1 | 2 | 3 | 4 | 5;
  etiquette?: string;
  origine: string;
};

const CLE_ESSAI = "__coverswapAlertesMessagerieEssai";
const globalEssai = globalThis as unknown as Record<string, ((alerte: AlerteMessagerie) => void) | undefined>;

/** Essais seulement : recueille les alertes au lieu de les envoyer. */
export function definirAlertesEssai(recueil: ((alerte: AlerteMessagerie) => void) | null): void {
  globalEssai[CLE_ESSAI] = recueil ?? undefined;
}

export const adresseCrm = (chemin: string) => `${process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr"}${chemin}`;

export async function prevenirLucas(alerte: AlerteMessagerie): Promise<void> {
  const essai = globalEssai[CLE_ESSAI];
  if (essai) {
    essai(alerte);
    return;
  }
  try {
    await alerter(
      { titre: alerte.titre, texte: alerte.texte, lien: adresseCrm(alerte.chemin), libelleLien: alerte.libelleLien ?? "Ouvrir", telephone: alerte.telephone ?? undefined, urgence: alerte.urgence ?? 3, etiquette: alerte.etiquette },
      { canaux: ["pushweb"], origine: alerte.origine }
    );
  } catch (erreur) {
    console.error("[messagerie] notification non envoyée :", erreur);
  }
}
