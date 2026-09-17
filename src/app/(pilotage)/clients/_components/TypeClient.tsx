"use client";

import { Building2, UserRound } from "lucide-react";
import { CaseACocher, TRANS } from "@/components/pilotage/ui";
import type { CategorieClient } from "@/lib/clients/constantes";
import { cn } from "@/lib/utils";

/** Entreprise pour le compte de laquelle on travaille en sous-traitance : fiche « donneur d'ordre ». */
export function CaseSousTraitance({ categorie, onChange }: { categorie: CategorieClient; onChange: (categorie: Exclude<CategorieClient, "PARTICULIER">) => void }) {
  return (
    <CaseACocher
      libelle="Sous-traitance"
      description="Je travaille pour le compte de cette entreprise (cuisiniste, agenceur, entreprise générale…)."
      checked={categorie === "DONNEUR_ORDRE"}
      onChange={(coche) => onChange(coche ? "DONNEUR_ORDRE" : "PROFESSIONNEL")}
    />
  );
}

/** « Le client est » : une personne, ou une entreprise (société, commerce, syndic…). */
export function ChoixTypeClient({ estPro, onChange }: { estPro: boolean; onChange: (estPro: boolean) => void }) {
  const options = [
    { pro: false, libelle: "Particulier", detail: "Une personne", icone: UserRound },
    { pro: true, libelle: "Entreprise", detail: "Société, commerce, syndic…", icone: Building2 },
  ];
  return (
    <div role="radiogroup" aria-label="Le client est" className="grid grid-cols-2 gap-2">
      {options.map(({ pro, libelle, detail, icone: Icone }) => {
        const choisi = pro === estPro;
        return (
          <button
            key={libelle}
            type="button"
            role="radio"
            aria-checked={choisi}
            onClick={() => onChange(pro)}
            className={cn(
              "flex min-h-14 items-center gap-2.5 rounded-[10px] border-[0.5px] px-3 py-2 text-left",
              "focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none",
              choisi ? "border-[#1D9E75]/60 bg-[#112B22]" : "border-[#2A2D34] bg-[#16181D] hover:border-[#3A3E47]",
              TRANS
            )}
          >
            <Icone size={18} aria-hidden className={cn("shrink-0", choisi ? "text-[#5DCAA5]" : "text-[#6B7280]")} />
            <span className="min-w-0">
              <span className={cn("block text-[13.5px] font-medium", choisi ? "text-[#5DCAA5]" : "text-[#F2F3F5]")}>{libelle}</span>
              <span className="hidden text-[11.5px] text-[#6B7280] sm:block">{detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
