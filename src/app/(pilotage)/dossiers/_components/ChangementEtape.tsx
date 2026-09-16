"use client";

import { useState } from "react";
import { ArrowRight, Pause, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  LIBELLES_CRITERE,
  LIBELLES_ETAPE,
  LIBELLES_MOTIF_PERTE,
  MOTIFS_PERTE,
  REGLES_ETAPES,
  type CritereEntree,
  type EtapeDossier,
  type MotifPerte,
} from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import {
  CRITERES_DECLARATIFS,
  critereRempli,
  criteresAVerifier,
  estCritereDeclaratif,
  transitionsPossibles,
  type CritereDeclaratif,
  type TransitionPossible,
} from "@/lib/dossiers/regles";
import { faitsDepuisDetail, type DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, CaseACocher, Champ, CLASSE_SAISIE, Modale, TitreSection, TRANS } from "./ui";

type DonneesEtape = {
  motifPerte?: MotifPerte;
  dateChantier?: string;
  confirmations?: Partial<Record<CritereDeclaratif, boolean>>;
  devisAccepteId?: string;
};

// Critères qui se renseignent dans la fenêtre de changement d'étape
// (les autres dépendent du dossier : devis généré, photo…).
const saisiDansLaFenetre = (critere: CritereEntree) =>
  estCritereDeclaratif(critere) || critere === "MOTIF_PERTE" || critere === "DATE_CHANTIER";

function libelleTransition(transition: TransitionPossible): string {
  if (transition.nature === "REPRISE") return `Reprendre en « ${LIBELLES_ETAPE[transition.vers]} »`;
  if (transition.vers === "PERDU") return "Marquer perdu";
  if (transition.vers === "EN_PAUSE") return "Mettre en pause";
  return LIBELLES_ETAPE[transition.vers];
}

