"use client";

import { useState } from "react";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { TacheVue } from "@/lib/a-faire/types";
import { ENSUITE_VISIBLES, libelleVoirAutres } from "@/lib/v2/aujourdhui";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { CLASSE_LISTE_V2, LigneTacheV2 } from "../taches/LigneV2";

/**
 * Mission 22 (A3) — « À faire ici » : les tâches du dossier (servies avec son détail, Aujourd'hui puis Plus tard), en
 * lignes v2 (`LigneTacheV2` : titre, durée · raison, le bouton du geste en contour, « … » = Fait, Plus tard, Pas à
 * faire ; balayage conservé). Mêmes gestes qu'Aujourd'hui (`useGestesTaches`), même ligne de réponse avec « Annuler ».
 * Cinq lignes puis « Voir les N autres » ; rien quand le dossier n'a pas de tâche.
 */
export function AFaireIci({ taches, maintenant, occupees, surbrillance, actions }: { taches: TacheVue[]; maintenant: number; occupees: Set<string>; surbrillance: string | null; actions: ActionsLigne }) {
  const [tout, setTout] = useState(false);
  if (taches.length === 0) return null;
  const visibles = tout ? taches : taches.slice(0, ENSUITE_VISIBLES);
  return (
    <section aria-labelledby="a-faire-ici-titre" className="flex flex-col gap-2">
      <h2 id="a-faire-ici-titre" className="px-1 text-titre font-semibold text-texte">
        À faire ici <span className="text-texte-3">· {taches.length}</span>
      </h2>
      <ul className={CLASSE_LISTE_V2}>
        {visibles.map((tache) => (
          <LigneTacheV2 key={tache.id} tache={tache} maintenant={maintenant} surbrillance={surbrillance === tache.id} occupe={occupees.has(tache.id)} actions={actions} />
        ))}
      </ul>
      {taches.length > visibles.length ? (
        <button type="button" onClick={() => setTout(true)} className={cn(BOUTON_SECONDAIRE, "self-start")}>
          {libelleVoirAutres(taches.length - visibles.length)}
        </button>
      ) : null}
    </section>
  );
}
