"use client";

import { useState } from "react";
import { LIBELLES_FAMILLE, type EcranSite, type Famille } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import { DEGRADE_TUNNEL, NUM } from "./base";
import { formaterValeur } from "./format";

/**
 * Mission 17 (partie B, relecture) — l'entonnoir du simulateur en sept étapes (visite, pièce, photo, génération,
 * résultat vu, estimation facultative, contact), repris de l'ancien bloc « Sur le site cette semaine » de Leads (son
 * composant `Entonnoir`) aux couleurs de l'Analytique : une barre par étape rapportée à la première, le nombre de
 * parcours, et en ambre ceux de l'étape d'avant qui se sont arrêtés là (jamais de rouge). Le choix « Toutes » ou une
 * famille de source (première provenance connue du parcours) change l'entonnoir sur place.
 */

type Entonnoir = EcranSite["simulateur"][number];

const nombre = (valeur: number) => formaterValeur(valeur, "nombre");

export function libelleChoix(famille: Entonnoir["famille"]): string {
  return famille === "toutes" ? "Toutes" : LIBELLES_FAMILLE[famille as Famille];
}

export function EntonnoirSimulateur({ simulateur }: { simulateur: EcranSite["simulateur"] }) {
  const [choix, setChoix] = useState<Entonnoir["famille"]>("toutes");
  const courant = simulateur.find((entonnoir) => entonnoir.famille === choix) ?? simulateur[0];
  if (!courant) return <p className="text-[13px] text-texte-3">Aucun parcours du simulateur sur la période.</p>;
  const reference = Math.max(courant.etapes[0]?.parcours ?? 0, 1);
  const vide = (courant.etapes[0]?.parcours ?? 0) === 0;
  return (
    <div className="flex flex-col gap-3.5">
      {simulateur.length > 1 ? (
        <div role="group" aria-label="Source des visites" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
          {simulateur.map((entonnoir) => {
            const actif = entonnoir.famille === courant.famille;
            return (
              <button
                key={entonnoir.famille}
                type="button"
                aria-pressed={actif}
                onClick={() => setChoix(entonnoir.famille)}
                className={cn(
                  "flex h-[34px] shrink-0 items-center gap-1.5 rounded-[17px] border px-[13px] text-[13px] font-medium whitespace-nowrap transition-colors duration-150 md:h-8 md:rounded-[8px]",
                  actif ? "border-texte bg-texte text-texte-inverse md:border-trait-2 md:bg-surface-2 md:text-texte" : "border-trait bg-surface text-texte-3 hover:text-texte"
                )}
              >
                {libelleChoix(entonnoir.famille)}
                <span className={cn(NUM, actif ? "opacity-70" : "text-texte-3")}>{nombre(entonnoir.etapes[0]?.parcours ?? 0)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {vide ? (
        <p className="text-[13px] text-texte-3">Aucun parcours venu de «&nbsp;{libelleChoix(courant.famille)}&nbsp;» sur la période.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={courant.famille === "toutes" ? "Entonnoir du simulateur" : `Entonnoir du simulateur, visites « ${libelleChoix(courant.famille)} »`}>
          {courant.etapes.map((etape, index) => (
            <li key={etape.cle} className="flex flex-col gap-1.5" data-etape-simulateur={etape.cle}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className={etape.facultative ? "text-texte-3" : "text-texte-2"} title={etape.facultative ? "Étape facultative : la demande part aussi sans elle" : undefined}>
                  {etape.libelle}
                  {etape.facultative ? <span className="text-texte-3"> (facultative)</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-2.5">
                  {etape.abandons ? (
                    <span className="text-[12px] text-attention-texte" title={`${etape.abandons} parcours arrêtés à cette étape`}>
                      −{nombre(etape.abandons)}
                      <span className="sr-only"> parcours arrêtés ici</span>
                    </span>
                  ) : null}
                  <span className={cn(NUM, "font-semibold text-texte")}>{nombre(etape.parcours)}</span>
                </span>
              </div>
              <div className="h-2 rounded-[4px] bg-surface-2">
                {etape.parcours > 0 ? (
                  <div
                    className="h-2 rounded-[4px]"
                    style={{
                      width: `${Math.max(1.5, Math.min(1, etape.parcours / reference) * 100)}%`,
                      background: etape.facultative ? "var(--color-trait-2)" : DEGRADE_TUNNEL[Math.min(index, DEGRADE_TUNNEL.length - 1)],
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[12px] text-texte-3">
        <span className="text-attention-texte">−n</span>&nbsp;: parcours de l&apos;étape d&apos;avant arrêtés à cette étape. Un parcours compte à une étape s&apos;il a atteint la précédente.
      </p>
    </div>
  );
}
