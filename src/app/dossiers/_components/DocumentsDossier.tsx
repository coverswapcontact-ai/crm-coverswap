"use client";

import { Download, ExternalLink, FilePlus2, Receipt } from "lucide-react";
import {
  LIBELLES_STATUT_DOCUMENT,
  LIBELLES_TYPE_DOCUMENT,
  type TypeDocument,
} from "@/lib/dossiers/constants";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { Bouton, TitreSection, TRANS } from "./ui";

const CLASSE_LIEN_ICONE = cn(
  "inline-flex h-10 w-10 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34] text-[#9CA3AF] hover:border-[#3A3E47] hover:bg-[#22262D] hover:text-[#F2F3F5] sm:h-8 sm:w-8",
  TRANS
);

export function DocumentsDossier({
  detail,
  onGenerer,
}: {
  detail: DossierDetail;
  onGenerer: (type: TypeDocument) => void;
}) {
  const bloque =
    detail.etape === "PERDU" || detail.etape === "EN_PAUSE"
      ? "Reprends le dossier pour générer un document."
      : detail.etape === "ENCAISSE"
        ? "Dossier encaissé : une nouvelle prestation ouvre un nouveau dossier."
        : null;
  const documents = detail.documents.filter((document) => document.numero);

  return (
    <section>
      <TitreSection>Documents</TitreSection>
      <div className="flex flex-wrap gap-2">
        <Bouton
          variante="primaire"
          icone={<FilePlus2 size={14} aria-hidden />}
          disabled={bloque !== null}
          onClick={() => onGenerer("DEVIS")}
        >
          Générer un devis
        </Bouton>
        <Bouton
          variante="secondaire"
          icone={<Receipt size={14} aria-hidden />}
          disabled={bloque !== null}
          onClick={() => onGenerer("FACTURE")}
        >
          Générer une facture
        </Bouton>
      </div>
      {bloque ? <p className="mt-2 text-[12px] text-[#9CA3AF]">{bloque}</p> : null}

      {documents.length === 0 ? (
        <p className="mt-3 text-[12px] text-[#6B7280]">Aucun document généré pour ce dossier.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex items-center gap-3 border-t-[0.5px] border-[#2A2D34] px-3 py-2.5 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-[#F2F3F5]">
                  <span className="font-medium">
                    {LIBELLES_TYPE_DOCUMENT[document.type]} {document.numero}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px text-[10px]",
                      document.statut === "ACCEPTE" ? "bg-[#112B22] text-[#5DCAA5]" : "bg-[#22262D] text-[#9CA3AF]"
                    )}
                  >
                    {LIBELLES_STATUT_DOCUMENT[document.statut]}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
                  {document.dateEmission ? formatDateCourte(document.dateEmission) : null} · {document.objet}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-[#F2F3F5] tabular-nums">{formatMontant(document.totalHt)}</span>
              {document.pdfUrl ? (
                <span className="flex shrink-0 gap-1.5">
                  <a
                    href={document.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={CLASSE_LIEN_ICONE}
                    aria-label={`Ouvrir le PDF ${document.numero}`}
                    title="Ouvrir le PDF"
                  >
                    <ExternalLink size={14} aria-hidden />
                  </a>
                  <a
                    href={`${document.pdfUrl}?telecharger=1`}
                    className={CLASSE_LIEN_ICONE}
                    aria-label={`Télécharger le PDF ${document.numero}`}
                    title="Télécharger le PDF"
                  >
                    <Download size={14} aria-hidden />
                  </a>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
