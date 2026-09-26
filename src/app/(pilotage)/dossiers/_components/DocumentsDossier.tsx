"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FilePlus2, FileUp, Mail, Pencil, Receipt, RefreshCw, Send, Undo2 } from "lucide-react";
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
import { appelApi, envoyerJson, messageErreur } from "./client";
import { ModaleDocumentExistant } from "./DocumentExistant";
import { Bouton, Champ, Modale, TitreSection, TRANS, ZoneTexte } from "./ui";
import { Pastille, Puces } from "@/components/pilotage/ui";

const CLASSE_LIEN_ICONE = cn(
  "inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-[0.5px] border-[#2A2D34] text-[#9CA3AF] hover:border-[#3A3E47] hover:bg-[#22262D] hover:text-[#F2F3F5] sm:h-8 sm:w-8",
  TRANS
);

const TON_STATUT: Partial<Record<DocumentVue["statut"], string>> = {
  ACCEPTE: "bg-[#112B22] text-[#5DCAA5]",
  ANNULEE: "bg-[#EF4444]/10 text-[#F87171]",
  REMPLACE: "bg-[#22262D] text-[#6B7280] line-through",
  REFUSE: "bg-[#EF4444]/10 text-[#F87171]",
  NON_RETENU: "bg-[#22262D] text-[#6B7280]",
};

/** Mission 11 : un devis émis qui ne sera pas signé — annulé, gardé en historique (jamais un devis accepté). */
function ModaleAnnulationDevis({ detail, devis, onFermer, onFait }: { detail: DossierDetail; devis: DocumentVue; onFermer: () => void; onFait: (detail: DossierDetail) => void }) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function annuler() {
    setEnvoi(true);
    try {
      const reponse = await envoyerJson<{ dossier: DossierDetail }>(`/api/dossiers/${detail.id}/documents/${devis.id}/annulation`, "POST", { motif: motif.trim() });
      onFait(reponse.dossier);
      toast.success(`Devis ${devis.numero} annulé`, { description: "Il reste dans l'historique du dossier ; le client ne le voit plus." });
      onFermer();
    } catch (erreur) {
      toast.error("Annulation impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={`Annuler le devis ${devis.numero}`}
      description="Un devis émis ne s'efface pas : il passe « Annulé » et reste dans l'historique. Son numéro n'est jamais réutilisé."
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Retour
          </Bouton>
          <Bouton variante="danger" icone={<Undo2 size={14} aria-hidden />} chargement={envoi} onClick={() => void annuler()}>
            Annuler le devis
          </Bouton>
        </div>
      }
    >
      <Champ libelle="Motif (facultatif)" maxLength={300} placeholder="Ex. le client a choisi une autre formule" value={motif} onChange={(evenement) => setMotif(evenement.target.value)} />
    </Modale>
  );
}

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

type Brouillon = { a: string; objet: string; texte: string };

