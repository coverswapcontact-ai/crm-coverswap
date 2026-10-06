import { MESSAGE_ESSAI_LOCAL, essaiLocal } from "@/lib/acces/essai-local";

/**
 * Mission 22 — « Base d'essai — rien ne part » : une ligne ambre de 44 px en haut de chaque écran quand la garde
 * `CRM_ESSAI_LOCAL=1` est posée (lib/acces/essai-local.ts). Visible en v1 comme en v2 : c'est une sécurité, pas un
 * écran. Composant serveur, aucune animation.
 */
export function BandeauEssai() {
  if (!essaiLocal()) return null;
  return (
    <div role="status" className="flex min-h-[44px] items-center justify-center bg-attention px-4 text-center text-corps font-medium text-texte-inverse">
      {MESSAGE_ESSAI_LOCAL}
    </div>
  );
}
