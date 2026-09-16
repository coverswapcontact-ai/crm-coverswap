"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Pause, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ChampsPaiement, lirePaiement, saisiePaiement, type PaiementLu, type SaisiePaiement } from "@/components/pilotage/SaisiePaiement";
import { Puces } from "@/components/pilotage/ui";
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
import { formatMontant, lireNombre } from "@/lib/dossiers/montants";
import {
  CRITERES_DECLARATIFS,
  avertissementsTransition,
  criteresAVerifier,
  estCritereDeclaratif,
  transitionsPossibles,
  type Avertissement,
  type CritereDeclaratif,
  type DonneesTransition,
  type TransitionPossible,
} from "@/lib/dossiers/regles";
import { faitsDepuisDetail, type DocumentVue, type DossierDetail } from "@/lib/dossiers/types";
import { MOTIFS_SANS_ACOMPTE } from "@/lib/encaissements/constantes";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
import { Bouton, CaseACocher, Champ, CLASSE_SAISIE, Modale, TitreSection, TRANS, ZoneTexte } from "./ui";

type DonneesEtape = {
  motifPerte?: MotifPerte;
  perteConcurrent?: string;
  perteMontantConcurrent?: number;
  perteCommentaire?: string;
  dateChantier?: string;
  confirmations?: Partial<Record<CritereDeclaratif, boolean>>;
  devisAccepteId?: string;
  acompte?: PaiementLu;
  sansAcompte?: { motif: string; precision?: string };
  solde?: PaiementLu;
  survenuLe?: string;
};

// Critères qui se renseignent dans la fenêtre de changement d'étape
// (les autres dépendent du dossier : devis généré, photo…).
const saisiDansLaFenetre = (critere: CritereEntree) =>
  estCritereDeclaratif(critere) ||
  critere === "MOTIF_PERTE" ||
  critere === "DATE_CHANTIER" ||
  critere === "ACOMPTE_ENCAISSE" ||
  critere === "SOLDE_ENCAISSE";

/** Acompte prévu au devis : son pourcentage appliqué à son total. */
const acomptePrevu = (devis: DocumentVue | undefined) =>
  devis?.acomptePct ? Math.round(devis.totalHt * devis.acomptePct) / 100 : null;

function libelleTransition(transition: TransitionPossible): string {
  if (transition.nature === "REPRISE") return `Reprendre en « ${LIBELLES_ETAPE[transition.vers]} »`;
  if (transition.vers === "PERDU") return "Marquer perdu";
  if (transition.vers === "EN_PAUSE") return "Mettre en pause";
  return LIBELLES_ETAPE[transition.vers];
}