/** Envoi d'un devis ou d'une facture par mail : brouillon pré-rempli, relu, envoyé par la file. */
function ModaleEnvoiMail({ detail, document, onFermer }: { detail: DossierDetail; document: DocumentVue; onFermer: () => void }) {
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const url = `/api/dossiers/${detail.id}/documents/${document.id}/mail`;

  useEffect(() => {
    let actif = true;
    appelApi<Brouillon>(url)
      .then((reponse) => actif && setBrouillon(reponse))
      .catch((probleme) => actif && setErreur(messageErreur(probleme)));
    return () => {
      actif = false;
    };
  }, [url]);

  const complet = Boolean(brouillon && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brouillon.a.trim()) && brouillon.objet.trim() && brouillon.texte.trim());

  async function envoyer() {
    if (!brouillon || !complet) return;
    setEnvoi(true);
    try {
      await envoyerJson(url, "POST", brouillon);
      toast.success("Mail en cours d'envoi", { description: "Il part dans quelques secondes ; l'envoi s'inscrit dans l'historique du dossier." });
      onFermer();
    } catch (probleme) {
      toast.error("Envoi refusé", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre={`Envoyer ${document.type === "DEVIS" ? "le devis" : "la facture"} ${document.numero}`}
      description="Le PDF est joint. Relis le message : il part tel quel, et reste dans l'historique du dossier."
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<Send size={14} aria-hidden />} disabled={!complet} chargement={envoi} onClick={() => void envoyer()}>
            Envoyer
          </Bouton>
        </div>
      }
    >
      {erreur ? (
        <p className="text-[13px] text-[#F87171]">{erreur}</p>
      ) : !brouillon ? (
        <p className="text-[13px] text-[#9CA3AF]">Préparation du message…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Champ libelle="Destinataire" obligatoire type="email" value={brouillon.a} onChange={(evenement) => setBrouillon({ ...brouillon, a: evenement.target.value })} />
          <Champ libelle="Objet" obligatoire maxLength={200} value={brouillon.objet} onChange={(evenement) => setBrouillon({ ...brouillon, objet: evenement.target.value })} />
          <ZoneTexte libelle="Message" obligatoire rows={10} maxLength={10000} value={brouillon.texte} onChange={(evenement) => setBrouillon({ ...brouillon, texte: evenement.target.value })} />
        </div>
      )}
    </Modale>
  );
}

