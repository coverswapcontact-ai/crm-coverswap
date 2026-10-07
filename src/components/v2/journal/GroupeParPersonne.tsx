"use client";

import { useState } from "react";
import Link from "next/link";
import type { EntreeJournal } from "@/lib/chronologie/journal-types";
import { libelleVoirAutres } from "@/lib/v2/aujourdhui";
import { LIGNES_GROUPE_VISIBLES, type GroupeJournal } from "@/lib/v2/journal";
import { dateExacte, dateRelative } from "@/lib/v2/dates";
import { phraseV2 } from "@/lib/v2/phrases";
import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A1) — un groupe du journal : la personne (lien vers sa fiche, son lead ou son dossier), puis ses lignes,
 * chacune une phrase, sa date relative (la date exacte au survol ou à l'appui long) et l'ouverture du bon écran.
 * Une proposition à valider porte ses deux gestes (Valider, Ignorer) ; la réponse écrite est rendue par le parent.
 * Deux tailles de texte par carte (corps, petit) ; zones de 44 px ; jetons seulement ; aucun mouvement hors `TRANS_V2`.
 */
export const BOUTON_SECONDAIRE = cn("inline-flex h-11 items-center justify-center rounded-[8px] border border-trait-2 bg-surface px-4 text-corps font-medium text-texte hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50", TRANS_V2);

export type GesteProposition = "valider" | "ignorer";

export function GroupeParPersonne({ groupe, maintenant, enAttente, onGeste }: { groupe: GroupeJournal; maintenant: Date; enAttente: ReadonlySet<string>; onGeste: (entree: EntreeJournal, geste: GesteProposition) => void }) {
  // Correctifs du 07/10 (É13) : cinq lignes par personne, puis « Voir les N autres ».
  const [tout, setTout] = useState(false);
  const visibles = tout ? groupe.entrees : groupe.entrees.slice(0, LIGNES_GROUPE_VISIBLES);
  return (
    <section aria-labelledby={`journal-${groupe.cle}`} className="rounded-[11px] border border-trait bg-surface p-4">
      <h2 id={`journal-${groupe.cle}`} className="text-corps-tel font-semibold text-texte md:text-corps">
        {groupe.lien ? (
          <Link href={groupe.lien} className={cn("inline-flex min-h-11 items-center rounded-[6px] hover:text-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2)}>
            {groupe.nom}
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center">{groupe.nom}</span>
        )}
      </h2>
      <ul className="mt-1 flex flex-col divide-y divide-trait/60">
        {visibles.map((e) => (
          <Ligne key={e.id} entree={e} maintenant={maintenant} enAttente={enAttente.has(e.id)} onGeste={onGeste} />
        ))}
      </ul>
      {groupe.entrees.length > visibles.length ? (
        <button type="button" className={cn(BOUTON_SECONDAIRE, "mt-2")} onClick={() => setTout(true)}>
          {libelleVoirAutres(groupe.entrees.length - visibles.length)}
        </button>
      ) : null}
    </section>
  );
}

function Ligne({ entree: e, maintenant, enAttente, onGeste }: { entree: EntreeJournal; maintenant: Date; enAttente: boolean; onGeste: (entree: EntreeJournal, geste: GesteProposition) => void }) {
  const phrase = `${phraseV2(e.titre, maintenant)}${e.texte ? ` — ${phraseV2(e.texte, maintenant)}` : ""}${e.occurrences > 1 ? `, ${e.occurrences} fois` : ""}`;
  const quand = (
    <time dateTime={e.le} title={dateExacte(e.le)} className="shrink-0 text-petit text-texte-3">
      {dateRelative(e.le, maintenant)}
    </time>
  );
  return (
    <li className="flex flex-col gap-2 py-2">
      {e.lien ? (
        <Link href={e.lien} className={cn("flex min-h-11 items-baseline justify-between gap-3 rounded-[6px] text-corps-tel text-texte-2 hover:text-texte focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none md:text-corps", TRANS_V2)}>
          <span>{phrase}</span>
          {quand}
        </Link>
      ) : (
        <div className="flex min-h-11 items-baseline justify-between gap-3 text-corps-tel text-texte-2 md:text-corps">
          <span>{phrase}</span>
          {quand}
        </div>
      )}
      {e.gestes && !enAttente ? (
        <div className="flex gap-2">
          <button type="button" className={BOUTON_SECONDAIRE} onClick={() => onGeste(e, "valider")}>
            Valider
          </button>
          <button type="button" className={BOUTON_SECONDAIRE} onClick={() => onGeste(e, "ignorer")}>
            Ignorer
          </button>
        </div>
      ) : null}
    </li>
  );
}
