"use client";

import { AlertTriangle, CalendarClock } from "lucide-react";
import { LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { formatJourCourt, joursDeRetard } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import { montantAffiche, type DossierResume } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { BadgeMain, BarreProgression, Lisere, couleurLisere } from "./Indicateurs";
import { PastilleEtape, TRANS } from "./ui";

/** Pastille rouge : prochaine action dépassée. */
export function PastilleRetard({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Prochaine action en retard"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-[#EF4444] ring-4 ring-[#EF4444]/15", className)}
    />
  );
}

/** Nombre de points à compléter sur le dossier (signalés, jamais exigés). */
export function PastilleACompleter({ nombre, className }: { nombre: number; className?: string }) {
  return (
    <span
      title="Points à compléter sur le dossier"
      className={cn("inline-flex items-center gap-1 rounded-full bg-[#EF9F27]/10 px-2 py-px text-[11px] font-medium text-[#F5B454]", className)}
    >
      <AlertTriangle size={10} aria-hidden />
      {nombre} à compléter
    </span>
  );
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
    libelleDate = `En retard de ${joursDeRetard(date, maintenant)} j · ${formatJourCourt(date)}`;
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
        "relative block w-full overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5 pl-4 text-left",
        "hover:border-[#3A3E47] hover:bg-[#20232A] focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none",
        TRANS
      )}
    >
      <Lisere couleur={couleurLisere(dossier, maintenant)} />
      {/* Qui a la main, en premier : c'est ce qui se lit d'abord. */}
      <span className="flex min-h-5 items-center justify-between gap-2">
        <BadgeMain main={mainDe(dossier, maintenant)} />
        {enRetard ? <PastilleRetard className="mr-1" /> : null}
      </span>
      <span className="mt-2 block truncate text-[14px] font-medium text-[#F2F3F5]">{dossier.clientNom}</span>
      <span className="mt-0.5 block truncate text-[12px] text-[#6B7280]">{dossier.clientVille || "Ville à préciser"}</span>
      <span className="mt-2 block truncate text-[13px] text-[#9CA3AF]">{dossier.objet || "Objet à préciser"}</span>
      {dossier.aCompleter > 0 ? <PastilleACompleter nombre={dossier.aCompleter} className="mt-2" /> : null}
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
      <BarreProgression etape={dossier.etape} etapeAvantSortie={dossier.etapeAvantSortie} className="mt-3" />
    </button>
  );
}

/**
 * Carte compacte, pour une colonne chargée (30, 50 dossiers) : hauteur fixe,
 * jamais écrasée, et l'essentiel reste lisible — le nom, la prochaine action
 * et sa date, le retard (liseré et pastille rouges), qui a la main.
 */
export function CarteDossierCompacte({ dossier, maintenant, onOuvrir }: { dossier: DossierResume; maintenant: Date; onOuvrir: () => void }) {
  const echeance = echeanceDe(dossier, maintenant);
  const enRetard = echeance === "retard";
  const main = mainDe(dossier, maintenant);
  const date = dossier.prochaineActionDate;
  const quand = !date ? null : enRetard ? `retard ${joursDeRetard(date, maintenant)} j` : echeance === "aujourdhui" ? "aujourd'hui" : formatJourCourt(date);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      className={cn(
        "relative flex h-[62px] w-full shrink-0 flex-col justify-center overflow-hidden rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] py-2 pr-3 pl-4 text-left",
        "hover:border-[#3A3E47] hover:bg-[#20232A] focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none",
        TRANS
      )}
    >
      <Lisere couleur={couleurLisere(dossier, maintenant)} />
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#F2F3F5]">{dossier.clientNom}</span>
        {enRetard ? <PastilleRetard /> : null}
        {main === "MOI" || main === "A_RELANCER" ? <BadgeMain main={main} className="px-1.5 py-0 text-[10.5px]" /> : null}
      </span>
      <span className={cn("mt-1 flex min-w-0 items-center gap-1.5 text-[12px]", enRetard ? "text-[#F87171]" : echeance === "aujourdhui" ? "text-[#EF9F27]" : "text-[#9CA3AF]")}>
        <CalendarClock size={12} className="shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{dossier.prochaineAction ?? (date ? "Action à préciser" : "Aucune prochaine action")}</span>
        {quand ? <span className="shrink-0 font-medium tabular-nums">· {quand}</span> : null}
      </span>
    </button>
  );
}
