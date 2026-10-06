import { toast } from "sonner";

/**
 * Mission 22 (A2) — chaque geste répond (règle 6 de docs/CRM-V2.md) : une ligne écrite, et « Annuler » pendant 5 s.
 * Le `Toaster` de la racine la rend. Pour une réponse à une tâche, l'effet part à 6 s côté serveur
 * (`lib/a-faire/reponses.ts › DELAI_EFFET_MS`) et `POST /api/a-faire/<id>/annuler` le défait encore après : le bouton
 * reste donc sûr jusqu'à la dernière seconde.
 */
export const DUREE_ANNULATION_MS = 5_000;

export function toastAnnulable(message: string, annuler: () => void, description?: string): void {
  toast.success(message, { description, duration: DUREE_ANNULATION_MS, action: { label: "Annuler", onClick: () => annuler() } });
}
