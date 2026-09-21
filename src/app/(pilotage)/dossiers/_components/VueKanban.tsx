"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Hourglass, Play } from "lucide-react";
import { ETAPES, LIBELLES_ETAPE, REGLES_ETAPES, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { echeanceDe, estAFaire } from "@/lib/dossiers/pilotage";
import { estEtapeActive } from "@/lib/dossiers/regles";
import { montantAffiche, type DossierResume } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { CarteDossier, CarteDossierCompacte } from "./CarteDossier";
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

/** « 129 940 € » devient « 130 k€ » : l'en-tête d'une colonne tient sur un téléphone. */
function montantCourt(montant: number): string {
  return montant >= 10_000 ? `${Math.round(montant / 1000).toLocaleString("fr-FR")} k€` : formatMontant(montant);
}

/** Au-delà, la colonne passe en cartes compactes : 30 à 50 dossiers restent lisibles. */
export const SEUIL_COMPACT = 6;

/** Dans une colonne : ceux où j'ai la main d'abord (retards en tête), puis par échéance. */
export function comparerPourColonne(maintenant: Date) {
  return (a: DossierResume, b: DossierResume) => Number(estAFaire(b, maintenant)) - Number(estAFaire(a, maintenant)) || comparerParEcheance(a, b);
}

/**
 * Hauteur laissée aux colonnes : du haut du kanban jusqu'au bas de l'écran
 * (barre de navigation du téléphone déduite). Chaque colonne défile alors
 * seule, sur ordinateur comme sur téléphone ; la page ne s'allonge plus.
 */
function useHauteurColonnes() {
  const repere = useRef<HTMLDivElement>(null);
  const [hauteur, setHauteur] = useState<number | null>(null);
  useLayoutEffect(() => {
    const mesurer = () => {
      const element = repere.current;
      if (!element) return;
      const haut = element.getBoundingClientRect().top + window.scrollY;
      const barreBas = [...document.querySelectorAll("nav")].find((nav) => getComputedStyle(nav).position === "fixed" && nav.getBoundingClientRect().top > window.innerHeight / 2);
      const reserve = (barreBas?.getBoundingClientRect().height ?? 0) + 20;
      setHauteur(Math.max(360, Math.round(window.innerHeight - haut - reserve)));
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(document.body);
    window.addEventListener("resize", mesurer);
    return () => {
      observateur.disconnect();
      window.removeEventListener("resize", mesurer);
    };
  }, []);
  return { repere, hauteur };
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
  const { repere, hauteur } = useHauteurColonnes();

  return (
    <div ref={repere} className="-mx-5 scroll-px-5 snap-x snap-mandatory overflow-x-auto px-5 pb-4 md:-mx-8 md:scroll-px-8 md:snap-none md:px-8">
      <div className="flex w-max items-start gap-3">
        {colonnes.map((etape) => {
          const liste = dossiers.filter((dossier) => dossier.etape === etape).sort(comparerPourColonne(maintenant));
          const total = liste.reduce((somme, dossier) => somme + (montantAffiche(dossier) ?? 0), 0);
          const aFaire = liste.filter((dossier) => estAFaire(dossier, maintenant)).length;
          const retards = liste.filter((dossier) => echeanceDe(dossier, maintenant) === "retard").length;
          const compacte = liste.length > SEUIL_COMPACT;
          return (
            <section
              key={etape}
              aria-label={`${LIBELLES_ETAPE[etape]} : ${liste.length} dossier${liste.length > 1 ? "s" : ""}`}
              style={hauteur ? { maxHeight: hauteur } : undefined}
              className="relative flex w-[84vw] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#191B20] sm:w-[272px]"
            >
              <span aria-hidden className="h-[3px] w-full shrink-0" style={{ backgroundColor: COULEURS_ETAPE[etape] }} />
              <header className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[etape] }} />
                  <h2 className="truncate text-[13px] font-medium" style={{ color: COULEURS_ETAPE[etape] }}>
                    {LIBELLES_ETAPE[etape]}
                  </h2>
                  <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{liste.length}</span>
                  {aFaire > 0 ? (
                    <span title={`${aFaire} où j'ai la main`} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#F2F3F5] tabular-nums">
                      <Play size={8} strokeWidth={3} className="fill-current" aria-hidden />
                      {aFaire}
                      <span className="sr-only"> à faire</span>
                    </span>
                  ) : null}
                  {retards > 0 ? (
                    <span title={`${retards} en retard`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F87171] tabular-nums">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
                      {retards}
                      <span className="sr-only"> en retard</span>
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {total > 0 ? (
                    <span title={formatMontant(total)} className="text-[11px] text-[#6B7280] tabular-nums">
                      {montantCourt(total)}
                    </span>
                  ) : null}
                  <ResponsableColonne etape={etape} />
                </div>
              </header>
              <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2", compacte ? "gap-1.5" : "gap-2")}>
                {liste.length === 0 ? (
                  <p className="rounded-[9px] border-[0.5px] border-dashed border-[#2A2D34] px-3 py-6 text-center text-[12px] text-[#6B7280]">Aucun dossier</p>
                ) : (
                  liste.map((dossier) =>
                    compacte ? (
                      <CarteDossierCompacte key={dossier.id} dossier={dossier} maintenant={maintenant} onOuvrir={() => onOuvrir(dossier.id)} />
                    ) : (
                      <div key={dossier.id} className="shrink-0">
                        <CarteDossier dossier={dossier} maintenant={maintenant} onOuvrir={() => onOuvrir(dossier.id)} />
                      </div>
                    )
                  )
                )}
                {/* D'autres dossiers en dessous : un fondu le dit, sans barre de défilement à chercher. */}
                {compacte ? <div aria-hidden className="pointer-events-none sticky bottom-[-8px] -mt-8 h-8 shrink-0 bg-gradient-to-t from-[#191B20] to-transparent" /> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
