"use client";

import type { GesteEspace } from "@/lib/espace/vue-crm";

/** Mission 13 (lot 7) : ce que partagent `EspaceDossier` et ses rubriques — la rubrique elle-même, un geste fait à la place du client, la confirmation d'un geste qui défait. */

/** Un geste fait à la place du client, tel qu'`EspaceDossier` l'envoie : vrai s'il a abouti. */
export type FaireGeste = (g: GesteEspace, succes: string) => Promise<boolean>;

/** Un geste qui défait quelque chose : confirmé dans une petite fenêtre avant de partir. */
export type ConfirmationEspace = { titre: string; texte: string; bouton: string; geste: GesteEspace; succes: string };

/** Une rubrique du bloc : titre, pastille d'état à droite, contenu. */
export function Rubrique({ titre, etat, id, children }: { titre: string; etat?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="border-t-[0.5px] border-[#2A2D34] pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium tracking-[0.06em] text-[#8B919C] uppercase">{titre}</h4>
        {etat}
      </div>
      {children}
    </div>
  );
}
