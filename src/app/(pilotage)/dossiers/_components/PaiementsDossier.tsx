"use client";

import { useState } from "react";
import { AlertTriangle, Ban, CircleCheck, Landmark, Pencil, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ModaleActionEncaissement, type TypeActionEncaissement } from "@/components/pilotage/ActionsEncaissement";
import { ChampsPaiement, lirePaiement, saisiePaiement, type SaisiePaiement } from "@/components/pilotage/SaisiePaiement";
import { Pastille } from "@/components/pilotage/ui";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { DossierDetail } from "@/lib/dossiers/types";
import { LIBELLES_MOYEN } from "@/lib/encaissements/constantes";
import type { EncaissementVue, PieceVue } from "@/lib/encaissements/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, CLASSE_SAISIE, Modale, TitreSection } from "./ui";

const AUTOMATIQUE = "";

/** Montant attendu : reste des factures, sinon l'acompte prévu au devis en vigueur. */
export function montantAttendu(detail: DossierDetail): number | null {
  const { paiements } = detail;
  if (paiements.resteDu > 0) return paiements.resteDu;
  if (paiements.pieces.some((piece) => piece.type === "FACTURE" && piece.active)) return null;
  const devis = detail.documents.filter((document) => document.type === "DEVIS" && document.numero && !["REMPLACE", "NON_RETENU", "ANNULEE"].includes(document.statut));
  const enVigueur = devis.find((document) => document.statut === "ACCEPTE") ?? devis[0];
  if (!enVigueur || paiements.acompteEnregistre) return null;
  return enVigueur.acomptePct ? Math.round(enVigueur.totalHt * enVigueur.acomptePct) / 100 : null;
}

function libellePiece(piece: PieceVue): string {
  if (piece.type === "DEVIS") return `Acompte sur le devis ${piece.numero}`;
  return `Facture ${piece.numero}${piece.reste !== null ? ` · reste ${formatMontant(piece.reste)}` : ""}`;
}

