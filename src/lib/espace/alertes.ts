import { alerter } from "@/lib/alertes/canaux";

/**
 * Ce que l'espace client dit à Lucas (téléphone, Telegram, notification de
 * l'application) et sous quel nom il écrit dans la base. Le client n'a pas de
 * session : ses écritures sont celles d'un appel externe, nommé (le journal sait
 * que c'est lui).
 */
export const ACTEUR = { acteur: "EXTERNE:espace-client", origine: "espace-client" } as const;

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");
/** Mission 13 (lot 4) : `rubrique` (photos, messages, devis, encaisser, historique, etape) ouvre le panneau dessus. */
export const lienDossier = (dossierId: string, rubrique?: string | null) => `${appUrl()}/dossiers?dossier=${dossierId}${rubrique ? `&rubrique=${rubrique}` : ""}`;
const CANAUX_POUSSES = ["telegram", "ntfy", "pushweb"] as const;

export async function prevenir(dossierId: string, alerte: { titre: string; texte: string; urgence: 1 | 2 | 3 | 4 | 5; telephone?: string | null; etiquette?: string; rubrique?: string | null }, origine = "espace-client"): Promise<void> {
  try {
    await alerter(
      { titre: alerte.titre, texte: alerte.texte, lien: lienDossier(dossierId, alerte.rubrique), libelleLien: "Ouvrir le dossier", telephone: alerte.telephone || undefined, urgence: alerte.urgence, etiquette: alerte.etiquette ?? `espace-${dossierId}` },
      { origine, canaux: [...CANAUX_POUSSES] }
    );
  } catch (erreur) {
    console.error(`[espace] alerte « ${alerte.titre} » non envoyée :`, erreur);
  }
}
