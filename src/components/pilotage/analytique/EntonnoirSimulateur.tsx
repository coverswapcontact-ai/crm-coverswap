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
  if (!courant) return <p className="text-[13px] text-[#6B7280]">Aucun parcours du simulateur sur la période.</p>;
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
                  actif ? "border-[#F2F3F5] bg-[#F2F3F5] text-[#16181D] md:border-[#3A3E47] md:bg-[#22262D] md:text-[#F2F3F5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:text-[#F2F3F5]"
                )}
              >
                {libelleChoix(entonnoir.famille)}
                <span className={cn(NUM, actif ? "opacity-70" : "text-[#6B7280]")}>{nombre(entonnoir.etapes[0]?.parcours ?? 0)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {vide ? (
        <p className="text-[13px] text-[#6B7280]">Aucun parcours venu de «&nbsp;{libelleChoix(courant.famille)}&nbsp;» sur la période.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={courant.famille === "toutes" ? "Entonnoir du simulateur" : `Entonnoir du simulateur, visites « ${libelleChoix(courant.famille)} »`}>
          {courant.etapes.map((etape, index) => (
            <li key={etape.cle} className="flex flex-col gap-1.5" data-etape-simulateur={etape.cle}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className={etape.facultative ? "text-[#9CA3AF]" : "text-[#D1D5DB]"} title={etape.facultative ? "Étape facultative : la demande part aussi sans elle" : undefined}>
                  {etape.libelle}
                  {etape.facultative ? <span className="text-[#6B7280]"> (facultative)</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-2.5">
                  {etape.abandons ? (
                    <span className="text-[12px] text-[#F5B454]" title={`${etape.abandons} parcours arrêtés à cette étape`}>
                      −{nombre(etape.abandons)}
                      <span className="sr-only"> parcours arrêtés ici</span>
                    </span>
                  ) : null}
                  <span className={cn(NUM, "font-semibold text-[#F2F3F5]")}>{nombre(etape.parcours)}</span>
                </span>
              </div>
              <div className="h-2 rounded-[4px] bg-[#22262D]">
                {etape.parcours > 0 ? (
                  <div
                    className="h-2 rounded-[4px]"
                    style={{
                      width: `${Math.max(1.5, Math.min(1, etape.parcours / reference) * 100)}%`,
                      background: etape.facultative ? "#3A3E47" : DEGRADE_TUNNEL[Math.min(index, DEGRADE_TUNNEL.length - 1)],
                    }}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[12px] text-[#6B7280]">
        <span className="text-[#F5B454]">−n</span>&nbsp;: parcours de l&apos;étape d&apos;avant arrêtés à cette étape. Un parcours compte à une étape s&apos;il a atteint la précédente.
      </p>
    </div>
  );
}