export function ChangementEtape({
  detail,
  onMisAJour,
}: {
  detail: DossierDetail;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const [enCours, setEnCours] = useState<EtapeDossier | null>(null);
  const [fenetre, setFenetre] = useState<TransitionPossible | null>(null);

  const faits = faitsDepuisDetail(detail);
  const transitions = transitionsPossibles(detail.etape, detail.etapeAvantSortie);
  const enAvant = transitions.filter((t) => t.nature === "SUIVANTE" || t.nature === "REPRISE");
  const sorties = transitions.filter((t) => t.nature === "SORTIE");
  const retours = transitions.filter((t) => t.nature === "RETOUR");

  const manquants = (transition: TransitionPossible) =>
    criteresAVerifier(transition).filter((critere) => !saisiDansLaFenetre(critere) && !critereRempli(critere, faits));

  async function executer(transition: TransitionPossible, donnees: DonneesEtape = {}) {
    setEnCours(transition.vers);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}/etape`, "POST", {
        vers: transition.vers,
        ...donnees,
      });
      onMisAJour(nouveau);
      setFenetre(null);
      toast.success(`Dossier passé à « ${LIBELLES_ETAPE[transition.vers]} »`);
    } catch (probleme) {
      toast.error("Changement d'étape refusé", { description: messageErreur(probleme) });
    } finally {
      setEnCours(null);
    }
  }

  function choisir(transition: TransitionPossible) {
    const aSaisir = criteresAVerifier(transition).some(saisiDansLaFenetre);
    if (aSaisir || transition.nature === "RETOUR") setFenetre(transition);
    else void executer(transition);
  }

  return (
    <section>
      <TitreSection>Étape</TitreSection>
      <div className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5">
        <p className="text-[13px] text-[#F2F3F5]">
          <span className="font-medium">{LIBELLES_ETAPE[detail.etape]}</span>
          <span className="text-[#9CA3AF]"> · {REGLES_ETAPES[detail.etape].description}</span>
        </p>
        {detail.etape === "PERDU" && detail.motifPerte ? (
          <p className="mt-1 text-[12px] text-[#F87171]">Motif : {LIBELLES_MOTIF_PERTE[detail.motifPerte]}</p>
        ) : null}
        {detail.dateChantier ? (
          <p className="mt-1 text-[12px] text-[#9CA3AF]">Chantier prévu le {formatDateCourte(detail.dateChantier)}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {enAvant.map((transition) => {
            const bloquants = manquants(transition);
            return (
              <Bouton
                key={transition.vers}
                variante="primaire"
                disabled={bloquants.length > 0}
                chargement={enCours === transition.vers}
                icone={
                  transition.nature === "REPRISE" ? <RotateCcw size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />
                }
                onClick={() => choisir(transition)}
              >
                {libelleTransition(transition)}
              </Bouton>
            );
          })}
          {sorties.map((transition) => (
            <Bouton
              key={transition.vers}
              variante={transition.vers === "PERDU" ? "danger" : "secondaire"}
              chargement={enCours === transition.vers}
              icone={transition.vers === "PERDU" ? <XCircle size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
              onClick={() => choisir(transition)}
            >
              {libelleTransition(transition)}
            </Bouton>
          ))}
        </div>

        {enAvant.some((transition) => manquants(transition).length > 0) ? (
          <ul className="mt-2.5 space-y-1">
            {enAvant.map((transition) => {
              const bloquants = manquants(transition);
              if (bloquants.length === 0) return null;
              return (
                <li key={transition.vers} className="text-[12px] text-[#9CA3AF]">
                  Pour « {LIBELLES_ETAPE[transition.vers]} » :{" "}
                  {bloquants
                    .map((critere) =>
                      critere === "DEVIS_GENERE"
                        ? "générer un devis"
                        : critere === "FACTURE_GENEREE"
                          ? "générer une facture"
                          : LIBELLES_CRITERE[critere].toLowerCase()
                    )
                    .join(", ")}
                  .
                </li>
              );
            })}
          </ul>
        ) : null}

        {retours.length > 0 ? (
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[#6B7280]">
            <RotateCcw size={12} aria-hidden />
            <span className="sr-only">Revenir à une étape précédente</span>
            <select
              value=""
              onChange={(evenement) => {
                const transition = retours.find((t) => t.vers === evenement.target.value);
                if (transition) choisir(transition);
              }}
              className={cn(
                "h-9 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-transparent px-2 text-[16px] text-[#9CA3AF] hover:border-[#3A3E47] sm:h-7 sm:text-[12px] [color-scheme:dark]",
                TRANS
              )}
            >
              <option value="">Revenir à une étape précédente…</option>
              {retours.map((transition) => (
                <option key={transition.vers} value={transition.vers}>
                  {LIBELLES_ETAPE[transition.vers]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {fenetre ? (
        <FenetreEtape
          key={fenetre.vers}
          detail={detail}
          transition={fenetre}
          enCours={enCours === fenetre.vers}
          onFermer={() => setFenetre(null)}
          onValider={(donnees) => executer(fenetre, donnees)}
        />
      ) : null}
    </section>
  );
}

function FenetreEtape({
  detail,
  transition,
  enCours,
  onFermer,
  onValider,
}: {
  detail: DossierDetail;
  transition: TransitionPossible;
  enCours: boolean;
  onFermer: () => void;
  onValider: (donnees: DonneesEtape) => void;
}) {
  const criteres = criteresAVerifier(transition);
  const devis = detail.documents.filter((document) => document.type === "DEVIS" && document.statut !== "BROUILLON");
  const [motif, setMotif] = useState<MotifPerte | "">("");
  const [dateChantier, setDateChantier] = useState(detail.dateChantier ? jourParis(detail.dateChantier) : "");
  const [confirmations, setConfirmations] = useState<Record<CritereDeclaratif, boolean>>({
    BON_POUR_ACCORD: false,
    ACOMPTE_ENCAISSE: false,
    SOLDE_ENCAISSE: false,
  });
  const [devisId, setDevisId] = useState(devis[0]?.id ?? "");

  const demandeMotif = criteres.includes("MOTIF_PERTE");
  const demandeDate = criteres.includes("DATE_CHANTIER");
  const declaratifs = CRITERES_DECLARATIFS.filter((critere) => criteres.includes(critere));
  const choixDevis = transition.vers === "SIGNE" && transition.nature === "SUIVANTE" && devis.length > 1;

  const complet =
    (!demandeMotif || motif !== "") &&
    (!demandeDate || dateChantier !== "") &&
    declaratifs.every((critere) => confirmations[critere]);

  const titre =
    transition.nature === "RETOUR"
      ? `Revenir à « ${LIBELLES_ETAPE[transition.vers]} » ?`
      : transition.vers === "PERDU"
        ? "Marquer le dossier perdu"
        : `Passer à « ${LIBELLES_ETAPE[transition.vers]} »`;

  function valider() {
    if (!complet) return;
    onValider({
      ...(demandeMotif && motif ? { motifPerte: motif } : {}),
      ...(demandeDate ? { dateChantier } : {}),
      ...(declaratifs.length > 0 ? { confirmations: Object.fromEntries(declaratifs.map((c) => [c, true])) } : {}),
      ...(transition.vers === "SIGNE" && devisId ? { devisAccepteId: devisId } : {}),
    });
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={titre}
      description={
        transition.nature === "RETOUR"
          ? "Correction d'étape : le retour est tracé dans l'historique du dossier."
          : REGLES_ETAPES[transition.vers].description
      }
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton
            variante={transition.vers === "PERDU" ? "danger" : "primaire"}
            disabled={!complet}
            chargement={enCours}
            onClick={valider}
          >
            {transition.nature === "RETOUR" ? "Revenir à cette étape" : "Confirmer"}
          </Bouton>
        </div>
      }
    >
      <div className="space-y-3">
        {demandeMotif ? (
          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-[#9CA3AF]">
              Motif de perte <span className="text-[#5DCAA5]">*</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {MOTIFS_PERTE.map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  aria-pressed={motif === valeur}
                  onClick={() => setMotif(valeur)}
                  className={cn(
                    "h-10 rounded-[8px] border-[0.5px] px-3 text-left text-[13px] sm:h-9",
                    motif === valeur
                      ? "border-[#EF4444]/50 bg-[#EF4444]/10 text-[#FCA5A5]"
                      : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]",
                    TRANS
                  )}
                >
                  {LIBELLES_MOTIF_PERTE[valeur]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {demandeDate ? (
          <Champ
            libelle="Date du chantier"
            obligatoire
            type="date"
            value={dateChantier}
            onChange={(evenement) => setDateChantier(evenement.target.value)}
          />
        ) : null}

        {choixDevis ? (
          <div>
            <label htmlFor="devis-signe" className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
              Devis signé
            </label>
            <select
              id="devis-signe"
              value={devisId}
              onChange={(evenement) => setDevisId(evenement.target.value)}
              className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}
            >
              {devis.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.numero} · {formatMontant(document.totalHt)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {declaratifs.map((critere) => (
          <CaseACocher
            key={critere}
            libelle={LIBELLES_CRITERE[critere]}
            checked={confirmations[critere]}
            onChange={(valeur) => setConfirmations((actuelles) => ({ ...actuelles, [critere]: valeur }))}
          />
        ))}

        {transition.nature === "RETOUR" ? (
          <p className="text-[13px] text-[#D1D5DB]">
            Le dossier quitte « {LIBELLES_ETAPE[detail.etape]} » pour revenir à « {LIBELLES_ETAPE[transition.vers]} ».
          </p>
        ) : null}
      </div>
    </Modale>
  );
}
