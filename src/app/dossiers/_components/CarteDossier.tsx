"use client";

import { CalendarClock } from "lucide-react";
import { LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { estAujourdhui, formatJourCourt, joursDeRetard } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { montantAffiche, type DossierResume } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { PastilleEtape, TRANS } from "./ui";

export type Echeance = "retard" | "aujourdhui" | "avenir" | "aucune";

export function echeanceDe(dossier: Pick<DossierResume, "prochaineActionDate" | "etape">, maintenant: Date): Echeance {
  if (!dossier.prochaineActionDate) return "aucune";
  // Un dossier perdu ou encaissé n'attend plus d'action : pas d'alerte de retard.
  if (dossier.etape === "PERDU" || dossier.etape === "ENCAISSE") return "avenir";
  if (joursDeRetard(dossier.prochaineActionDate, maintenant) > 0) return "retard";
  return estAujourdhui(dossier.prochaineActionDate, maintenant) ? "aujourdhui" : "avenir";
}

/** Bloc « prochaine action », partagé par la carte, la liste et le panneau. */
export function ProchaineActionResume({
  dossier,
  maintenant,
  className,
}: {
  dossier: Pick<DossierResume, "prochaineAction" | "prochaineActionDate" | "etape">;
  maintenant: Date;
  className?: string;
}) {
  const echeance = echeanceDe(dossier, maintenant);
  const date = dossier.prochaineActionDate;
  let libelleDate: string | null = null;
  if (date && echeance === "retard") {
    const jours = joursDeRetard(date, maintenant);
    libelleDate = `En retard de ${jours} j · ${formatJourCourt(date)}`;
  } else if (date && echeance === "aujourdhui") {
    libelleDate = "Aujourd'hui";
  } else if (date) {
    libelleDate = formatJourCourt(date);
  }

  if (!dossier.prochaineAction && !date) {
    return (
      <span
        className={cn(
          "flex items-center gap-2 rounded-[8px] border-[0.5px] border-dashed border-[#3A3E47] px-2.5 py-2 text-[12px] text-[#9CA3AF]",
          className
        )}
      >
        <CalendarClock size={14} className="shrink-0 text-[#6B7280]" aria-hidden />
        Aucune prochaine action
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex items-start gap-2 rounded-[8px] px-2.5 py-2",
        echeance === "retard" ? "bg-[#EF4444]/10" : echeance === "aujourdhui" ? "bg-[#EF9F27]/10" : "bg-[#22262D]",
        className
      )}
    >
      <CalendarClock
        size={14}
        aria-hidden
        className={cn(
          "mt-px shrink-0",
          echeance === "retard" ? "text-[#F87171]" : echeance === "aujourdhui" ? "text-[#EF9F27]" : "text-[#9CA3AF]"
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-[#F2F3F5]">
          {dossier.prochaineAction ?? "Action à préciser"}
        </span>
        {libelleDate ? (
          <span
            className={cn(
              "block text-[11.5px] font-medium",
              echeance === "retard" ? "text-[#F87171]" : echeance === "aujourdhui" ? "text-[#EF9F27]" : "text-[#9CA3AF]"
            )}
          >
            {libelleDate}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function CarteDossier({
  dossier,
  maintenant,
  onOuvrir,
  afficherEtape = false,
}: {
  dossier: DossierResume;
  maintenant: Date;
  onOuvrir: () => void;
  afficherEtape?: boolean;
}) {
  const montant = montantAffiche(dossier);
  const enRetard = echeanceDe(dossier, maintenant) === "retard";

  return (
    <button
      type="button"
      onClick={onOuvrir}
      className={cn(
        "relative block w-full rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5 text-left",
        "hover:border-[#3A3E47] hover:bg-[#20232A] focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none",
        TRANS
      )}
    >
      {enRetard ? (
        <span
          role="img"
          aria-label="Prochaine action en retard"
          className="absolute top-3.5 right-3.5 h-2 w-2 rounded-full bg-[#EF4444] ring-4 ring-[#EF4444]/15"
        />
      ) : null}
      <span className="block truncate pr-5 text-[14px] font-medium text-[#F2F3F5]">{dossier.clientNom}</span>
      <span className="mt-0.5 block truncate text-[12px] text-[#6B7280]">{dossier.clientVille}</span>
      <span className="mt-2 block truncate text-[13px] text-[#9CA3AF]">{dossier.objet}</span>
      <span className="mt-2 flex items-center justify-between gap-2">
        {montant !== null ? (
          <span className="text-[13px] font-medium text-[#F2F3F5] tabular-nums">{formatMontant(montant)}</span>
        ) : (
          <span className="text-[12px] text-[#6B7280]">Montant à estimer</span>
        )}
        {afficherEtape ? (
          <PastilleEtape etape={dossier.etape} libelle={LIBELLES_ETAPE[dossier.etape]} />
        ) : montant !== null ? (
          <span className="text-[11px] text-[#6B7280]">
            {dossier.montantDernierDevis !== null ? "dernier devis" : "estimé"}
          </span>
        ) : null}
      </span>
      <ProchaineActionResume dossier={dossier} maintenant={maintenant} className="mt-3" />
    </button>
  );
}