export function ModalePaiement({ detail, onFermer, onFait, moyenParDefaut = null, titre }: { detail: DossierDetail; onFermer: () => void; onFait: (detail: DossierDetail) => void; moyenParDefaut?: SaisiePaiement["moyen"]; titre?: string }) {
  // Une facture en cours : le paiement la règle ; sinon, c'est un acompte sur un devis.
  const factureActive = detail.paiements.pieces.some((piece) => piece.type === "FACTURE" && piece.active);
  const pieces = detail.paiements.pieces.filter((piece) =>
    factureActive ? piece.type === "FACTURE" && piece.active && (piece.reste ?? 0) > 0 : piece.type === "DEVIS" && piece.active
  );
  const [saisie, setSaisie] = useState<SaisiePaiement>(() => ({ ...saisiePaiement(montantAttendu(detail)), moyen: moyenParDefaut }));
  const [piece, setPiece] = useState(AUTOMATIQUE);
  const [envoi, setEnvoi] = useState(false);
  const { paiement } = lirePaiement(saisie);

  async function enregistrer() {
    if (!paiement) return;
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}/encaissements`, "POST", {
        paiement,
        numeroDocumentId: piece || null,
      });
      onFait(nouveau);
      toast.success("Paiement enregistré", {
        description: nouveau.etape !== detail.etape ? `Le dossier passe à l'étape suivante.` : undefined,
      });
      onFermer();
    } catch (erreur) {
      toast.error("Paiement non enregistré", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={titre ?? "Enregistrer un paiement reçu"}
      description="À la date où il a été reçu, même avant l'ouverture du dossier. Sans devis ni facture, il reste non imputé : il ira sur la facture."
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" disabled={!paiement} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer le paiement
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ChampsPaiement saisie={saisie} onChange={setSaisie} />
        {pieces.length === 0 ? (
          <p className="text-[12px] text-[#9CA3AF]">Aucun devis ni facture dans ce dossier : le paiement est gardé non imputé, et imputé sur la facture à venir.</p>
        ) : null}
        {pieces.length > 1 ? (
          <div>
            <label htmlFor="piece-reglee" className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
              Ce paiement règle
            </label>
            <select id="piece-reglee" value={piece} onChange={(evenement) => setPiece(evenement.target.value)} className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}>
              <option value={AUTOMATIQUE}>
                {factureActive ? "Automatique : factures non réglées, la plus ancienne d'abord" : "Automatique : acompte sur le devis en vigueur"}
              </option>
              {pieces.map((option) => (
                <option key={option.registreId} value={option.registreId}>
                  {libellePiece(option)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </Modale>
  );
}

const FORMAT_MOIS = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" });
const libelleMois = (jour: string) => FORMAT_MOIS.format(new Date(`${jour}T12:00:00Z`));

/** Correction d'un paiement enregistré : montant, date, moyen, référence. L'ancienne valeur reste au journal. */
function ModaleCorrection({ detail, encaissement, onFermer, onFait }: { detail: DossierDetail; encaissement: EncaissementVue; onFermer: () => void; onFait: (detail: DossierDetail) => void }) {
  const initiale: SaisiePaiement = {
    montant: String(encaissement.montant).replace(".", ","),
    recuLe: jourParis(encaissement.recuLe),
    moyen: encaissement.moyen,
    reference: encaissement.reference ?? "",
  };
  const [saisie, setSaisie] = useState<SaisiePaiement>(initiale);
  const [envoi, setEnvoi] = useState(false);
  const { paiement } = lirePaiement(saisie);
  const moisCourant = jourParis(new Date()).slice(0, 7);
  // Un mois passé du livre des recettes change : peut-être déjà déclaré.
  const moisTouches = paiement
    ? [...new Set([initiale.recuLe, paiement.recuLe].filter((jour) => jour.slice(0, 7) < moisCourant).map((jour) => jour.slice(0, 7)))]
    : [];
  const change =
    paiement !== null &&
    (paiement.montant !== encaissement.montant || paiement.recuLe !== initiale.recuLe || paiement.moyen !== encaissement.moyen || (paiement.reference ?? "") !== (encaissement.reference ?? ""));

  async function enregistrer() {
    if (!paiement || !change) return;
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/encaissements/${encaissement.id}`, "PATCH", {
        ...(paiement.montant !== encaissement.montant ? { montant: paiement.montant } : {}),
        ...(paiement.recuLe !== initiale.recuLe ? { recuLe: paiement.recuLe } : {}),
        ...(paiement.moyen !== encaissement.moyen ? { moyen: paiement.moyen } : {}),
        ...((paiement.reference ?? "") !== (encaissement.reference ?? "") ? { reference: paiement.reference } : {}),
      });
      onFait(nouveau);
      toast.success("Paiement corrigé", { description: nouveau.etape !== detail.etape ? "L'étape du dossier suit." : "L'ancienne valeur reste au journal." });
      onFermer();
    } catch (erreur) {
      toast.error("Correction non enregistrée", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre="Corriger ce paiement"
      description="Montant, date de réception, moyen ou référence : la correction est tracée, l'ancienne valeur reste au journal."
      pied={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" disabled={!paiement || !change} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer la correction
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <ChampsPaiement saisie={saisie} onChange={setSaisie} />
        {change && moisTouches.length > 0 ? (
          <p className="flex gap-1.5 rounded-[8px] bg-[#EF9F27]/10 px-3 py-2 text-[12.5px] text-[#F5B454]">
            <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
            Le livre des recettes de {moisTouches.map((mois) => libelleMois(`${mois}-15`)).join(" et ")} change : si ce mois est déjà déclaré, la déclaration est à corriger.
          </p>
        ) : null}
      </div>
    </Modale>
  );
}

type Action = { type: TypeActionEncaissement; encaissement: EncaissementVue };

function imputations(encaissement: EncaissementVue): string {
  const actives = encaissement.affectations.filter((affectation) => affectation.statut === "ACTIVE");
  const transferees = encaissement.affectations.filter((affectation) => affectation.statut === "TRANSFEREE");
  const parties = actives.map((affectation) =>
    affectation.type === "DEVIS" ? `acompte sur le devis ${affectation.numero}` : `facture ${affectation.numero}`
  );
  if (transferees.length > 0 && actives.some((affectation) => affectation.type === "FACTURE")) {
    parties[0] = `acompte (devis ${transferees[0].numero}) imputé sur la ${parties[0]}`;
  }
  if (encaissement.statut === "VALIDE" && encaissement.nonAffecte > 0) parties.push(`${formatMontant(encaissement.nonAffecte)} non imputés`);
  return parties.join(" · ");
}

function LigneEncaissement({
  encaissement,
  onAction,
  onCorriger,
}: {
  encaissement: EncaissementVue;
  onAction: (action: Action) => void;
  onCorriger: (encaissement: EncaissementVue) => void;
}) {
  const termine = encaissement.statut !== "VALIDE";
  const aCrediter = encaissement.statut === "VALIDE" && encaissement.moyen === "CHEQUE" && !encaissement.crediteLe;
  return (
    <li className="border-t-[0.5px] border-[#2A2D34] px-3.5 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={cn("text-[14px] font-medium tabular-nums", termine ? "text-[#6B7280] line-through" : "text-[#F2F3F5]")}>
          {formatMontant(encaissement.montant)}
        </span>
        <span className="text-[12.5px] text-[#9CA3AF]">
          {encaissement.moyen ? LIBELLES_MOYEN[encaissement.moyen] : "Moyen non renseigné"}
          {encaissement.reference ? ` n° ${encaissement.reference}` : ""} · reçu le {formatDateCourte(encaissement.recuLe)}
        </span>
        {aCrediter ? <Pastille ton="ambre">À créditer</Pastille> : null}
        {encaissement.crediteLe ? <span className="text-[12px] text-[#6B7280]">crédité le {formatDateCourte(encaissement.crediteLe)}</span> : null}
        {encaissement.statut === "REJETE" ? <Pastille ton="rouge">Rejeté le {formatDateCourte(encaissement.finLe!)}</Pastille> : null}
        {encaissement.statut === "ANNULE" ? <Pastille>Annulé</Pastille> : null}
      </div>
      {imputations(encaissement) ? <p className="mt-0.5 text-[12px] text-[#6B7280]">{imputations(encaissement)}</p> : null}
      {termine && encaissement.motifFin ? <p className="mt-0.5 text-[12px] text-[#9CA3AF]">Motif : {encaissement.motifFin}</p> : null}
      {encaissement.statut === "VALIDE" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {aCrediter ? (
            <>
              <Bouton taille="sm" icone={<Landmark size={13} aria-hidden />} onClick={() => onAction({ type: "credit", encaissement })}>
                Crédité
              </Bouton>
              <Bouton taille="sm" variante="danger" icone={<Ban size={13} aria-hidden />} onClick={() => onAction({ type: "rejet", encaissement })}>
                Rejeté
              </Bouton>
            </>
          ) : null}
          <Bouton taille="sm" variante="fantome" icone={<Pencil size={13} aria-hidden />} onClick={() => onCorriger(encaissement)}>
            Corriger
          </Bouton>
          <Bouton taille="sm" variante="fantome" icone={<Undo2 size={13} aria-hidden />} onClick={() => onAction({ type: "annulation", encaissement })}>
            Annuler (erreur)
          </Bouton>
        </div>
      ) : null}
    </li>
  );
}

export function PaiementsDossier({ detail, onMisAJour, sansTitre = false }: { detail: DossierDetail; onMisAJour: (detail: DossierDetail) => void; sansTitre?: boolean }) {
  const [saisie, setSaisie] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [correction, setCorrection] = useState<EncaissementVue | null>(null);
  const { paiements } = detail;
  const factures = paiements.pieces.filter((piece) => piece.type === "FACTURE" && piece.active);
  const facture = factures.reduce((somme, piece) => somme + (piece.total ?? 0), 0);
  const recu = paiements.encaissements.filter((encaissement) => encaissement.statut === "VALIDE").reduce((somme, encaissement) => somme + encaissement.montant, 0);
  const aDocuments = paiements.pieces.length > 0;

  const actions = (
    <Bouton taille="sm" variante="secondaire" icone={<Plus size={13} aria-hidden />} onClick={() => setSaisie(true)}>
      Paiement reçu
    </Bouton>
  );

  return (
    <section>
      {sansTitre ? <div className="mb-3 flex justify-end">{actions}</div> : <TitreSection action={actions}>Paiements</TitreSection>}

      {!aDocuments && paiements.encaissements.length === 0 ? (
        <p className="text-[12.5px] text-[#6B7280]">Aucun paiement enregistré.</p>
      ) : (
        <div className="overflow-hidden rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b-[0.5px] border-[#2A2D34] px-3.5 py-2.5 text-[12.5px]">
            {factures.length > 0 ? (
              <>
                <span className="text-[#9CA3AF]">
                  Facturé <span className="text-[#F2F3F5] tabular-nums">{formatMontant(facture)}</span>
                </span>
                <span className="text-[#9CA3AF]">
                  Reçu <span className="text-[#F2F3F5] tabular-nums">{formatMontant(recu)}</span>
                </span>
                {paiements.soldeEncaisse ? (
                  <span className="flex items-center gap-1 text-[#5DCAA5]">
                    <CircleCheck size={13} aria-hidden /> Factures réglées
                  </span>
                ) : (
                  <span className="text-[#F5B454]">
                    Reste à encaisser <span className="font-medium tabular-nums">{formatMontant(paiements.resteDu)}</span>
                  </span>
                )}
              </>
            ) : (
              <span className="text-[#9CA3AF]">
                {recu > 0 ? (
                  <>
                    Reçu avant facture <span className="text-[#F2F3F5] tabular-nums">{formatMontant(recu)}</span>
                  </>
                ) : (
                  "Aucun paiement reçu pour l'instant."
                )}
              </span>
            )}
            {paiements.nonAffecte > 0 ? (
              <span className="text-[#F5B454]">{formatMontant(paiements.nonAffecte)} reçus non imputés</span>
            ) : null}
          </div>
          {paiements.encaissements.length > 0 ? (
            <ul>
              {paiements.encaissements.map((encaissement) => (
                <LigneEncaissement key={encaissement.id} encaissement={encaissement} onAction={setAction} onCorriger={setCorrection} />
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {saisie ? <ModalePaiement detail={detail} onFermer={() => setSaisie(false)} onFait={onMisAJour} /> : null}
      {correction ? (
        <ModaleCorrection key={correction.id} detail={detail} encaissement={correction} onFermer={() => setCorrection(null)} onFait={onMisAJour} />
      ) : null}
      {action ? (
        <ModaleActionEncaissement<DossierDetail>
          key={`${action.type}:${action.encaissement.id}`}
          encaissement={action.encaissement}
          type={action.type}
          onFermer={() => setAction(null)}
          onFait={onMisAJour}
          precisionSucces={(nouveau) => (nouveau.etape !== detail.etape ? "L'étape du dossier suit : la facture est de nouveau due." : undefined)}
        />
      ) : null}
    </section>
  );
}