/** Ce qui manque, dit avant de confirmer : on peut passer quand même. */
function ListeAvertissements({ avertissements, className }: { avertissements: Avertissement[]; className?: string }) {
  if (avertissements.length === 0) return null;
  return (
    <div className={cn("rounded-[9px] border-[0.5px] border-[#EF9F27]/40 bg-[#EF9F27]/10 px-3 py-2.5", className)}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#F5B454]">
        <AlertTriangle size={13} aria-hidden />
        À savoir avant de passer
      </p>
      <ul className="mt-1.5 space-y-1">
        {avertissements.map((avertissement) => (
          <li key={avertissement.critere} className="text-[12.5px] text-[#FCD9A0]">
            {avertissement.message}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] text-[#C9A46A]">Tu peux passer quand même : ce sera noté dans l&apos;historique du dossier.</p>
    </div>
  );
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
  const enAvant = transitions.filter((t) => t.suggeree && (t.nature === "SUIVANTE" || t.nature === "REPRISE"));
  const sorties = transitions.filter((t) => t.suggeree && t.nature === "SORTIE");
  const autres = transitions.filter((t) => !t.suggeree);

  const avertissements = (transition: TransitionPossible) =>
    avertissementsTransition(faits, transition.vers, {}, detail.etapeAvantSortie);

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
      toast.error("Changement d'étape non enregistré", { description: messageErreur(probleme) });
    } finally {
      setEnCours(null);
    }
  }

  function choisir(transition: TransitionPossible) {
    const aSaisir = criteresAVerifier(detail.etape, transition.vers, detail.etapeAvantSortie).some(saisiDansLaFenetre);
    const direct = transition.suggeree && transition.nature !== "RETOUR" && !aSaisir && avertissements(transition).length === 0;
    if (direct) void executer(transition);
    else setFenetre(transition);
  }

  const versAvancer = autres.filter((t) => t.nature === "SUIVANTE" || t.nature === "REPRISE");
  const versRevenir = autres.filter((t) => t.nature === "RETOUR");
  const versSortir = autres.filter((t) => t.nature === "SORTIE");

  return (
    <section>
      <TitreSection>Étape</TitreSection>
      <div className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-3.5">
        <p className="text-[13px] text-[#F2F3F5]">
          <span className="font-medium">{LIBELLES_ETAPE[detail.etape]}</span>
          <span className="text-[#9CA3AF]"> · {REGLES_ETAPES[detail.etape].description}</span>
        </p>
        {detail.etape === "PERDU" ? (
          <p className="mt-1 text-[12px] text-[#F87171]">
            {detail.motifPerte ? `Motif : ${LIBELLES_MOTIF_PERTE[detail.motifPerte]}` : "Motif non renseigné"}
            {detail.perte?.etape ? ` · à l'étape « ${LIBELLES_ETAPE[detail.perte.etape]} »` : ""}
            {detail.perte?.concurrent ? ` · remporté par ${detail.perte.concurrent}` : ""}
            {detail.perte?.montantConcurrent != null ? ` (${formatMontant(detail.perte.montantConcurrent)})` : ""}
            {detail.perte?.montantPropose != null ? ` · notre prix : ${formatMontant(detail.perte.montantPropose)}` : ""}
          </p>
        ) : null}
        {detail.etape === "PERDU" && detail.perte?.commentaire ? (
          <p className="mt-1 text-[12px] whitespace-pre-wrap text-[#9CA3AF]">{detail.perte.commentaire}</p>
        ) : null}
        {detail.dateChantier ? (
          <p className="mt-1 text-[12px] text-[#9CA3AF]">Chantier le {formatDateCourte(detail.dateChantier)}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {enAvant.map((transition) => {
            const nombre = avertissements(transition).length;
            return (
              <Bouton
                key={transition.vers}
                variante="primaire"
                chargement={enCours === transition.vers}
                icone={transition.nature === "REPRISE" ? <RotateCcw size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                title={nombre > 0 ? `${nombre} point${nombre > 1 ? "s" : ""} à savoir avant de passer` : undefined}
                onClick={() => choisir(transition)}
              >
                {libelleTransition(transition)}
                {nombre > 0 ? (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-[#0B1612]/25 px-1.5 text-[11px]">
                    <AlertTriangle size={10} aria-hidden />
                    {nombre}
                  </span>
                ) : null}
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

        {autres.length > 0 ? (
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[#6B7280]">
            <ArrowRight size={12} aria-hidden />
            <span className="sr-only">Passer à une autre étape</span>
            <select
              value=""
              onChange={(evenement) => {
                const transition = autres.find((t) => t.vers === evenement.target.value);
                if (transition) setFenetre(transition);
              }}
              className={cn(
                "h-9 max-w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-transparent px-2 text-[16px] text-[#9CA3AF] hover:border-[#3A3E47] sm:h-7 sm:text-[12px] [color-scheme:dark]",
                TRANS
              )}
            >
              <option value="">Passer à une autre étape…</option>
              {versAvancer.length > 0 ? (
                <optgroup label="Avancer à">
                  {versAvancer.map((transition) => (
                    <option key={transition.vers} value={transition.vers}>
                      {LIBELLES_ETAPE[transition.vers]}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {versRevenir.length > 0 ? (
                <optgroup label="Revenir à">
                  {versRevenir.map((transition) => (
                    <option key={transition.vers} value={transition.vers}>
                      {LIBELLES_ETAPE[transition.vers]}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {versSortir.length > 0 ? (
                <optgroup label="Sortir">
                  {versSortir.map((transition) => (
                    <option key={transition.vers} value={transition.vers}>
                      {LIBELLES_ETAPE[transition.vers]}
                    </option>
                  ))}
                </optgroup>
              ) : null}
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

type ModeAcompte = "PLUS_TARD" | "RECU" | "SANS";

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
  const criteres = criteresAVerifier(detail.etape, transition.vers, detail.etapeAvantSortie);
  const devis = detail.documents.filter(
    (document) => document.type === "DEVIS" && document.numero && document.statut !== "BROUILLON" && document.statut !== "REMPLACE"
  );
  const [motif, setMotif] = useState<MotifPerte | null>(null);
  const [concurrent, setConcurrent] = useState("");
  const [prixConcurrent, setPrixConcurrent] = useState("");
  const [commentairePerte, setCommentairePerte] = useState("");
  const [dateChantier, setDateChantier] = useState(detail.dateChantier ? jourParis(detail.dateChantier) : "");
  const [confirmations, setConfirmations] = useState<Record<CritereDeclaratif, boolean>>({ BON_POUR_ACCORD: false });
  const [devisId, setDevisId] = useState((devis.find((document) => document.statut === "ACCEPTE") ?? devis[0])?.id ?? "");
  // Acompte : rien pour l'instant (par défaut), reçu, ou pourquoi il n'y en a pas.
  const [modeAcompte, setModeAcompte] = useState<ModeAcompte>("PLUS_TARD");
  const [acompte, setAcompte] = useState<SaisiePaiement>(() => saisiePaiement(acomptePrevu(devis[0])));
  const [motifSansAcompte, setMotifSansAcompte] = useState<string | null>(null);
  const [precisionSansAcompte, setPrecisionSansAcompte] = useState("");
  const [soldeRecu, setSoldeRecu] = useState(false);
  const [solde, setSolde] = useState<SaisiePaiement>(() => saisiePaiement(detail.paiements.resteDu));
  const aujourdhui = jourParis(new Date());
  const [survenuLe, setSurvenuLe] = useState(aujourdhui);

  const demandeMotif = criteres.includes("MOTIF_PERTE");
  const demandeDate = criteres.includes("DATE_CHANTIER");
  const declaratifs = CRITERES_DECLARATIFS.filter((critere) => criteres.includes(critere));
  const choixDevis = criteres.includes("BON_POUR_ACCORD") && devis.length > 1;
  const demandeAcompte = criteres.includes("ACOMPTE_ENCAISSE") && !detail.paiements.acompteEnregistre;
  const demandeSolde = criteres.includes("SOLDE_ENCAISSE") && !detail.paiements.soldeEncaisse;
  const acompteLu = lirePaiement(acompte).paiement;
  const soldeLu = lirePaiement(solde).paiement;

  const prixConcurrentLu = prixConcurrent.trim() ? lireNombre(prixConcurrent) : null;
  const prixConcurrentInvalide = prixConcurrent.trim() !== "" && (prixConcurrentLu === null || prixConcurrentLu < 0);
  // Seule une saisie commencée et illisible retient la confirmation ; ce qui manque est signalé.
  const saisieInvalide =
    prixConcurrentInvalide ||
    (demandeAcompte && modeAcompte === "RECU" && acompteLu === null) ||
    (demandeAcompte && modeAcompte === "SANS" && (motifSansAcompte === null || (motifSansAcompte === "AUTRE" && precisionSansAcompte.trim().length < 3))) ||
    (demandeSolde && soldeRecu && soldeLu === null) ||
    !survenuLe ||
    survenuLe > aujourdhui;

  const donnees: DonneesEtape = {
    ...(demandeMotif && motif ? { motifPerte: motif } : {}),
    ...(demandeMotif && concurrent.trim() ? { perteConcurrent: concurrent.trim() } : {}),
    ...(demandeMotif && prixConcurrentLu !== null && !prixConcurrentInvalide ? { perteMontantConcurrent: prixConcurrentLu } : {}),
    ...(demandeMotif && commentairePerte.trim() ? { perteCommentaire: commentairePerte.trim() } : {}),
    ...(demandeDate && dateChantier ? { dateChantier } : {}),
    ...(declaratifs.some((critere) => confirmations[critere])
      ? { confirmations: Object.fromEntries(declaratifs.filter((critere) => confirmations[critere]).map((critere) => [critere, true])) }
      : {}),
    ...(criteres.includes("BON_POUR_ACCORD") && devisId ? { devisAccepteId: devisId } : {}),
    ...(demandeAcompte && modeAcompte === "RECU" && acompteLu ? { acompte: acompteLu } : {}),
    ...(demandeAcompte && modeAcompte === "SANS" && motifSansAcompte
      ? { sansAcompte: { motif: motifSansAcompte, precision: precisionSansAcompte.trim() || undefined } }
      : {}),
    ...(demandeSolde && soldeRecu && soldeLu ? { solde: soldeLu } : {}),
    ...(survenuLe && survenuLe !== aujourdhui ? { survenuLe } : {}),
  };
  const avertissements = avertissementsTransition(faitsDepuisDetail(detail), transition.vers, donnees as DonneesTransition, detail.etapeAvantSortie);

  const titre =
    transition.nature === "RETOUR"
      ? `Revenir à « ${LIBELLES_ETAPE[transition.vers]} » ?`
      : transition.vers === "PERDU"
        ? "Marquer le dossier perdu"
        : transition.nature === "REPRISE"
          ? `Reprendre en « ${LIBELLES_ETAPE[transition.vers]} »`
          : `Passer à « ${LIBELLES_ETAPE[transition.vers]} »`;

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
            disabled={saisieInvalide}
            chargement={enCours}
            onClick={() => !saisieInvalide && onValider(donnees)}
          >
            {transition.nature === "RETOUR" ? "Revenir à cette étape" : avertissements.length > 0 ? "Passer quand même" : "Confirmer"}
          </Bouton>
        </div>
      }
    >
      <div className="space-y-3">
        <ListeAvertissements avertissements={avertissements} />

        <Champ
          libelle="Date du passage"
          type="date"
          max={aujourdhui}
          value={survenuLe}
          erreur={survenuLe > aujourdhui ? "La date est à venir." : null}
          aide={survenuLe === aujourdhui ? "Aujourd'hui ; une date passée pour ce qui est arrivé avant." : "Date réelle : la saisie d'aujourd'hui reste au journal."}
          onChange={(evenement) => setSurvenuLe(evenement.target.value)}
        />

        {demandeMotif ? (
          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-[#9CA3AF]">Motif de perte</legend>
            <div className="grid grid-cols-2 gap-2">
              {MOTIFS_PERTE.map((valeur) => (
                <button
                  key={valeur}
                  type="button"
                  aria-pressed={motif === valeur}
                  onClick={() => setMotif((actuel) => (actuel === valeur ? null : valeur))}
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

        {demandeMotif ? (
          <div className="space-y-3 rounded-[9px] border-[0.5px] border-[#2A2D34] p-3">
            <p className="text-[12px] text-[#6B7280]">Facultatif, mais précieux pour comprendre ce qui fait perdre.</p>
            <Champ
              libelle="Remporté par"
              placeholder="Entreprise, cuisiniste, ou « le client le fait lui-même »"
              maxLength={160}
              value={concurrent}
              onChange={(evenement) => setConcurrent(evenement.target.value)}
            />
            <Champ
              libelle="Son prix (€)"
              inputMode="decimal"
              placeholder="Ex. 3 200"
              value={prixConcurrent}
              erreur={prixConcurrentInvalide ? "Montant invalide." : null}
              onChange={(evenement) => setPrixConcurrent(evenement.target.value)}
            />
            <ZoneTexte
              libelle="Ce que le client a dit"
              rows={2}
              maxLength={2000}
              value={commentairePerte}
              onChange={(evenement) => setCommentairePerte(evenement.target.value)}
            />
          </div>
        ) : null}

        {demandeDate ? (
          <Champ libelle="Date du chantier" type="date" value={dateChantier} onChange={(evenement) => setDateChantier(evenement.target.value)} />
        ) : null}

        {choixDevis ? (
          <div>
            <label htmlFor="devis-signe" className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
              Devis signé
            </label>
            <select
              id="devis-signe"
              value={devisId}
              onChange={(evenement) => {
                const precedent = devis.find((document) => document.id === devisId);
                const suivant = devis.find((document) => document.id === evenement.target.value);
                // Montant d'acompte non retouché : il suit le devis choisi.
                if (acompte.montant === saisiePaiement(acomptePrevu(precedent)).montant) {
                  setAcompte((actuel) => ({ ...actuel, montant: saisiePaiement(acomptePrevu(suivant)).montant }));
                }
                setDevisId(evenement.target.value);
              }}
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

        {criteres.includes("ACOMPTE_ENCAISSE") && detail.paiements.acompteEnregistre ? (
          <p className="text-[13px] text-[#5DCAA5]">Acompte déjà enregistré dans les paiements du dossier.</p>
        ) : null}

        {demandeAcompte ? (
          <fieldset className="space-y-3 rounded-[9px] border-[0.5px] border-[#2A2D34] p-3">
            <legend className="px-1 text-[12px] font-medium text-[#9CA3AF]">Acompte</legend>
            <Puces
              libelle="À la signature"
              options={[
                { valeur: "PLUS_TARD" as const, libelle: "Rien pour l'instant" },
                { valeur: "RECU" as const, libelle: "Acompte reçu" },
                { valeur: "SANS" as const, libelle: "Pas d'acompte" },
              ]}
              valeur={modeAcompte}
              onChange={setModeAcompte}
            />
            {modeAcompte === "RECU" ? (
              <ChampsPaiement saisie={acompte} onChange={setAcompte} libelleMontant="Acompte reçu (€)" />
            ) : modeAcompte === "SANS" ? (
              <>
                <Puces
                  libelle="Pourquoi"
                  options={MOTIFS_SANS_ACOMPTE.map((option) => ({ valeur: option.code as string, libelle: option.libelle }))}
                  valeur={motifSansAcompte}
                  onChange={setMotifSansAcompte}
                />
                <Champ
                  libelle={motifSansAcompte === "AUTRE" ? "Précision" : "Précision (facultative)"}
                  obligatoire={motifSansAcompte === "AUTRE"}
                  maxLength={300}
                  value={precisionSansAcompte}
                  onChange={(evenement) => setPrecisionSansAcompte(evenement.target.value)}
                />
              </>
            ) : null}
          </fieldset>
        ) : null}

        {demandeSolde ? (
          <fieldset className="space-y-3 rounded-[9px] border-[0.5px] border-[#2A2D34] p-3">
            <legend className="px-1 text-[12px] font-medium text-[#9CA3AF]">Paiement du solde</legend>
            <CaseACocher libelle="J'ai reçu un paiement, je l'enregistre" checked={soldeRecu} onChange={setSoldeRecu} />
            {soldeRecu ? <ChampsPaiement saisie={solde} onChange={setSolde} /> : null}
          </fieldset>
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