export function DocumentsDossier({
  detail,
  onGenerer,
  onRefaire,
  onMisAJour,
  sansTitre = false,
}: {
  detail: DossierDetail;
  onGenerer: (type: TypeDocument) => void;
  onRefaire: (devis: DocumentVue) => void;
  onMisAJour: (detail: DossierDetail) => void;
  sansTitre?: boolean;
}) {
  const [aAnnuler, setAAnnuler] = useState<DocumentVue | null>(null);
  const [devisAAnnuler, setDevisAAnnuler] = useState<DocumentVue | null>(null);
  const [aEnvoyer, setAEnvoyer] = useState<DocumentVue | null>(null);
  // Document émis avant le CRM : nouveau rattachement (null) ou correction d'un document repris.
  const [existant, setExistant] = useState<{ document?: DocumentVue } | null>(null);
  // Rien n'empêche de générer : l'étape inhabituelle est seulement dite.
  const remarque =
    detail.etape === "PERDU" || detail.etape === "EN_PAUSE"
      ? `Dossier ${detail.etape === "PERDU" ? "perdu" : "en pause"} : le document se génère quand même, l'étape ne change pas.`
      : detail.etape === "ENCAISSE"
        ? "Dossier encaissé : pour une nouvelle prestation, un nouveau dossier est souvent plus clair."
        : null;
  const documents = detail.documents.filter((document) => document.numero);

  return (
    <section>
      {sansTitre ? null : <TitreSection>Documents</TitreSection>}
      <div className="flex flex-wrap gap-2">
        <Bouton variante="primaire" icone={<FilePlus2 size={14} aria-hidden />} onClick={() => onGenerer("DEVIS")}>
          Générer un devis
        </Bouton>
        <Bouton variante="secondaire" icone={<Receipt size={14} aria-hidden />} onClick={() => onGenerer("FACTURE")}>
          Générer une facture
        </Bouton>
        <Bouton variante="fantome" icone={<FileUp size={14} aria-hidden />} onClick={() => setExistant({})}>
          Enregistrer un document existant
        </Bouton>
      </div>
      {remarque ? <p className="mt-2 text-[12px] text-[#F5B454]">{remarque}</p> : null}

      {documents.length === 0 ? (
        <p className="mt-3 text-[12px] text-[#6B7280]">Aucun devis ni facture pour ce dossier.</p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {documents.map((document) => {
            const avoir = document.documentsLies.find((lie) => lie.type === "AVOIR");
            const remplacant = document.documentsLies.find((lie) => lie.type === "DEVIS");
            const peutRefaire = document.type === "DEVIS" && ["GENERE", "ENVOYE", "REFUSE", "NON_RETENU"].includes(document.statut);
            const peutAnnuler = document.type === "FACTURE" && document.statut !== "ANNULEE";
            const peutAnnulerDevis = document.type === "DEVIS" && ["GENERE", "ENVOYE", "REFUSE", "NON_RETENU"].includes(document.statut);
            const peutEnvoyer =
              (document.type === "DEVIS" || document.type === "FACTURE") && !["REMPLACE", "ANNULEE", "NON_RETENU"].includes(document.statut) && document.pdfUrl !== null;
            const repris = document.origine === "REPRISE";
            return (
              <li key={document.id} className="border-t-[0.5px] border-[#2A2D34] px-3 py-2.5 first:border-t-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-[#F2F3F5]">
                      <span className="font-medium">
                        {LIBELLES_TYPE_DOCUMENT[document.type]} {document.numero}
                      </span>
                      {document.libelleVariante ? <span className="text-[#9CA3AF]">« {document.libelleVariante} »</span> : null}
                      <span className={cn("rounded-full px-1.5 py-px text-[10px]", TON_STATUT[document.statut] ?? "bg-[#22262D] text-[#9CA3AF]")}>
                        {/* Une facture reprise n'a pas été générée ici : elle a été émise avant le CRM. */}
                        {repris && document.statut === "GENERE" ? "Émise" : LIBELLES_STATUT_DOCUMENT[document.statut]}
                      </span>
                      {repris ? <Pastille titre="Émis avant le CRM, rattaché avec son numéro du registre">Repris</Pastille> : null}
                      {document.type === "DEVIS" && !document.visibleEspace && !["REMPLACE", "ANNULEE", "NON_RETENU"].includes(document.statut) ? <Pastille ton="ambre" titre="Le client ne le voit pas dans son espace">Masqué dans l&apos;espace</Pastille> : null}
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
                {repris && !document.pdfUrl ? <p className="mt-1 text-[12px] text-[#9CA3AF]">PDF non importé.</p> : null}
                {peutRefaire || peutAnnuler || peutAnnulerDevis || peutEnvoyer || repris ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {repris ? (
                      <Bouton taille="sm" variante="fantome" icone={document.pdfUrl ? <Pencil size={13} aria-hidden /> : <FileUp size={13} aria-hidden />} onClick={() => setExistant({ document })}>
                        {document.pdfUrl ? "Corriger" : "Corriger, importer le PDF"}
                      </Bouton>
                    ) : null}
                    {peutEnvoyer ? (
                      <Bouton taille="sm" variante="fantome" icone={<Mail size={13} aria-hidden />} onClick={() => setAEnvoyer(document)}>
                        Envoyer par mail
                      </Bouton>
                    ) : null}
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
                    {peutAnnulerDevis ? (
                      <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} onClick={() => setDevisAAnnuler(document)}>
                        Annuler ce devis
                      </Bouton>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {aEnvoyer ? <ModaleEnvoiMail key={aEnvoyer.id} detail={detail} document={aEnvoyer} onFermer={() => setAEnvoyer(null)} /> : null}
      {existant ? (
        <ModaleDocumentExistant key={existant.document?.id ?? "nouveau"} detail={detail} document={existant.document} onFermer={() => setExistant(null)} onMisAJour={onMisAJour} />
      ) : null}
      {aAnnuler ? (
        <ModaleAvoir detail={detail} facture={aAnnuler} onFermer={() => setAAnnuler(null)} onFait={onMisAJour} />
      ) : null}
      {devisAAnnuler ? <ModaleAnnulationDevis key={devisAAnnuler.id} detail={detail} devis={devisAAnnuler} onFermer={() => setDevisAAnnuler(null)} onFait={onMisAJour} /> : null}
    </section>
  );
}
