"use client";

import { Play } from "lucide-react";
import { CHOIX_MINUTES, type GroupeMinutes, type PlanMinutes } from "@/lib/a-faire/types";
import { dureeLisible, libelleChoixMinutes } from "@/lib/a-faire/affichage";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 17 (partie A) — « J'ai 5 min / 15 min / 30 min / 1 h » : ce qui tient dans ce temps, regroupé (« 3 appels ·
 * 10 min », « 1 devis · 15 min »), chaque groupe lançable d'un geste (la série en plein écran), ou tout à la suite.
 */
export function Minutes({ choisies, plan, chargement, onChoisir, onLancer }: { choisies: number | null; plan: PlanMinutes | null; chargement: boolean; onChoisir: (minutes: number | null) => void; onLancer: (groupe: GroupeMinutes | null) => void }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Le temps dont je dispose">
        <span className="text-[13px] text-[#9CA3AF]">J&apos;ai</span>
        {CHOIX_MINUTES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={choisies === m}
            onClick={() => onChoisir(choisies === m ? null : m)}
            className={cn("h-11 rounded-full border-[0.5px] px-3.5 text-[13px] tabular-nums sm:h-8", choisies === m ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
          >
            {libelleChoixMinutes(m)}
          </button>
        ))}
      </div>
      {choisies !== null ? (
        <div className="mt-2 overflow-hidden rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]" aria-live="polite">
          {!plan || plan.minutes !== choisies ? (
            <p className="px-3.5 py-3 text-[13px] text-[#8B919C]">{chargement ? "Je regarde ce qui tient…" : "…"}</p>
          ) : plan.groupes.length === 0 ? (
            <p className="px-3.5 py-3 text-[13px] text-[#8B919C]">Rien ne tient en {libelleChoixMinutes(choisies)}.</p>
          ) : (
            <>
              <ul>
                {plan.groupes.map((groupe) => (
                  <li key={groupe.famille} className="flex min-h-[52px] items-center gap-2 border-t-[0.5px] border-[#2A2D34] py-1.5 pr-1.5 pl-3.5 first:border-t-0">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#F2F3F5]">{groupe.libelle}</span>
                    <button type="button" onClick={() => onLancer(groupe)} aria-label={`Lancer : ${groupe.libelle}`} className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border-[0.5px] border-[#1D9E75]/45 px-3 text-[13px] font-medium text-[#5DCAA5] hover:bg-[#1D9E75]/10 sm:h-8", TRANS)}>
                      <Play size={14} aria-hidden /> Lancer
                    </button>
                  </li>
                ))}
              </ul>
              {plan.groupes.length > 1 ? (
                <button type="button" onClick={() => onLancer(null)} className={cn("flex min-h-11 w-full items-center justify-center gap-1.5 border-t-[0.5px] border-[#2A2D34] text-[13px] text-[#5DCAA5] hover:bg-[#20232A] sm:min-h-9", TRANS)}>
                  <Play size={13} aria-hidden /> Tout à la suite · {dureeLisible(plan.utilisees)}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
