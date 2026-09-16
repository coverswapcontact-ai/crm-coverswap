"use client";

import { Hourglass, Play } from "lucide-react";
import { ETAPES, LIBELLES_ETAPE, REGLES_ETAPES, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { estEtapeActive } from "@/lib/dossiers/regles";
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

function ResponsableColonne({ etape }: { etape: EtapeDossier }) {
  const responsable = REGLES_ETAPES[etape].responsable;
  if (responsable === null) return null;
  const libelle = responsable === "MOI" ? "Étape où j'ai la main" : "Étape où le client a la main";
  return (
    <span title={libelle} className="flex h-5 w-5 items-center justify-center">
      {responsable === "MOI" ? (
        <Play size={11} strokeWidth={2.5} className="fill-current text-[#F2F3F5]" aria-hidden />
      ) : (
        <Hourglass size={11} strokeWidth={2.5} className="text-[#6B7280]" aria-hidden />
      )}
      <span className="sr-only">{libelle}</span>
    </span>
  );
}

export function VueKanban({
  dossiers,
  afficherSorties,
  masquerColonnesVides,
  maintenant,
  onOuvrir,
}: {
  dossiers: DossierResume[];
  afficherSorties: boolean;
  /** Filtre « À faire » : seules les colonnes qui ont des dossiers restent. */
  masquerColonnesVides: boolean;
  maintenant: Date;
  onOuvrir: (id: string) => void;
}) {
  const etapesPresentes = new Set(dossiers.map((dossier) => dossier.etape));
  const colonnes = ETAPES.filter((etape) =>
    masquerColonnesVides ? etapesPresentes.has(etape) : estEtapeActive(etape) || afficherSorties
  );

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
              className="relative flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#191B20] sm:w-[272px]"
            >
              <span aria-hidden className="h-[3px] w-full shrink-0" style={{ backgroundColor: COULEURS_ETAPE[etape] }} />
              <header className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[etape] }} />
                  <h2 className="truncate text-[13px] font-medium" style={{ color: COULEURS_ETAPE[etape] }}>
                    {LIBELLES_ETAPE[etape]}
                  </h2>
                  <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{liste.length}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {total > 0 ? (
                    <span className="text-[11px] text-[#6B7280] tabular-nums">{formatMontant(total)}</span>
                  ) : null}
                  <ResponsableColonne etape={etape} />
                </div>
              </header>
              <div className="flex flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-270px)] md:overflow-y-auto">
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
