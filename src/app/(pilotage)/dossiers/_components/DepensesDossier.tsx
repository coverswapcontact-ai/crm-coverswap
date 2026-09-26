"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Paperclip, Plus } from "lucide-react";
import { appelApi } from "@/components/pilotage/client";
import { libelleCategorie, type DepenseVue } from "@/lib/depenses/constantes";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { TitreSection, TRANS } from "./ui";

/** Dépenses du chantier et marge indicative : ce qui est facturé moins ce qui est dépensé. */
export function DepensesDossier({ detail }: { detail: DossierDetail }) {
  const [donnees, setDonnees] = useState<{ depenses: DepenseVue[]; total: number } | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let actif = true;
    appelApi<{ depenses: DepenseVue[]; total: number }>(`/api/dossiers/${detail.id}/depenses`)
      .then((reponse) => actif && setDonnees(reponse))
      .catch(() => actif && setErreur(true));
    return () => {
      actif = false;
    };
  }, [detail.id]);

  const facture = detail.paiements.pieces.filter((piece) => piece.type === "FACTURE" && piece.active).reduce((somme, piece) => somme + (piece.total ?? 0), 0);
  const devis = detail.documents.find((document) => document.type === "DEVIS" && document.statut === "ACCEPTE")?.totalHt ?? null;
  const base = facture > 0 ? facture : devis;
  const marge = donnees && base !== null ? base - donnees.total : null;

  return (
    <section>
      <TitreSection
        action={
          <Link
            href={`/depenses/nouvelle?dossier=${detail.id}`}
            className={cn("flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS)}
          >
            <Plus size={13} aria-hidden /> Dépense
          </Link>
        }
      >
        Dépenses du chantier
      </TitreSection>
      {erreur ? (
        <p className="text-[12.5px] text-[#F87171]">Dépenses indisponibles pour l&apos;instant.</p>
      ) : !donnees ? (
        <p className="text-[12.5px] text-[#6B7280]">Chargement…</p>
      ) : donnees.depenses.length === 0 ? (
        <p className="text-[12.5px] text-[#6B7280]">Aucune dépense rattachée à ce chantier.</p>
      ) : (
        <div className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b-[0.5px] border-[#2A2D34] px-3.5 py-2.5 text-[12.5px]">
            <span className="text-[#9CA3AF]">
              Dépensé <span className="text-[#F2F3F5] tabular-nums">{formatMontant(donnees.total)}</span>
            </span>
            {marge !== null && base ? (
              <span className="text-[#9CA3AF]">
                Marge {facture > 0 ? "sur facturé" : "sur devis signé"}{" "}
                <span className={cn("tabular-nums", marge >= 0 ? "text-[#5DCAA5]" : "text-[#F87171]")}>
                  {formatMontant(marge)} ({Math.round((marge / base) * 100)} %)
                </span>
              </span>
            ) : null}
          </div>
          <ul>
            {donnees.depenses.map((depense) => (
              <li key={depense.id} className="flex items-center gap-3 border-t-[0.5px] border-[#2A2D34] px-3.5 py-2 first:border-t-0">
                <span className="w-[74px] shrink-0 text-[12px] text-[#9CA3AF] tabular-nums">{formatDateCourte(depense.payeeLe)}</span>
                <span className={cn("min-w-0 flex-1 truncate text-[13px]", depense.archiveLe ? "text-[#6B7280] line-through" : "text-[#F2F3F5]")}>
                  {depense.fournisseur} <span className="text-[#9CA3AF]">· {libelleCategorie(depense.categorie)}</span>
                </span>
                {depense.justificatif ? (
                  <a href={depense.justificatif.url} target="_blank" rel="noreferrer" aria-label="Voir le justificatif" className="text-[#9CA3AF] hover:text-[#F2F3F5]">
                    <Paperclip size={13} aria-hidden />
                  </a>
                ) : null}
                <span className={cn("shrink-0 text-[13px] tabular-nums", depense.archiveLe ? "text-[#6B7280] line-through" : "text-[#F2F3F5]")}>
                  {formatMontant(depense.montant)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
