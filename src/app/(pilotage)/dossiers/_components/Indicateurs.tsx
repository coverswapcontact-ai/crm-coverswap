"use client";

import { BellRing, Hourglass, Play } from "lucide-react";
import { ETAPES_ACTIVES, LIBELLES_ETAPE, type EtapeActive, type EtapeDossier } from "@/lib/dossiers/constants";
import { echeanceDe, mainDe, progressionDe, type Main } from "@/lib/dossiers/pilotage";
import { cn } from "@/lib/utils";
import { COULEURS_ETAPE, GRIS_HORS_PARCOURS } from "./ui";

// Indicateurs d'état partagés par les cartes, la liste, le panneau et la légende.

export const ROUGE_RETARD = "#EF4444";
const BLANC_A_MOI = "#F2F3F5";

const BADGES: Record<Exclude<Main, "AUCUNE">, { court: string; long: string; Icone: typeof Play; classe: string }> = {
  MOI: {
    court: "À moi",
    long: "À moi de jouer",
    Icone: Play,
    classe: "border-transparent bg-[#F2F3F5] text-[#0B0D10]",
  },
  A_RELANCER: {
    court: "À relancer",
    long: "À relancer : le client tarde",
    Icone: BellRing,
    classe: "border-transparent bg-[#EF4444] text-white",
  },
  CLIENT: {
    court: "Client",
    long: "Chez le client",
    Icone: Hourglass,
    classe: "border-[#4B5160] bg-transparent text-[#9CA3AF]",
  },
};

/** Qui a la main : plein et clair quand c'est à moi, en contour quand le client a la main. */
export function BadgeMain({ main, long = false, className }: { main: Main; long?: boolean; className?: string }) {
  if (main === "AUCUNE") return null;
  const { court, long: libelleLong, Icone, classe } = BADGES[main];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap",
        classe,
        className
      )}
    >
      <Icone size={11} strokeWidth={2.5} aria-hidden className={main === "MOI" ? "fill-current" : undefined} />
      {long ? libelleLong : court}
    </span>
  );
}

/** Liseré gauche : rouge en retard (prioritaire dans tous les cas), blanc quand j'ai la main. */
export function couleurLisere(
  dossier: { etape: EtapeDossier; prochaineActionDate: string | null },
  maintenant: Date
): string | null {
  if (echeanceDe(dossier, maintenant) === "retard") return ROUGE_RETARD;
  return mainDe(dossier, maintenant) === "MOI" ? BLANC_A_MOI : null;
}

export function Lisere({ couleur }: { couleur: string | null }) {
  if (!couleur) return null;
  return <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: couleur }} />;
}

function distanceRestante(etape: EtapeDossier, numero: number, arrete: boolean, avantFacturation: number): string {
  if (arrete) {
    const quittee = LIBELLES_ETAPE[ETAPES_ACTIVES[numero - 1]];
    return etape === "PERDU" ? `perdu à « ${quittee} »` : `en pause à « ${quittee} »`;
  }
  if (etape === "ENCAISSE") return "encaissé : objectif atteint";
  if (avantFacturation === 0) return "facturé : reste l'encaissement";
  return `${avantFacturation} étape${avantFacturation > 1 ? "s" : ""} avant facturation`;
}

/**
 * Progression vers l'encaissement : 9 segments aux couleurs des étapes, un
 * léger écart avant « Facturé » pour repérer la facturation, et « étape n sur 9 ».
 * Perdu ou en pause : segments gris, figés à l'étape quittée.
 */
export function BarreProgression({
  etape,
  etapeAvantSortie,
  texte = true,
  className,
}: {
  etape: EtapeDossier;
  etapeAvantSortie: EtapeActive | null;
  texte?: boolean;
  className?: string;
}) {
  const progression = progressionDe(etape, etapeAvantSortie);
  if (!progression) return null;
  const { numero, total, arrete, etapesAvantFacturation } = progression;
  const distance = distanceRestante(etape, numero, arrete, etapesAvantFacturation);

  return (
    <span className={cn("block", className)}>
      <span role="img" aria-label={`Étape ${numero} sur ${total}, ${distance}`} className="flex items-center gap-[3px]">
        {ETAPES_ACTIVES.map((etapeSegment, index) => (
          <span
            key={etapeSegment}
            className={cn("h-1 flex-1 rounded-full", etapeSegment === "FACTURE" && "ml-[3px]")}
            style={{
              backgroundColor:
                index < numero ? (arrete ? GRIS_HORS_PARCOURS : COULEURS_ETAPE[etapeSegment]) : "#2A2D34",
            }}
          />
        ))}
      </span>
      {texte ? (
        <span className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] leading-4">
          <span className="shrink-0 font-medium text-[#D1D5DB] tabular-nums">
            Étape {numero} sur {total}
          </span>
          <span className="truncate text-right text-[#6B7280]">{distance}</span>
        </span>
      ) : null}
    </span>
  );
}
