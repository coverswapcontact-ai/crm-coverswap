"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Bouton } from "@/components/pilotage/ui";

/** Mission 13 (lot 7) : monter, descendre ou supprimer une ligne du générateur de document. */
export function ActionsLigne({
  premiere,
  derniere,
  onMonter,
  onDescendre,
  onSupprimer,
}: {
  premiere: boolean;
  derniere: boolean;
  onMonter: () => void;
  onDescendre: () => void;
  onSupprimer: () => void;
}) {
  return (
    <span className="flex shrink-0 justify-end gap-1">
      <Bouton variante="fantome" taille="icone" aria-label="Monter la ligne" disabled={premiere} onClick={onMonter}>
        <ArrowUp size={14} />
      </Bouton>
      <Bouton variante="fantome" taille="icone" aria-label="Descendre la ligne" disabled={derniere} onClick={onDescendre}>
        <ArrowDown size={14} />
      </Bouton>
      <Bouton variante="fantome" taille="icone" aria-label="Supprimer la ligne" onClick={onSupprimer}>
        <Trash2 size={14} />
      </Bouton>
    </span>
  );
}
