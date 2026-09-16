"use client";

import { ETAPES, ETAPES_ACTIVES, LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { montantAffiche, type DossierResume } from "@/lib/dossiers/types";
import { CarteDossier } from "./CarteDossier";
import { COULEURS_ETAPE } from "./ui";

/** Dans une colonne : actions en retard d'abord, puis par date, puis sans date. */
export function comparerParEcheance(a: DossierResume, b: DossierResume): number {
  if (a.prochaineActionDate && b.prochaineActionDate) {
    return a.prochaineActionDate.localeCompare(b.prochaineActionDate);
  }
  if (a.prochaineActionDate) return -1;
  if (b.prochaineActionDate) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function VueKanban({
  dossiers,
  afficherSorties,
  maintenant,
  onOuvrir,
}: {
  dossiers: DossierResume[];
  afficherSorties: boolean;
  maintenant: Date;
  onOuvrir: (id: string) => void;
}) {
  const colonnes: readonly EtapeDossier[] = afficherSorties ? ETAPES : ETAPES_ACTIVES;

  return (
    <div className="-mx-5 scroll-px-5 snap-x snap-mandatory overflow-x-auto px-5 pb-4 md:-mx-8 md:scroll-px-8 md:snap-none md:px-8">
      <div className="flex w-max gap-3">
        {colonnes.map((etape) => {
          const liste = dossiers.filter((dossier) => dossier.etape === etape).sort(comparerParEcheance);
          const total = liste.reduce((somme, dossier) => somme + (montantAffiche(dossier) ?? 0), 0);
          return (
            <section
              key={etape}
              aria-label={LIBELLES_ETAPE[etape]}
              className="flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#191B20] sm:w-[272px]"
            >
              <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[etape] }} />
                  <h2 className="truncate text-[13px] font-medium text-[#F2F3F5]">{LIBELLES_ETAPE[etape]}</h2>
                  <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{liste.length}</span>
                </div>
                {total > 0 ? (
                  <span className="shrink-0 text-[11px] text-[#6B7280] tabular-nums">{formatMontant(total)}</span>
                ) : null}
              </header>
              <div className="flex flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-240px)] md:overflow-y-auto">
                {liste.length === 0 ? (
                  <p className="rounded-[9px] border-[0.5px] border-dashed border-[#2A2D34] px-3 py-6 text-center text-[12px] text-[#6B7280]">
                    Aucun dossier
                  </p>
                ) : (
                  liste.map((dossier) => (
                    <CarteDossier
                      key={dossier.id}
                      dossier={dossier}
                      maintenant={maintenant}
                      onOuvrir={() => onOuvrir(dossier.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
