"use client";

import { Clock } from "lucide-react";
import { LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { dureeParEtape, formatDuree } from "@/lib/dossiers/delais";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { COULEURS_ETAPE, TitreSection } from "./ui";

function LignePrix({ libelle, montant, accent }: { libelle: string; montant: number | null; accent?: string }) {
  if (montant === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[13px]">
      <span className="text-[#9CA3AF]">{libelle}</span>
      <span className="text-[#F2F3F5] tabular-nums">
        {formatMontant(montant)}
        {accent ? <span className="ml-1.5 text-[12px] text-[#9CA3AF]">{accent}</span> : null}
      </span>
    </div>
  );
}

/** Temps passé à chaque étape et chemin du prix, du premier devis au facturé. */
export function DelaisEcarts({ detail }: { detail: DossierDetail }) {
  const courant = detail.parcours.at(-1);
  const durees = dureeParEtape(detail.parcours);
  const total = detail.parcours.reduce((somme, passage) => somme + passage.dureeMs, 0);
  const { ecarts, delais } = detail;
  const aDesPrix = [ecarts.estimation, ecarts.premierDevis, ecarts.devisSigne, ecarts.facture].some((montant) => montant !== null);
  if (!courant && !aDesPrix) return null;

  const delaisVisibles = [
    { libelle: "Ouverture → signature", duree: delais.ouvertureASignature },
    { libelle: "Signature → chantier", duree: delais.signatureAChantier },
    { libelle: "Facturation → encaissement", duree: delais.facturationAEncaissement },
    { libelle: "De bout en bout", duree: delais.boutEnBout },
  ].filter((ligne): ligne is { libelle: string; duree: number } => ligne.duree !== null);

  return (
    <section>
      <TitreSection>Délais et prix</TitreSection>
      <div className="space-y-3 rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5">
        {courant ? (
          <p className="flex items-center gap-2 text-[13px] text-[#F2F3F5]">
            <Clock size={14} className="shrink-0 text-[#9CA3AF]" aria-hidden />
            Depuis {formatDuree(courant.dureeMs)} en « {LIBELLES_ETAPE[courant.etape]} »
            <span className="text-[#6B7280]">· dossier ouvert depuis {formatDuree(total)}</span>
          </p>
        ) : null}

        {total > 0 ? (
          <div>
            <div className="flex h-2 overflow-hidden rounded-full bg-[#22262D]" aria-hidden>
              {detail.parcours.map((passage, index) => (
                <span
                  key={`${passage.etape}-${index}`}
                  style={{ width: `${(passage.dureeMs / total) * 100}%`, backgroundColor: COULEURS_ETAPE[passage.etape] }}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(durees).map(([etape, duree]) => (
                <li key={etape} className="flex items-center gap-1.5 text-[12px] text-[#9CA3AF]">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[etape as keyof typeof COULEURS_ETAPE] }} />
                  {LIBELLES_ETAPE[etape as keyof typeof LIBELLES_ETAPE]} : {formatDuree(duree ?? 0)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {delaisVisibles.length > 0 ? (
          <ul className="border-t-[0.5px] border-[#2A2D34] pt-2">
            {delaisVisibles.map((ligne) => (
              <li key={ligne.libelle} className="flex justify-between gap-3 py-0.5 text-[13px]">
                <span className="text-[#9CA3AF]">{ligne.libelle}</span>
                <span className="text-[#F2F3F5] tabular-nums">{formatDuree(ligne.duree)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {aDesPrix ? (
          <div className="border-t-[0.5px] border-[#2A2D34] pt-2">
            <LignePrix libelle="Estimation" montant={ecarts.estimation} />
            <LignePrix
              libelle="Premier devis"
              montant={ecarts.premierDevis}
              accent={ecarts.dernierDevis !== null && ecarts.dernierDevis !== ecarts.premierDevis ? `dernier : ${formatMontant(ecarts.dernierDevis)}` : undefined}
            />
            <LignePrix
              libelle="Signé"
              montant={ecarts.devisSigne}
              accent={
                ecarts.ecartSignature !== null && ecarts.ecartSignature !== 0
                  ? `${ecarts.ecartSignature > 0 ? "+" : ""}${formatMontant(ecarts.ecartSignature)} (${ecarts.ecartSignaturePct} %)`
                  : undefined
              }
            />
            <LignePrix libelle="Facturé" montant={ecarts.facture} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
