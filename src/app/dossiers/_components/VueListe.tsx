"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { formatDistanceStrict } from "date-fns";
import { fr } from "date-fns/locale";
import { LIBELLES_ETAPE } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { montantAffiche, type DossierResume } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { CarteDossier, ProchaineActionResume, echeanceDe } from "./CarteDossier";
import { comparerParEcheance } from "./VueKanban";
import { PastilleEtape, TRANS } from "./ui";

export type CleTri = "prochaineAction" | "montant" | "anciennete";
export type Tri = { cle: CleTri; sens: "asc" | "desc" };

export const LIBELLES_TRI: Record<CleTri, string> = {
  prochaineAction: "Date de prochaine action",
  montant: "Montant",
  anciennete: "Ancienneté",
};

/** Sens naturel d'un premier clic : échéance la plus proche, plus gros montant, plus ancien dossier. */
export const SENS_PAR_DEFAUT: Record<CleTri, Tri["sens"]> = {
  prochaineAction: "asc",
  montant: "desc",
  anciennete: "asc",
};

export function trierDossiers(dossiers: DossierResume[], tri: Tri): DossierResume[] {
  const signe = tri.sens === "asc" ? 1 : -1;
  return [...dossiers].sort((a, b) => {
    if (tri.cle === "montant") {
      const ma = montantAffiche(a);
      const mb = montantAffiche(b);
      if (ma === null || mb === null) return ma === mb ? 0 : ma === null ? 1 : -1;
      return (ma - mb) * signe;
    }
    if (tri.cle === "anciennete") return a.createdAt.localeCompare(b.createdAt) * signe;
    if (!a.prochaineActionDate || !b.prochaineActionDate) return comparerParEcheance(a, b);
    return a.prochaineActionDate.localeCompare(b.prochaineActionDate) * signe;
  });
}

function EnteteTriable({ cle, tri, onTrier, className }: { cle: CleTri; tri: Tri; onTrier: (cle: CleTri) => void; className?: string }) {
  const actif = tri.cle === cle;
  const Icone = !actif ? ArrowUpDown : tri.sens === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cn("px-3 py-2.5 font-medium", className)} aria-sort={actif ? (tri.sens === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onTrier(cle)}
        className={cn("inline-flex items-center gap-1 hover:text-[#F2F3F5]", actif ? "text-[#F2F3F5]" : "text-[#9CA3AF]", TRANS)}
      >
        {cle === "prochaineAction" ? "Prochaine action" : LIBELLES_TRI[cle]}
        <Icone size={12} aria-hidden />
      </button>
    </th>
  );
}

export function VueListe({
  dossiers,
  tri,
  onTrier,
  maintenant,
  onOuvrir,
}: {
  dossiers: DossierResume[];
  tri: Tri;
  onTrier: (cle: CleTri) => void;
  maintenant: Date;
  onOuvrir: (id: string) => void;
}) {
  const tries = trierDossiers(dossiers, tri);

  return (
    <>
      {/* Mobile : cartes empilées */}
      <div className="flex flex-col gap-2 md:hidden">
        {tries.map((dossier) => (
          <CarteDossier key={dossier.id} dossier={dossier} maintenant={maintenant} onOuvrir={() => onOuvrir(dossier.id)} afficherEtape />
        ))}
      </div>

      {/* Bureau : tableau triable */}
      <div className="hidden overflow-x-auto rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] md:block">
        <table className="w-full min-w-[900px] table-fixed text-left text-[13px]">
          <thead className="border-b-[0.5px] border-[#2A2D34] text-[12px] text-[#9CA3AF]">
            <tr>
              <th scope="col" className="w-[210px] px-3 py-2.5 font-medium">Client</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Objet</th>
              <th scope="col" className="w-[130px] px-3 py-2.5 font-medium">Étape</th>
              <EnteteTriable cle="montant" tri={tri} onTrier={onTrier} className="w-[120px] text-right" />
              <EnteteTriable cle="prochaineAction" tri={tri} onTrier={onTrier} className="w-[260px]" />
              <EnteteTriable cle="anciennete" tri={tri} onTrier={onTrier} className="w-[120px]" />
            </tr>
          </thead>
          <tbody>
            {tries.map((dossier) => {
              const montant = montantAffiche(dossier);
              return (
                <tr
                  key={dossier.id}
                  onClick={() => onOuvrir(dossier.id)}
                  className={cn("cursor-pointer border-t-[0.5px] border-[#2A2D34] first:border-t-0 hover:bg-[#22262D]", TRANS)}
                >
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={(evenement) => {
                        evenement.stopPropagation();
                        onOuvrir(dossier.id);
                      }}
                      className="flex w-full min-w-0 items-center gap-2 text-left focus-visible:underline focus-visible:outline-none"
                    >
                      {echeanceDe(dossier, maintenant) === "retard" ? (
                        <span role="img" aria-label="Prochaine action en retard" className="h-2 w-2 shrink-0 rounded-full bg-[#EF4444]" />
                      ) : null}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#F2F3F5]">{dossier.clientNom}</span>
                        <span className="block truncate text-[12px] text-[#6B7280]">{dossier.clientVille}</span>
                      </span>
                    </button>
                  </td>
                  <td className="truncate px-3 py-2.5 text-[#9CA3AF]" title={dossier.objet}>{dossier.objet}</td>
                  <td className="px-3 py-2.5">
                    <PastilleEtape etape={dossier.etape} libelle={LIBELLES_ETAPE[dossier.etape]} />
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap text-[#F2F3F5] tabular-nums">
                    {montant !== null ? formatMontant(montant) : <span className="text-[#6B7280]">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <ProchaineActionResume dossier={dossier} maintenant={maintenant} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[12px] text-[#9CA3AF]">
                    {formatDistanceStrict(new Date(dossier.createdAt), maintenant, { locale: fr })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
