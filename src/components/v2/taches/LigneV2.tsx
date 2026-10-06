"use client";

import { Check, MoreHorizontal, X } from "lucide-react";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import { FondBalayage, useBalayage } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, ligneFaite, ligneGrise } from "@/lib/a-faire/affichage";
import { libelleBalayageDroite } from "@/lib/v2/geste-pret";
import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";
import { BoutonGeste } from "./BoutonGeste";

/**
 * Mission 22 (A2) — une ligne d'« Ensuite » ou de « Plus tard », plus sobre que la ligne v1 : le titre, la phrase
 * (durée et raison), le bouton du geste en contour, et « … » (Fait, Plus tard, Pas à faire). Toucher la ligne ouvre la
 * fiche. Sur téléphone : balayer à droite = Fait (ou Relire), à gauche = Plus tard (`useBalayage`, conservé). Deux
 * tailles de texte (corps, petit) ; zones de 44 px ; le seul mouvement est `TRANS_V2`.
 */
export const CLASSE_LISTE_V2 = "overflow-hidden rounded-[11px] border border-trait bg-surface";

export function LigneTacheV2({ tache, maintenant, surbrillance, occupe, actions }: { tache: TacheVue; maintenant: number; surbrillance: boolean; occupe: boolean; actions: ActionsLigne }) {
  const balayage = useBalayage({ onDroite: () => actions.onFait(tache), onGauche: () => actions.onPlusTard(tache), bloque: occupe });
  return (
    <li data-tache={tache.id} className={cn("relative overflow-hidden border-t border-trait first:border-t-0", occupe && "opacity-60")}>
      <FondBalayage decalage={balayage.decalage} droite={libelleBalayageDroite(tache)} />
      <div {...balayage.gestionnaires} style={balayage.style} className={cn("relative flex items-center gap-2 bg-surface py-1 pr-2", surbrillance && "bg-action-fond")}>
        <button type="button" onClick={() => actions.onOuvrir(tache)} className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-4 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TRANS_V2)}>
          <span className="line-clamp-2 text-corps-tel leading-snug font-medium break-words text-texte md:text-corps">{tache.titre}</span>
          <span className="line-clamp-2 text-petit leading-snug break-words text-texte-3">
            {dureeLisible(tache.dureeMin)} · {ligneGrise(tache, new Date(maintenant))}
          </span>
        </button>
        <BoutonGeste tache={tache} actions={actions} forme="ligne" disabled={occupe} />
        <button type="button" onClick={() => actions.onMenu(tache)} aria-label={`Répondre : ${tache.titre}`} title="Fait, Plus tard, Pas à faire" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-texte-3 hover:bg-surface-2 hover:text-texte focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2)}>
          <MoreHorizontal size={20} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** Une ligne de « Fait aujourd'hui » : la coche (ou la croix), le titre, et pourquoi (la preuve lue par le CRM, ou qui a répondu). */
export function LigneFaiteV2({ tache }: { tache: TacheVue }) {
  const pasAFaire = tache.statut === "PAS_A_FAIRE";
  return (
    <li className="flex min-h-11 items-center gap-3 border-t border-trait px-4 py-2 first:border-t-0">
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]", pasAFaire ? "bg-surface-2 text-texte-3" : "bg-action-fond text-action-clair")}>{pasAFaire ? <X size={14} aria-hidden /> : <Check size={14} aria-hidden />}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-corps-tel md:text-corps", pasAFaire ? "text-texte-3" : "text-texte-2")}>{tache.titre}</span>
        <span className="block truncate text-petit text-texte-3">{ligneFaite(tache)}</span>
      </span>
    </li>
  );
}
