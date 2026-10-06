"use client";

import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import { FondBalayage, useBalayage } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, ligneGrise, marcheASuivre } from "@/lib/a-faire/affichage";
import { gestePret, libelleBalayageDroite } from "@/lib/v2/geste-pret";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { TRANS_V2 } from "../transitions";
import { BoutonGeste } from "./BoutonGeste";

/**
 * Mission 22 (A2) — « Maintenant » : la première tâche du jour en grand, extraite du corps du mode « Commencer »
 * (`ModeTaches.tsx`, intouché) et posée en haut d'Aujourd'hui, sans plein écran ni « n sur N ». Le verbe et la
 * personne (24 px), la raison en une phrase, la marche à suivre s'il y en a une, la durée, puis l'unique bouton
 * principal (vert) = le geste prêt, et les réponses en contour : Fait, Plus tard, Pas à faire (une proposition :
 * Valider en principal, Ignorer à côté). Balayer à droite = Fait (ou Relire), à gauche = Plus tard. Deux tailles de
 * texte (grand, corps) ; zones de 44 px ; jetons seulement ; le seul mouvement est `TRANS_V2`.
 */
export function CarteTache({ tache, maintenant, occupe, actions, onPasAFaire }: { tache: TacheVue; maintenant: number; occupe: boolean; actions: ActionsLigne; onPasAFaire: (tache: TacheVue) => void }) {
  const geste = gestePret(tache);
  const marche = marcheASuivre(tache);
  const balayage = useBalayage({ onDroite: () => actions.onFait(tache), onGauche: () => actions.onPlusTard(tache), bloque: occupe });
  // Trois réponses sur une ligne à 390 px : des mots, sans icône, qui ne se coupent pas.
  const secondaire = cn(BOUTON_SECONDAIRE, "flex-1 px-2 whitespace-nowrap");
  const montrerFait = geste.forme === "APPEL" || geste.forme === "LIEN_EXTERNE" || geste.forme === "ACTION";

  return (
    <section aria-labelledby="maintenant-titre" data-tache={tache.id} className={cn("relative overflow-hidden rounded-[11px] border border-trait bg-surface", occupe && "opacity-60")}>
      <FondBalayage decalage={balayage.decalage} droite={libelleBalayageDroite(tache)} arrondi="rounded-[11px]" />
      <div {...balayage.gestionnaires} style={balayage.style} className="relative bg-surface p-4">
        <p className="text-corps-tel text-texte-3 md:text-corps">Maintenant · environ {dureeLisible(tache.dureeMin)}</p>
        <h2 id="maintenant-titre" className="mt-1 text-grand leading-tight font-semibold break-words text-texte">
          {tache.titre}
        </h2>
        <p className="mt-1 text-corps-tel leading-snug text-texte-2 md:text-corps">{ligneGrise(tache, new Date(maintenant))}</p>
        {marche ? <p className="mt-3 rounded-[8px] border border-trait bg-fond px-3 py-2 text-corps-tel leading-relaxed break-words text-texte-2 md:text-corps">Marche à suivre : {marche}</p> : null}

        <div className="mt-4">
          <BoutonGeste tache={tache} actions={actions} forme="principale" disabled={occupe} />
        </div>

        <div className="mt-3 flex gap-2">
          {geste.forme === "VALIDER" ? (
            <button type="button" disabled={occupe} onClick={() => actions.onIgnorer(tache)} className={secondaire}>
              Ignorer
            </button>
          ) : null}
          {montrerFait ? (
            <button type="button" disabled={occupe} onClick={() => actions.onFait(tache)} className={secondaire}>
              Fait
            </button>
          ) : null}
          <button type="button" disabled={occupe} onClick={() => actions.onPlusTard(tache)} className={secondaire}>
            Plus tard
          </button>
          {geste.forme !== "VALIDER" ? (
            <button type="button" disabled={occupe} onClick={() => onPasAFaire(tache)} className={secondaire}>
              Pas à faire
            </button>
          ) : null}
        </div>
        <p className={cn("mt-3 text-center text-corps text-texte-3 pointer-fine:hidden", TRANS_V2)}>Balayer à droite : {libelleBalayageDroite(tache).toLowerCase()} · à gauche : plus tard</p>
      </div>
    </section>
  );
}
