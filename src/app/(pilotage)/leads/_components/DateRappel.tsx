"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { jourSemaineHeure } from "@/lib/commun/format";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 14 (partie 3) — la date de rappel d'un lead, modifiable en un geste :
 * un champ date et heure natif posé sur la puce (sur iPhone, le sélecteur
 * s'ouvre au toucher). Le choix s'enregistre quand le sélecteur se referme ;
 * effacer la valeur retire la date (« Sans date »). La saisie est en heure
 * locale du téléphone, c'est-à-dire l'heure de Paris.
 */

const deux = (nombre: number) => String(nombre).padStart(2, "0");

/** ISO → « 2026-10-01T18:00 » en heure locale : la valeur d'un champ datetime-local. */
export function versSaisie(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(date.getMinutes())}`;
}

/** « Rappel jeu. 1 oct. 18:00 » (rouge si en retard) ou « Sans date » ; toucher la puce ouvre le sélecteur. */
export function PuceRappel({ rappelLe, enRetard, onChoisir, occupe = false }: { rappelLe: string | null; enRetard: boolean; onChoisir: (iso: string | null) => void; occupe?: boolean }) {
  const enregistree = versSaisie(rappelLe);
  // Le choix en cours, sélecteur ouvert : il ne vaut que pour la date enregistrée qu'il modifie.
  const [brouillon, setBrouillon] = useState<{ pour: string; valeur: string } | null>(null);
  const valeur = brouillon && brouillon.pour === enregistree ? brouillon.valeur : enregistree;

  function valider() {
    if (!brouillon) return;
    setBrouillon(null);
    if (brouillon.pour !== enregistree || brouillon.valeur === enregistree) return;
    const date = brouillon.valeur ? new Date(brouillon.valeur) : null;
    if (date && Number.isNaN(date.getTime())) return;
    onChoisir(date ? date.toISOString() : null);
  }

  const libelle = valeur ? `Rappel ${jourSemaineHeure(new Date(valeur))}` : "Sans date";
  const rouge = enRetard && Boolean(valeur) && valeur === enregistree;
  return (
    <label className="relative inline-flex h-11 shrink-0 items-center sm:h-8">
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border-[0.5px] px-2.5 text-[12.5px] whitespace-nowrap tabular-nums",
          rouge ? "border-retard/50 bg-retard/10 font-medium text-retard-texte" : valeur ? "border-trait bg-surface-2 text-texte-2" : "border-dashed border-trait-2 text-texte-3",
          occupe && "opacity-60",
          TRANS,
        )}
      >
        <CalendarClock size={13} aria-hidden />
        {libelle}
      </span>
      <input
        type="datetime-local"
        value={valeur}
        disabled={occupe}
        aria-label={valeur ? `${libelle}${rouge ? " (en retard)" : ""} : toucher pour la changer` : "Dater le rappel"}
        onChange={(evenement) => setBrouillon({ pour: enregistree, valeur: evenement.target.value })}
        onBlur={valider}
        onKeyDown={(evenement) => {
          if (evenement.key === "Enter") evenement.currentTarget.blur();
        }}
        onClick={(evenement) => {
          // À la souris, le champ invisible n'ouvre pas son sélecteur tout seul ; au doigt (iPhone), si.
          if (!window.matchMedia("(pointer: fine)").matches) return;
          try {
            evenement.currentTarget.showPicker();
          } catch {
            // Sélecteur déjà ouvert, ou navigateur trop ancien : le champ reste utilisable au clavier.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-[16px] opacity-0 disabled:cursor-default"
      />
    </label>
  );
}
