"use client";

import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A4) — les segments d'une liste (Chez moi · Chez le client · Tous · Archives ; À appeler · À rappeler ·
 * Clients · Sans suite · Archivés) : des boutons de 44 px en phrases, un seul actif, qui défilent sur une ligne au
 * téléphone. Aucun compteur, aucun badge (règle 8 de docs/CRM-V2.md) ; le seul mouvement est `TRANS_V2`.
 */
export const SEGMENT = (actif: boolean) => cn("inline-flex h-11 shrink-0 items-center justify-center rounded-full border px-4 text-corps font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", actif ? "border-action bg-action-fond text-action-clair" : "border-trait bg-surface text-texte-2 hover:bg-surface-2", TRANS_V2);

export function Segments<T extends string>({ libelle, options, actif, onChoisir }: { libelle: string; options: readonly { valeur: T; libelle: string }[]; actif: T; onChoisir: (valeur: T) => void }) {
  return (
    <div role="group" aria-label={libelle} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      {options.map((option) => (
        <button key={option.valeur} type="button" aria-pressed={actif === option.valeur} onClick={() => onChoisir(option.valeur)} className={SEGMENT(actif === option.valeur)}>
          {option.libelle}
        </button>
      ))}
    </div>
  );
}
