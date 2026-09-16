"use client";

import { useState } from "react";
import { Download, ExternalLink, FilePlus2, Receipt, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useParametresExiges } from "@/components/pilotage/SaisieParametres";
import {
  LIBELLES_STATUT_DOCUMENT,
  LIBELLES_TYPE_DOCUMENT,
  MOTIFS_AVOIR,
  type TypeDocument,
} from "@/lib/dossiers/constants";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, Modale, TitreSection, TRANS } from "./ui";
import { Puces } from "@/components/pilotage/ui";

const CLASSE_LIEN_ICONE = cn(
  "inline-flex h-10 w-10 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34] text-[#9CA3AF] hover:border-[#3A3E47] hover:bg-[#22262D] hover:text-[#F2F3F5] sm:h-8 sm:w-8",
  TRANS
);

const TON_STATUT: Partial<Record<DocumentVue["statut"], string>> = {
  ACCEPTE: "bg-[#112B22] text-[#5DCAA5]",
  ANNULEE: "bg-[#EF4444]/10 text-[#F87171]",
  REMPLACE: "bg-[#22262D] text-[#6B7280] line-through",
  REFUSE: "bg-[#EF4444]/10 text-[#F87171]",
};

function ModaleAvoir({
  detail,
  facture,
  onFermer,
  onFait,
}: {
  detail: DossierDetail;
  facture: DocumentVue;
  onFermer: () => void;
  onFait: (detail: DossierDetail) => void;
}) {
  const [motif, setMotif] = useState<string | null>(null);
  const [precision, setPrecision] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const { executer, modale } = useParametresExiges();

  async function annuler() {
    if (!motif) return;
    setEnvoi(true);
    try {
      await executer(async () => {
        const reponse = await envoyerJson<{ document: { numero: string }; dossier: DossierDetail }>(
          `/api/dossiers/${detail.id}/documents/${facture.id}/avoir`,
          "POST",
          { motif, precision: precision.trim() || undefined }
        );
        onFait(reponse.dossier);
        toast.success(`Avoir ${reponse.document.numero} généré`, {
          description: `La facture ${facture.numero} est annulée. Génère la facture corrigée si besoin.`,
        });
        onFermer();
      });
    } catch (erreur) {
      toast.error("Avoir impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <Modale
        ouverte
        onFermer={onFermer}
        largeur="sm"
        titre={`Annuler la facture ${facture.numero}`}
        description="Une facture émise ne se modifie jamais : un avoir du même montant l'annule, dans la série des factures. La facture et l'avoir restent."
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={onFermer}>
              Retour
            </Bouton>
            <Bouton
              variante="danger"
              icone={<Undo2 size={14} aria-hidden />}
              disabled={!motif || (motif === "AUTRE" && precision.trim().length < 3)}
              chargement={envoi}
              onClick={() => void annuler()}
            >
              Générer l&apos;avoir
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[#D1D5DB]">
            Montant de l&apos;avoir : <span className="font-medium text-[#F2F3F5]">{formatMontant(facture.totalHt)}</span>
          </p>
          <Puces
            libelle="Motif"
            obligatoire
            options={MOTIFS_AVOIR.map((option) => ({ valeur: option.code, libelle: option.libelle }))}
            valeur={motif}
            onChange={setMotif}
          />
          <Champ
            libelle={motif === "AUTRE" ? "Précision" : "Précision (facultative)"}
            obligatoire={motif === "AUTRE"}
            maxLength={300}
            value={precision}
            onChange={(evenement) => setPrecision(evenement.target.value)}
          />
        </div>
      </Modale>
      {modale}
    </>
  );
}

export function DocumentsDossier({
  detail,
  onGenerer,
  onRefaire,
  onMisAJour,
}: {
  detail: DossierDetail;
  onGenerer: (type: TypeDocument) => void;
  onRefaire: (devis: DocumentVue) => void;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const [aAnnuler, setAAnnuler] = useState<DocumentVue | null>(null);
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
        <Bouton variante="primaire" icone={<FilePlus2 size={14} aria-hidden />} disabled={bloque !== null} onClick={() => onGenerer("DEVIS")}>
          Générer un devis
        </Bouton>
        <Bouton variante="secondaire" icone={<Receipt size={14} aria-hidden />} disabled={bloque !== null} onClick={() => onGenerer("FACTURE")}>
          Générer une facture
        </Bouton>
      </div>
      {bloque ? <p className="mt-2 text-[12px] text-[#9CA3AF]">{bloque}</p> : null}

      {documents.length === 0 ? (
        <p className="mt-3 text-[12px] text-[#6B7280]">Aucun document généré pour ce dossier.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {documents.map((document) => {
            const avoir = document.documentsLies.find((lie) => lie.type === "AVOIR");
            const remplacant = document.documentsLies.find((lie) => lie.type === "DEVIS");
            const peutRefaire =
              document.type === "DEVIS" && ["GENERE", "ENVOYE", "REFUSE"].includes(document.statut) && bloque === null;
            const peutAnnuler = document.type === "FACTURE" && document.statut !== "ANNULEE" && detail.etape !== "PERDU" && detail.etape !== "EN_PAUSE";
            return (
              <li key={document.id} className="border-t-[0.5px] border-[#2A2D34] px-3 py-2.5 first:border-t-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-[#F2F3F5]">
                      <span className="font-medium">
                        {LIBELLES_TYPE_DOCUMENT[document.type]} {document.numero}
                      </span>
                      <span className={cn("rounded-full px-1.5 py-px text-[10px]", TON_STATUT[document.statut] ?? "bg-[#22262D] text-[#9CA3AF]")}>
                        {LIBELLES_STATUT_DOCUMENT[document.statut]}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">
                      {document.dateEmission ? formatDateCourte(document.dateEmission) : null} · {document.objet}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-[13px] tabular-nums", document.type === "AVOIR" ? "text-[#F87171]" : "text-[#F2F3F5]")}>
                    {document.type === "AVOIR" ? "−" : ""}
                    {formatMontant(document.totalHt)}
                  </span>
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
                </div>
                {document.echeanceLe && document.type === "FACTURE" ? (
                  <p className="mt-1 text-[12px] text-[#9CA3AF]">Échéance : {formatDateCourte(document.echeanceLe)}</p>
                ) : null}
                {document.type === "AVOIR" && document.documentOrigine ? (
                  <p className="mt-1 text-[12px] text-[#9CA3AF]">
                    Annule la facture {document.documentOrigine.numero}
                    {document.motifAvoir ? ` · ${document.motifAvoir}` : ""}
                  </p>
                ) : null}
                {document.type === "DEVIS" && document.documentOrigine ? (
                  <p className="mt-1 text-[12px] text-[#9CA3AF]">Remplace le devis {document.documentOrigine.numero}</p>
                ) : null}
                {avoir ? <p className="mt-1 text-[12px] text-[#F87171]">Annulée par l&apos;avoir {avoir.numero}</p> : null}
                {remplacant ? <p className="mt-1 text-[12px] text-[#6B7280]">Remplacé par le devis {remplacant.numero}</p> : null}
                {peutRefaire || peutAnnuler ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {peutRefaire ? (
                      <Bouton taille="sm" variante="fantome" icone={<RefreshCw size={13} aria-hidden />} onClick={() => onRefaire(document)}>
                        Refaire ce devis
                      </Bouton>
                    ) : null}
                    {peutAnnuler ? (
                      <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} onClick={() => setAAnnuler(document)}>
                        Annuler par un avoir
                      </Bouton>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {aAnnuler ? (
        <ModaleAvoir detail={detail} facture={aAnnuler} onFermer={() => setAAnnuler(null)} onFait={onMisAJour} />
      ) : null}
    </section>
  );
}
