"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Euro, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { LIBELLES_ETAPE, LIBELLES_SOURCE, LIBELLES_STATUT_DOCUMENT, type EtapeDossier, type RubriqueDossier, type TypeDocument } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { BoutonsContact } from "@/components/messagerie/BoutonsContact";
import { LIBELLES_ZONE } from "@/lib/messagerie/zone";
import { formatDateCourte } from "@/lib/dossiers/dates";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import type { DocumentVue, DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { PastilleRetard } from "./CarteDossier";
import { BadgeMain, BarreProgression, Lisere, couleurLisere } from "./Indicateurs";
import { ChangementEtape } from "./ChangementEtape";
import { CoordonneesClient } from "./CoordonneesClient";
import { DelaisEcarts } from "./DelaisEcarts";
import { DocumentsDossier } from "./DocumentsDossier";
import { ArchivageDossier } from "./ArchivageDossier";
import { EspaceDossier } from "./EspaceDossier";
import { ChipsFamilles, FamillesDossier } from "./FamillesDossier";
import { SimulationsDossier } from "./SimulationsDossier";
import { GenerateurDocument } from "./GenerateurDocument";
import { ModaleDocumentExistant } from "./DocumentExistant";
import { DepensesDossier } from "./DepensesDossier";
import { ModalePaiement, PaiementsDossier, montantAttendu } from "./PaiementsDossier";
import { PhotosDossier } from "./PhotosDossier";
import { Chronologie } from "@/components/pilotage/Chronologie";
import { TimelineEtapes } from "./TimelineEtapes";
import { pluriel } from "@/lib/commun/format";
import { Bouton, PastilleEtape, TRANS, TitreSection } from "@/components/pilotage/ui";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { ACompleter } from "./ACompleter";
import { HistoriqueEvenements } from "./HistoriqueEvenements";
import { ProchaineActionEditeur } from "./ProchaineActionEditeur";
import { ConversationFiche, JournalFiche, OuEnEstFiche, resumeConversation, useSuiviDuDossier } from "./SuiviFiche";

const CLASSE_PUCE_LIEN = cn(
  "inline-flex h-11 items-center gap-1.5 rounded-full border-[0.5px] border-trait bg-surface px-2.5 text-[12px] text-texte-2 hover:border-trait-2 hover:text-texte sm:h-7",
  TRANS
);

/**
 * Mission 13 (lot 4) : ce qu'un raccourci demande en ouvrant le panneau — une rubrique, ou une étape à passer.
 * Mission 17 (partie A) : `devis` ouvre d'emblée le générateur prérempli (« nouveau ») ou le dépôt d'un PDF (« pdf ») —
 * le panneau rendu hors de /dossiers (écran Tâches) ne lit pas `?devis=` dans l'adresse.
 * Mission 18 (B3) : « gmail » + `piece` ouvre le dépôt prérempli d'un PDF parti de Gmail (« Enregistrer comme devis envoyé »).
 */
export type DemandeOuverture = { rubrique: RubriqueDossier; etape?: EtapeDossier | null; devis?: "nouveau" | "pdf" | "gmail" | null; piece?: string | null; cle: number };

export function PanneauDossier({
  dossierId,
  maintenant,
  onFermer,
  onMisAJour,
  onArchive,
  demande = null,
}: {
  dossierId: string | null;
  maintenant: Date;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
  /** Le dossier vient d'être archivé : il sort de la liste, le panneau se ferme. */
  onArchive?: (dossierId: string) => void;
  demande?: DemandeOuverture | null;
}) {
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [echec, setEchec] = useState<{ dossierId: string; message: string } | null>(null);

  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    appelApi<DossierDetail>(`/api/dossiers/${dossierId}`)
      .then((charge) => {
        if (!actif) return;
        setDetail(charge);
        onMisAJour(charge);
      })
      .catch((probleme: unknown) => {
        if (actif) setEchec({ dossierId, message: messageErreur(probleme) });
      });
    return () => {
      actif = false;
    };
  }, [dossierId, onMisAJour]);

  const erreur = echec && echec.dossierId === dossierId ? echec.message : null;

  const appliquer = useCallback(
    (nouveau: DossierDetail) => {
      setDetail(nouveau);
      onMisAJour(nouveau);
    },
    [onMisAJour]
  );

  const recharger = useCallback(async () => {
    if (!dossierId) return;
    try {
      appliquer(await appelApi<DossierDetail>(`/api/dossiers/${dossierId}`));
    } catch (probleme) {
      toast.error("Dossier non rechargé", { description: messageErreur(probleme) });
    }
  }, [dossierId, appliquer]);

  // Mission 13 (lot 5, B7) : tant qu'il est ouvert, le panneau se relit toutes les 30 s et au retour sur l'onglet
  // (le client signe, dépose, choisit : ça se voit sans fermer). En silence : une panne réseau n'affiche rien.
  useEffect(() => {
    if (!dossierId) return;
    let actif = true;
    const relire = () => {
      if (document.visibilityState !== "visible") return;
      appelApi<DossierDetail>(`/api/dossiers/${dossierId}`)
        .then((charge) => {
          if (actif) appliquer(charge);
        })
        .catch(() => {
          // le prochain passage réessaiera
        });
    };
    const minuterie = window.setInterval(relire, 30_000);
    const surVisibilite = () => {
      if (document.visibilityState === "visible") relire();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      actif = false;
      window.clearInterval(minuterie);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [dossierId, appliquer]);

  // Pendant l'animation de fermeture, le dernier dossier reste affiché.
  const affiche = detail && (dossierId === null || detail.id === dossierId) ? detail : null;

  return (
    <Sheet open={dossierId !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 border-trait bg-fond p-0 text-texte data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]"
      >
        {affiche ? (
          <ContenuPanneau key={`${affiche.id}:${demande?.cle ?? 0}`} detail={affiche} maintenant={maintenant} onFermer={onFermer} onMisAJour={appliquer} onRecharger={recharger} onArchive={onArchive} demande={demande} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-trait px-5 py-4">
              <SheetTitle className="text-[15px] font-medium text-texte">
                {erreur ? "Dossier indisponible" : "Chargement du dossier…"}
              </SheetTitle>
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier">
                <X size={16} />
              </Bouton>
            </div>
            {erreur ? (
              <p className="px-5 py-6 text-[13px] text-attention-texte">{erreur}</p>
            ) : (
              <div className="space-y-3 px-5 py-6" aria-hidden>
                {[70, 45, 90, 60, 80].map((largeur) => (
                  <div key={largeur} className="h-4 animate-pulse rounded bg-surface-2" style={{ width: `${largeur}%` }} />
                ))}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Étapes où un paiement est attendu : l'acompte après la signature, le solde après la facture. */
const ETAPES_ENCAISSABLES: EtapeDossier[] = ["SIGNE", "PLANIFIE", "CHANTIER", "FACTURE"];

/**
 * Mission 25 (lot 6) — une section de la fiche : une icône, un titre court et, fermée, une ligne qui résume l'essentiel
 * (« Peu de texte : une icône et quelques mots »). Un bouton de 44 px ; le contenu au toucher.
 */
function SectionRepliable({ id, icone, titre, resume, ouvert, onBasculer, children }: { id: string; icone: string; titre: string; resume?: ReactNode; ouvert: boolean; onBasculer: () => void; children: ReactNode }) {
  return (
    <section id={id} className="border-t-[0.5px] border-trait first:border-t-0">
      <button type="button" aria-expanded={ouvert} onClick={onBasculer} className={cn("flex min-h-[46px] w-full items-center gap-2.5 py-1.5 text-left hover:bg-surface", TRANS)}>
        <span aria-hidden className="w-6 shrink-0 text-center text-[16px]">
          {icone}
        </span>
        <span className="shrink-0 text-[14px] font-medium text-texte">{titre}</span>
        {!ouvert && resume ? <span className="min-w-0 flex-1 truncate text-[12.5px] text-texte-3">{resume}</span> : <span className="flex-1" />}
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-texte-3 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? <div className="pt-1 pb-4">{children}</div> : null}
    </section>
  );
}

type Sections = "prochaine" | "conversation" | "visuels" | "documents" | "projet" | "paiements" | "espace" | "journal" | "reste";

/** Tout replié sauf la prochaine action (cahier) ; le journal fermé par défaut. */
const SECTIONS_PAR_DEFAUT: Record<Sections, boolean> = { prochaine: true, conversation: false, visuels: false, documents: false, projet: false, paiements: false, espace: false, journal: false, reste: false };
/** Les sections que Lucas ouvre ou ferme, retenues d'un dossier à l'autre (sur cet appareil). */
const CLE_SECTIONS = "fiche-dossier-sections";

function sectionsMemorisees(): Partial<Record<Sections, boolean>> {
  try {
    const lu = JSON.parse(window.localStorage.getItem(CLE_SECTIONS) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(lu).filter(([cle, valeur]) => cle in SECTIONS_PAR_DEFAUT && typeof valeur === "boolean")) as Partial<Record<Sections, boolean>>;
  } catch {
    return {};
  }
}

/** Les sections ouvertes : celles retenues, et celle qu'un raccourci demande (sans la retenir). */
function sectionsOuvertes(demande: DemandeOuverture | null): Record<Sections, boolean> {
  const ouvertes = { ...SECTIONS_PAR_DEFAUT, ...sectionsMemorisees() };
  if (demande?.rubrique === "messages") Object.assign(ouvertes, { espace: true, conversation: true });
  if (demande?.rubrique === "devis") ouvertes.documents = true;
  if (demande?.rubrique === "encaisser") Object.assign(ouvertes, { prochaine: true, paiements: true });
  if (demande?.rubrique === "photos") ouvertes.visuels = true;
  if (demande?.rubrique === "historique") ouvertes.journal = true;
  if (demande?.rubrique === "etape") ouvertes.prochaine = true;
  return ouvertes;
}

const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });

function ContenuPanneau({
  detail,
  maintenant,
  onFermer,
  onMisAJour,
  onRecharger,
  onArchive,
  demande,
}: {
  detail: DossierDetail;
  maintenant: Date;
  onFermer: () => void;
  onMisAJour: (detail: DossierDetail) => void;
  onRecharger: () => Promise<void>;
  onArchive?: (dossierId: string) => void;
  demande: DemandeOuverture | null;
}) {
  const [generateur, setGenerateur] = useState<{ type: TypeDocument; cle: number; remplace?: DocumentVue; variante?: boolean } | null>(() => (demande?.devis === "nouveau" ? { type: "DEVIS", cle: 1 } : null));
  // Mission 25 (lot 6) : les sections retenues d'un dossier à l'autre, et « Encaisser l'acompte » en un geste.
  const [ouvertes, setOuvertes] = useState(() => sectionsOuvertes(demande));
  const basculer = (section: Sections) =>
    setOuvertes((o) => {
      const suivantes = { ...o, [section]: !o[section] };
      try {
        window.localStorage.setItem(CLE_SECTIONS, JSON.stringify({ ...sectionsMemorisees(), [section]: suivantes[section] }));
      } catch {
        // stockage indisponible : les sections ne survivront pas à la fermeture
      }
      return suivantes;
    });
  const [encaisser, setEncaisser] = useState(() => demande?.rubrique === "encaisser");
  const attendu = ETAPES_ENCAISSABLES.includes(detail.etape) ? montantAttendu(detail) : null;
  // « Où on en est », la conversation et le journal de la messagerie : relus quand le dossier bouge.
  const cleSuivi = `${detail.etape}:${detail.updatedAt}:${detail.evenements[0]?.createdAt ?? ""}`;
  const { suivi, recharger: rechargerSuivi } = useSuiviDuDossier(detail.id, cleSuivi);
  useEffect(() => {
    if (!demande) return;
    const cible = demande.rubrique === "messages" ? ["rubrique-messages", "rubrique-espace"] : demande.rubrique === "encaisser" ? ["rubrique-paiements"] : [`rubrique-${demande.rubrique}`];
    const minuterie = window.setTimeout(() => {
      const element = cible.map((id) => document.getElementById(id)).find((e) => e !== null);
      element?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 350);
    // Mission 17 (partie A) : « Répondre » depuis l'écran Tâches — le fil à l'écran, le curseur dans le champ de réponse.
    const focus = demande.rubrique === "messages" ? window.setTimeout(() => document.getElementById("reponse-espace")?.focus({ preventScroll: true }), 900) : 0;
    return () => {
      window.clearTimeout(minuterie);
      window.clearTimeout(focus);
    };
  }, [demande]);
  // Mission 11 : dépôt d'un devis PDF déjà fait (numéro + libellé), proposé au client à côté des autres.
  const [depotPdf, setDepotPdf] = useState(() => (demande?.devis === "pdf" ? 1 : 0));
  // Mission 18 (B3) : « Enregistrer comme devis envoyé » — le PDF parti de Gmail (tâche ENREGISTRER_DEVIS).
  const [depotGmail, setDepotGmail] = useState<string | null>(() => (demande?.devis === "gmail" && demande.piece ? demande.piece : null));
  const faireDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1 }));
  const ajouterDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, variante: true }));
  const deposerPdf = () => setDepotPdf((n) => n + 1);
  // « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » depuis l'onglet Espaces clients : le dossier s'ouvre dessus, une fois.
  useEffect(() => {
    const url = new URL(window.location.href);
    const demande = url.searchParams.get("devis");
    const piece = url.searchParams.get("piece");
    if (demande !== "nouveau" && demande !== "variante" && demande !== "pdf" && !(demande === "gmail" && piece)) return;
    // Le paramètre n'est consommé qu'à l'ouverture effective (un montage annulé ne le perd pas).
    const premier = window.setTimeout(() => {
      if (demande === "pdf") setDepotPdf((n) => n || 1);
      else if (demande === "gmail") setDepotGmail((actuel) => actuel ?? piece);
      else setGenerateur((actuel) => actuel ?? { type: "DEVIS", cle: 1, variante: demande === "variante" });
      url.searchParams.delete("devis");
      url.searchParams.delete("piece");
      window.history.replaceState(window.history.state, "", url.toString());
    }, 0);
    return () => window.clearTimeout(premier);
  }, []);
  const lieu = [detail.clientVille, LIBELLES_SOURCE[detail.source]].filter(Boolean).join(" · ");

  // Les résumés d'une ligne (sections fermées).
  const fiche = suivi?.fiche ?? null;
  const devis = detail.documents.filter((d) => d.type === "DEVIS" && d.numero);
  const factures = detail.documents.filter((d) => d.type === "FACTURE" && d.numero);
  const dernierDevis = devis[0] ?? null;
  const recu = detail.paiements.encaissements.reduce((total, e) => total + e.montant, 0);
  const pieces = fiche?.pieces ?? [];
  const resumes: Record<Sections, string> = {
    prochaine: detail.prochaineAction ? `${detail.prochaineAction}${detail.prochaineActionDate ? ` · ${formatDateCourte(detail.prochaineActionDate)}` : ""}` : "aucune",
    conversation: resumeConversation(suivi),
    visuels: [fiche ? pluriel(fiche.simulations.nombre, "simulation") : null, fiche?.simulations.derniereLe ? `dernière le ${jour(fiche.simulations.derniereLe)}, ${fiche.simulations.vue ? "vue" : "pas vue"}` : null, pluriel(detail.photos.length, "photo")]
      .filter(Boolean)
      .join(" · "),
    documents: dernierDevis
      ? [`devis ${dernierDevis.numero}`, formatMontant(dernierDevis.totalHt), LIBELLES_STATUT_DOCUMENT[dernierDevis.statut]?.toLowerCase(), factures.length ? pluriel(factures.length, "facture") : null].filter(Boolean).join(" · ")
      : factures.length
        ? pluriel(factures.length, "facture")
        : "aucun devis",
    projet: [pieces.join(", ") || null, fiche?.surface ?? null, detail.clientVille ? `${detail.clientVille}${fiche && fiche.zone !== "INCONNUE" ? ` (${LIBELLES_ZONE[fiche.zone]})` : ""}` : null].filter(Boolean).join(" · ") || detail.objet || "à préciser",
    paiements: recu > 0 || detail.paiements.resteDu > 0 ? [`reçu ${formatMontant(recu)}`, detail.paiements.resteDu > 0 ? `reste dû ${formatMontant(detail.paiements.resteDu)}` : null].filter(Boolean).join(" · ") : "aucun paiement",
    espace: !fiche ? "" : !fiche.espace.ouvert ? "pas d'espace" : fiche.espace.derniereVisite ? `dernière visite le ${jour(fiche.espace.derniereVisite)}` : "jamais visité",
    journal: suivi?.journal[0]?.texte ?? detail.evenements[0]?.contenu ?? "",
    reste: "délais et prix, dépenses, étapes et notes, chronologie, archivage",
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* En haut, toujours visibles : nom, étape, ville, « Où on en est », les quatre boutons ronds (mission 25, lot 6). */}
      <header className="relative border-b-[0.5px] border-trait px-5 pt-4 pb-3">
        <Lisere couleur={couleurLisere(detail, maintenant)} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[17px] font-medium tracking-tight text-texte">{detail.clientNom}</SheetTitle>
            <SheetDescription className="mt-0.5 text-[12px] text-texte-3">
              {lieu} · ouvert le {formatDateCourte(detail.ouvertLe)}
            </SheetDescription>
          </div>
          <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier" className="-mr-2">
            <X size={16} />
          </Bouton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PastilleEtape etape={detail.etape} libelle={LIBELLES_ETAPE[detail.etape]} />
          <BadgeMain main={mainDe(detail, maintenant)} long />
          {echeanceDe(detail, maintenant) === "retard" ? <PastilleRetard className="ml-1" /> : null}
        </div>
        <div className="mt-2.5">
          <OuEnEstFiche suivi={suivi} />
        </div>
        <BoutonsContact className="mt-3" nom={detail.clientNom} telephone={detail.clientTelephone} email={detail.clientEmail} leadId={detail.origine?.type === "LEAD" ? detail.origine.id : null} dossierId={detail.id} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-5 py-2">
          <SectionRepliable id="rubrique-prochaine" icone="🎯" titre="Prochaine action" resume={resumes.prochaine} ouvert={ouvertes.prochaine} onBasculer={() => basculer("prochaine")}>
            <div className="space-y-5">
              {detail.completude.length > 0 ? <ACompleter detail={detail} onMisAJour={onMisAJour} /> : null}
              {detail.mainMotif && mainDe(detail, maintenant) !== "AUCUNE" ? (
                <p className="text-[12px] text-texte-3">
                  {detail.mainMotif}
                  {detail.mainLe ? ` · depuis le ${formatDateCourte(detail.mainLe)}` : ""}
                </p>
              ) : null}
              <ProchaineActionEditeur key={`${detail.id}:${detail.prochaineAction}:${detail.prochaineActionDate}`} detail={detail} maintenant={maintenant} onMisAJour={onMisAJour} />
              {attendu !== null && attendu > 0 ? (
                <section id="rubrique-encaisser" className="rounded-[11px] border-[0.5px] border-action/40 bg-action-fond/60 p-3.5">
                  <p className="text-[12.5px] text-texte-3">{detail.paiements.resteDu > 0 ? "Reste à recevoir sur les factures" : "Acompte prévu au devis, pas encore reçu"}</p>
                  <Bouton variante="primaire" className="mt-2 min-h-[44px]" icone={<Euro size={15} aria-hidden />} onClick={() => setEncaisser(true)}>
                    Encaisser {detail.paiements.resteDu > 0 ? "le solde" : "l'acompte"} {formatMontant(attendu)}
                  </Bouton>
                </section>
              ) : null}
              <div id="rubrique-etape">
                <ChangementEtape detail={detail} onMisAJour={onMisAJour} demandeInitiale={demande?.rubrique === "etape" ? (demande.etape ?? null) : null} />
              </div>
              <BarreProgression etape={detail.etape} etapeAvantSortie={detail.etapeAvantSortie} className="max-w-[420px]" />
            </div>
          </SectionRepliable>

          {/* Mission 25 : les messages préparés par la messagerie (relances comprises) remplacent l'ancienne carte de relance. */}
          <SectionRepliable id="rubrique-conversation" icone="💬" titre="Conversation" resume={resumes.conversation} ouvert={ouvertes.conversation} onBasculer={() => basculer("conversation")}>
            <ConversationFiche
              suivi={suivi}
              nom={detail.clientNom}
              onChange={() => {
                rechargerSuivi();
                void onRecharger();
              }}
            />
          </SectionRepliable>

          <SectionRepliable id="rubrique-photos" icone="🎨" titre="Simulations et photos" resume={resumes.visuels} ouvert={ouvertes.visuels} onBasculer={() => basculer("visuels")}>
            <div className="space-y-6">
              <div id="rubrique-simulations">
                <SimulationsDossier key={`simulations-${detail.id}`} detail={detail} onRecharger={onRecharger} sansTitre />
              </div>
              <PhotosDossier detail={detail} onRecharger={onRecharger} sansTitre />
            </div>
          </SectionRepliable>

          <SectionRepliable id="rubrique-devis" icone="📄" titre="Devis et factures" resume={resumes.documents} ouvert={ouvertes.documents} onBasculer={() => basculer("documents")}>
            <DocumentsDossier
              detail={detail}
              onGenerer={(type) => setGenerateur((actuel) => ({ type, cle: (actuel?.cle ?? 0) + 1 }))}
              onRefaire={(devis) => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, remplace: devis }))}
              onMisAJour={onMisAJour}
              onRecharger={onRecharger}
              sansTitre
            />
          </SectionRepliable>

          <SectionRepliable id="rubrique-projet" icone="🏠" titre="Projet" resume={resumes.projet} ouvert={ouvertes.projet} onBasculer={() => basculer("projet")}>
            <div className="space-y-6">
              <div>
                <p className={cn("text-[13.5px]", detail.objet ? "text-texte-2" : "text-texte-3 italic")}>{detail.objet || "Objet du chantier à préciser"}</p>
                <ChipsFamilles prestations={detail.prestations ?? {}} className="mt-1.5" />
                {detail.origine?.type === "LEAD" ? (
                  <Link href={`/leads?lead=${detail.origine.id}`} className={cn(CLASSE_PUCE_LIEN, "mt-2")}>
                    <ExternalLink size={12} aria-hidden />
                    Contact : {detail.origine.nom}
                  </Link>
                ) : detail.origine ? (
                  // Mission 13 (lot 7) : l'écran Prospects est retiré ; l'origine reste lisible, sans lien.
                  <span className={cn(CLASSE_PUCE_LIEN, "mt-2")}>Prospect : {detail.origine.nom}</span>
                ) : null}
              </div>
              <FamillesDossier key={`familles-${detail.id}`} detail={detail} onEnregistre={onRecharger} />
              {/* Remonté quand les valeurs enregistrées changent, pas à chaque mise à
                  jour du dossier : une saisie en cours survit à un changement d'étape. */}
              <CoordonneesClient
                key={[
                  detail.id,
                  detail.clientNom,
                  detail.clientTelephone,
                  detail.clientEmail,
                  detail.clientAdresse,
                  detail.clientCp,
                  detail.clientVille,
                  detail.objet,
                  detail.source,
                  detail.montantEstime,
                  detail.dateChantier,
                ].join("|")}
                detail={detail}
                onMisAJour={onMisAJour}
              />
            </div>
          </SectionRepliable>

          <SectionRepliable id="rubrique-paiements" icone="💶" titre="Paiements" resume={resumes.paiements} ouvert={ouvertes.paiements} onBasculer={() => basculer("paiements")}>
            <PaiementsDossier detail={detail} onMisAJour={onMisAJour} sansTitre />
          </SectionRepliable>

          <SectionRepliable id="rubrique-espace" icone="🔗" titre="Espace client" resume={resumes.espace} ouvert={ouvertes.espace} onBasculer={() => basculer("espace")}>
            <EspaceDossier key={detail.id} detail={detail} onRecharger={onRecharger} onFaireDevis={faireDevis} onAjouterDevis={ajouterDevis} onDeposerPdf={deposerPdf} sansTitre />
          </SectionRepliable>

          <SectionRepliable id="rubrique-historique" icone="🕓" titre="Journal et historique" resume={resumes.journal} ouvert={ouvertes.journal} onBasculer={() => basculer("journal")}>
            <div className="space-y-6">
              <JournalFiche suivi={suivi} />
              <HistoriqueEvenements evenements={detail.evenements} onRecharger={onRecharger} />
              <section>
                <TitreSection>Étapes et notes</TitreSection>
                <TimelineEtapes detail={detail} onNoteAjoutee={onRecharger} />
              </section>
            </div>
          </SectionRepliable>

          <SectionRepliable id="rubrique-reste" icone="⋯" titre="Le reste du dossier" resume={resumes.reste} ouvert={ouvertes.reste} onBasculer={() => basculer("reste")}>
            <div className="space-y-8 pt-2">
              <DelaisEcarts detail={detail} onMisAJour={onMisAJour} />
              <DepensesDossier detail={detail} />
              <Chronologie cible={{ dossier: detail.id, client: detail.client?.id ?? null }} titre="Chronologie du client" compact />
              {onArchive ? <ArchivageDossier detail={detail} onArchive={onArchive} /> : null}
            </div>
          </SectionRepliable>
        </div>
      </div>

      {encaisser ? <ModalePaiement detail={detail} moyenParDefaut="VIREMENT" titre={detail.paiements.resteDu > 0 ? "Encaisser le solde" : "Encaisser l'acompte"} onFermer={() => setEncaisser(false)} onFait={onMisAJour} /> : null}

      {generateur ? (
        <GenerateurDocument
          key={generateur.cle}
          detail={detail}
          typeInitial={generateur.type}
          remplace={generateur.remplace ?? null}
          variante={generateur.variante ?? false}
          onFermer={() => setGenerateur(null)}
          onGenere={onMisAJour}
        />
      ) : null}
      {depotPdf ? <ModaleDocumentExistant key={`depot-${depotPdf}`} detail={detail} depotDevis onFermer={() => setDepotPdf(0)} onMisAJour={onMisAJour} /> : null}
      {depotGmail ? <ModaleDocumentExistant key={`gmail-${depotGmail}`} detail={detail} depotDevis pieceGmail={depotGmail} onFermer={() => setDepotGmail(null)} onMisAJour={onMisAJour} /> : null}
    </div>
  );
}

/* ── À compléter ─────────────────────────────────────────────────── */

/* ── Prochaine action ────────────────────────────────────────────── */

