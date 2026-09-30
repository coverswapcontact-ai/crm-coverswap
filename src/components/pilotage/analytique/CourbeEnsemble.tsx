"use client";

import { useState } from "react";
import type { Courbe } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import { Carte } from "./base";
import { CourbeTemps, LegendeCourbe } from "./Graphiques";

/**
 * Mission 17 (partie B, relecture) — la courbe de la Vue d'ensemble : les leads par jour et par source (maquette), et
 * d'un geste les devis par jour et par source (`courbeDevis`), sur la même période et les mêmes couleurs. Au téléphone,
 * deux familles seulement (maquette : Meta et Site), pour les leads comme pour les devis.
 */

type Vue = "leads" | "devis";

/** Les séries du téléphone : les deux premières familles (les plus fournies, dans l'ordre du calcul). */
export function seriesMasqueesTelephone(courbe: Courbe): string[] {
  return courbe.series.slice(2).map((serie) => serie.cle);
}

/**
 * Les deux courbes à partir de l'écran. Un écran calculé avant la relecture portait les devis en série « devis » dans la
 * courbe des leads : la série en est retirée et devient la courbe des devis (sans découpage par source).
 */
export function courbesEnsemble(courbeLeads: Courbe, courbeDevis: Courbe | null | undefined): { leads: Courbe; devis: Courbe | null } {
  const ancienne = courbeLeads.series.find((serie) => serie.cle === "devis");
  const leads = ancienne
    ? {
        ...courbeLeads,
        series: courbeLeads.series.filter((serie) => serie.cle !== "devis"),
        points: courbeLeads.points.map((point) => ({ jour: point.jour, valeurs: Object.fromEntries(Object.entries(point.valeurs).filter(([cle]) => cle !== "devis")) })),
      }
    : courbeLeads;
  if (courbeDevis) return { leads, devis: courbeDevis };
  if (!ancienne) return { leads, devis: null };
  return {
    leads,
    devis: { titre: "Devis par jour", series: [{ ...ancienne, libelle: "Devis" }], points: courbeLeads.points.map((point) => ({ jour: point.jour, valeurs: { devis: point.valeurs.devis ?? 0 } })) },
  };
}

export function CourbeEnsemble({ courbeLeads, courbeDevis }: { courbeLeads: Courbe; courbeDevis?: Courbe | null }) {
  const [vue, setVue] = useState<Vue>("leads");
  const courbes = courbesEnsemble(courbeLeads, courbeDevis);
  const courbe = vue === "devis" && courbes.devis ? courbes.devis : courbes.leads;
  const masquees = seriesMasqueesTelephone(courbe);
  const titreLong = vue === "devis" ? courbe.titre || "Devis par jour et par source" : courbe.titre || "Leads par jour et par source";
  return (
    <Carte
      titre={
        <>
          <span className="md:hidden">{vue === "devis" ? "Devis par jour" : "Leads par jour"}</span>
          <span className="hidden md:inline">{titreLong}</span>
        </>
      }
      sousTitre={courbe.sousTitre ? <span className="hidden md:inline">{courbe.sousTitre}</span> : undefined}
      action={
        <div className="flex items-center gap-4">
          <span className="hidden xl:block">
            <LegendeCourbe courbe={courbe} />
          </span>
          {courbes.devis ? (
            <div role="group" aria-label="Courbe affichée" className="flex rounded-[8px] border border-[#2A2D34] p-0.5">
              {(["leads", "devis"] as const).map((cle) => (
                <button
                  key={cle}
                  type="button"
                  aria-pressed={vue === cle}
                  onClick={() => setVue(cle)}
                  className={cn(
                    "h-7 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors duration-150 max-md:h-8",
                    vue === cle ? "bg-[#22262D] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]"
                  )}
                >
                  {cle === "leads" ? "Leads" : "Devis"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      }
      gap="gap-3.5 md:gap-5"
    >
      <div className="hidden md:block xl:hidden">
        <LegendeCourbe courbe={courbe} />
      </div>
      <div className="max-md:hidden">
        <CourbeTemps courbe={courbe} hauteur={260} />
      </div>
      <div className="md:hidden">
        <CourbeTemps courbe={courbe} hauteur={150} compact seriesMasquees={masquees} />
      </div>
    </Carte>
  );
}
