"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Euro, ExternalLink, Mail, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { LIBELLES_ETAPE, LIBELLES_SOURCE, type EtapeDossier, type RubriqueDossier, type TypeDocument } from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
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
import { RelancesDuDossier } from "@/components/pilotage/relances/FeuilleRelances";
import { TimelineEtapes } from "./TimelineEtapes";
import { pluriel } from "@/lib/commun/format";
import { Bouton, PastilleEtape, TRANS, TitreSection } from "@/components/pilotage/ui";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { ACompleter } from "./ACompleter";
import { HistoriqueEvenements } from "./HistoriqueEvenements";
import { ProchaineActionEditeur } from "./ProchaineActionEditeur";

const CLASSE_PUCE_LIEN = cn(
  "inline-flex h-11 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-7",
  TRANS
);

/**
 * Mission 13 (lot 4) : ce qu'un raccourci demande en ouvrant le panneau — une rubrique, ou une étape à passer.
 * Mission 17 (partie A) : `devis` ouvre d'emblée le générateur prérempli (« nouveau ») ou le dépôt d'un PDF (« pdf ») —
 * le panneau rendu hors de /dossiers (écran Tâches) ne lit pas `?devis=` dans l'adresse.
 */
export type DemandeOuverture = { rubrique: RubriqueDossier; etape?: EtapeDossier | null; devis?: "nouveau" | "pdf" | null; cle: number };

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
        className="gap-0 border-[#2A2D34] bg-[#16181D] p-0 text-[#F2F3F5] data-[side=right]:w-full data-[side=right]:sm:max-w-[620px]"
      >
        {affiche ? (
          <ContenuPanneau key={`${affiche.id}:${demande?.cle ?? 0}`} detail={affiche} maintenant={maintenant} onFermer={onFermer} onMisAJour={appliquer} onRecharger={recharger} onArchive={onArchive} demande={demande} />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
              <SheetTitle className="text-[15px] font-medium text-[#F2F3F5]">
                {erreur ? "Dossier indisponible" : "Chargement du dossier…"}
              </SheetTitle>
              <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier">
                <X size={16} />
              </Bouton>
            </div>
            {erreur ? (
              <p className="px-5 py-6 text-[13px] text-[#F87171]">{erreur}</p>
            ) : (
              <div className="space-y-3 px-5 py-6" aria-hidden>
                {[70, 45, 90, 60, 80].map((largeur) => (
                  <div key={largeur} className="h-4 animate-pulse rounded bg-[#22262D]" style={{ width: `${largeur}%` }} />
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

/** Une section du panneau, repliable : un bouton de 44 px, un résumé quand elle est fermée, le contenu au toucher. */
function SectionRepliable({ id, titre, resume, ouvert, onBasculer, children }: { id: string; titre: string; resume?: ReactNode; ouvert: boolean; onBasculer: () => void; children: ReactNode }) {
  return (
    <section id={id}>
      <button type="button" aria-expanded={ouvert} onClick={onBasculer} className={cn("-mx-1 flex min-h-[44px] w-[calc(100%+0.5rem)] items-center gap-2 rounded-[10px] px-1 text-left hover:bg-[#1C1F25]", TRANS)}>
        <span className="text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">{titre}</span>
        {!ouvert && resume ? <span className="min-w-0 flex-1 truncate text-[12px] text-[#6B7280]">{resume}</span> : <span className="flex-1" />}
        <ChevronDown size={15} aria-hidden className={cn("shrink-0 text-[#6B7280] transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}

type Sections = "photos" | "historique" | "espace" | "documents" | "paiements" | "simulations" | "reste";

/** Ce qui s'ouvre d'office : ce qui attend un geste. Le reste se replie. */
function sectionsOuvertes(detail: DossierDetail, demande: DemandeOuverture | null): Record<Sections, boolean> {
  const avantSignature = ["QUALIFICATION", "SIMULATION", "DEVIS_ENVOYE", "RELANCE"].includes(detail.etape);
  const aUnDevis = detail.documents.some((d) => d.type === "DEVIS" && d.numero);
  const aUneFacture = detail.documents.some((d) => d.type === "FACTURE" && d.numero);
  const ouvertes: Record<Sections, boolean> = {
    photos: true,
    historique: true,
    espace: avantSignature,
    documents: (avantSignature && !aUnDevis) || (["SIGNE", "PLANIFIE", "CHANTIER"].includes(detail.etape) && !aUneFacture),
    paiements: ETAPES_ENCAISSABLES.includes(detail.etape) && (montantAttendu(detail) ?? 0) > 0,
    simulations: detail.etape === "SIMULATION",
    reste: false,
  };
  if (demande?.rubrique === "messages") ouvertes.espace = true;
  if (demande?.rubrique === "devis") ouvertes.documents = true;
  if (demande?.rubrique === "encaisser") ouvertes.paiements = true;
  return ouvertes;
}

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
  // Mission 13 (lot 4) : les sections ouvertes (ce qui attend un geste d'office), et « Encaisser l'acompte » en un geste.
  const [ouvertes, setOuvertes] = useState(() => sectionsOuvertes(detail, demande));
  const basculer = (section: Sections) => setOuvertes((o) => ({ ...o, [section]: !o[section] }));
  const [encaisser, setEncaisser] = useState(() => demande?.rubrique === "encaisser");
  const attendu = ETAPES_ENCAISSABLES.includes(detail.etape) ? montantAttendu(detail) : null;
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
  const faireDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1 }));
  const ajouterDevis = () => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, variante: true }));
  const deposerPdf = () => setDepotPdf((n) => n + 1);
  // « Faire le devis », « Ajouter un devis », « Déposer un devis PDF » depuis l'onglet Espaces clients : le dossier s'ouvre dessus, une fois.
  useEffect(() => {
    const url = new URL(window.location.href);
    const demande = url.searchParams.get("devis");
    if (demande !== "nouveau" && demande !== "variante" && demande !== "pdf") return;
    // Le paramètre n'est consommé qu'à l'ouverture effective (un montage annulé ne le perd pas).
    const premier = window.setTimeout(() => {
      if (demande === "pdf") setDepotPdf((n) => n || 1);
      else setGenerateur((actuel) => actuel ?? { type: "DEVIS", cle: 1, variante: demande === "variante" });
      url.searchParams.delete("devis");
      window.history.replaceState(window.history.state, "", url.toString());
    }, 0);
    return () => window.clearTimeout(premier);
  }, []);
  const telephone = detail.clientTelephone.replace(/[^\d+]/g, "");
  const lieu = [detail.clientVille, LIBELLES_SOURCE[detail.source]].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative border-b-[0.5px] border-[#2A2D34] px-5 pt-4 pb-3">
        <Lisere couleur={couleurLisere(detail, maintenant)} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[17px] font-medium tracking-tight text-[#F2F3F5]">
              {detail.clientNom}
            </SheetTitle>
            <SheetDescription className="mt-0.5 text-[12px] text-[#9CA3AF]">
              {lieu} · ouvert le {formatDateCourte(detail.ouvertLe)}
            </SheetDescription>
          </div>
          <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer le dossier" className="-mr-2">
            <X size={16} />
          </Bouton>
        </div>
        <p className={cn("mt-2 truncate text-[13px]", detail.objet ? "text-[#D1D5DB]" : "text-[#6B7280] italic")}>{detail.objet || "Objet du chantier à préciser"}</p>
        <ChipsFamilles prestations={detail.prestations ?? {}} className="mt-1.5" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PastilleEtape etape={detail.etape} libelle={LIBELLES_ETAPE[detail.etape]} />
          <BadgeMain main={mainDe(detail, maintenant)} long />
          {echeanceDe(detail, maintenant) === "retard" ? <PastilleRetard className="ml-1" /> : null}
        </div>
        {detail.mainMotif && mainDe(detail, maintenant) !== "AUCUNE" ? (
          <p className="mt-1.5 text-[12px] text-[#8B919C]">
            {detail.mainMotif}
            {detail.mainLe ? ` · depuis le ${formatDateCourte(detail.mainLe)}` : ""}
          </p>
        ) : null}
        <BarreProgression etape={detail.etape} etapeAvantSortie={detail.etapeAvantSortie} className="mt-3 max-w-[420px]" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {telephone ? (
            <a href={`tel:${telephone}`} onClick={() => noterDebutAppel(detail.origine?.type === "LEAD" ? detail.origine.id : `dossier:${detail.id}`, { nom: detail.clientNom, dossierId: detail.id })} className={CLASSE_PUCE_LIEN}>
              <Phone size={12} aria-hidden />
              {detail.clientTelephone}
            </a>
          ) : null}
          {detail.clientEmail ? (
            <a href={`mailto:${detail.clientEmail}`} className={CLASSE_PUCE_LIEN}>
              <Mail size={12} aria-hidden />
              E-mail
            </a>
          ) : null}
          {detail.origine?.type === "LEAD" ? (
            <Link href={`/leads?lead=${detail.origine.id}`} className={CLASSE_PUCE_LIEN}>
              <ExternalLink size={12} aria-hidden />
              Contact : {detail.origine.nom}
            </Link>
          ) : detail.origine ? (
            // Mission 13 (lot 7) : l'écran Prospects est retiré ; l'origine reste lisible, sans lien.
            <span className={CLASSE_PUCE_LIEN}>Prospect : {detail.origine.nom}</span>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-6 px-5 py-5">
          {/* 1. Ce qui attend un geste : à compléter, prochaine action, encaisser, l'étape. */}
          {detail.completude.length > 0 ? <ACompleter detail={detail} onMisAJour={onMisAJour} /> : null}
          <ProchaineActionEditeur
            key={`${detail.id}:${detail.prochaineAction}:${detail.prochaineActionDate}`}
            detail={detail}
            maintenant={maintenant}
            onMisAJour={onMisAJour}
          />
          {/* Mission 14 (partie 6) : la relance proposable de ce dossier (SMS à copier, mail à relire) ; relue quand le
              dossier bouge (étape, nouvel événement), et le panneau relu après une copie. */}
          <RelancesDuDossier
            dossierId={detail.id}
            cle={`${detail.etape}:${detail.evenements.reduce((dernier, e) => (e.createdAt > dernier ? e.createdAt : dernier), "")}`}
            onCopie={() => void onRecharger()}
          />
          {attendu !== null && attendu > 0 ? (
            <section id="rubrique-encaisser" className="rounded-[11px] border-[0.5px] border-[#1D9E75]/40 bg-[#112B22]/60 p-3.5">
              <p className="text-[12.5px] text-[#9CA3AF]">{detail.paiements.resteDu > 0 ? "Reste à recevoir sur les factures" : "Acompte prévu au devis, pas encore reçu"}</p>
              <Bouton variante="primaire" className="mt-2 min-h-[44px]" icone={<Euro size={15} aria-hidden />} onClick={() => setEncaisser(true)}>
                Encaisser {detail.paiements.resteDu > 0 ? "le solde" : "l'acompte"} {formatMontant(attendu)}
              </Bouton>
            </section>
          ) : null}
          <div id="rubrique-etape">
            <ChangementEtape detail={detail} onMisAJour={onMisAJour} demandeInitiale={demande?.rubrique === "etape" ? (demande.etape ?? null) : null} />
          </div>

          {/* 2. Photos, 3. Historique : ce qu'on regarde le plus. */}
          <SectionRepliable id="rubrique-photos" titre={`Photos du chantier (${detail.photos.length})`} ouvert={ouvertes.photos} onBasculer={() => basculer("photos")}>
            <PhotosDossier detail={detail} onRecharger={onRecharger} sansTitre />
          </SectionRepliable>
          <SectionRepliable id="rubrique-historique" titre={`Historique (${detail.evenements.length})`} resume={detail.evenements[0]?.contenu} ouvert={ouvertes.historique} onBasculer={() => basculer("historique")}>
            <HistoriqueEvenements evenements={detail.evenements} onRecharger={onRecharger} />
          </SectionRepliable>

          {/* 4. Les rubriques qui portent des gestes : ouvertes quand elles attendent quelque chose, repliées sinon. */}
          <SectionRepliable id="rubrique-espace" titre="Espace client" ouvert={ouvertes.espace} onBasculer={() => basculer("espace")}>
            <EspaceDossier key={detail.id} detail={detail} onRecharger={onRecharger} onFaireDevis={faireDevis} onAjouterDevis={ajouterDevis} onDeposerPdf={deposerPdf} sansTitre />
          </SectionRepliable>
          <SectionRepliable
            id="rubrique-devis"
            titre="Devis et factures"
            resume={`${detail.documents.filter((d) => d.type === "DEVIS" && d.numero).length} devis · ${pluriel(detail.documents.filter((d) => d.type === "FACTURE" && d.numero).length, "facture")}`}
            ouvert={ouvertes.documents}
            onBasculer={() => basculer("documents")}
          >
            <DocumentsDossier
              detail={detail}
              onGenerer={(type) => setGenerateur((actuel) => ({ type, cle: (actuel?.cle ?? 0) + 1 }))}
              onRefaire={(devis) => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, remplace: devis }))}
              onMisAJour={onMisAJour}
              onRecharger={onRecharger}
              sansTitre
            />
          </SectionRepliable>
          <SectionRepliable id="rubrique-paiements" titre="Paiements" resume={detail.paiements.resteDu > 0 ? `reste dû ${formatMontant(detail.paiements.resteDu)}` : detail.paiements.acompteEnregistre ? "acompte reçu" : "aucun paiement"} ouvert={ouvertes.paiements} onBasculer={() => basculer("paiements")}>
            <PaiementsDossier detail={detail} onMisAJour={onMisAJour} sansTitre />
          </SectionRepliable>
          <SectionRepliable id="rubrique-simulations" titre="Simulations" ouvert={ouvertes.simulations} onBasculer={() => basculer("simulations")}>
            <SimulationsDossier key={`simulations-${detail.id}`} detail={detail} onRecharger={onRecharger} sansTitre />
          </SectionRepliable>

          {/* 5. Le reste du dossier, replié. */}
          <SectionRepliable id="rubrique-reste" titre="Le reste du dossier" resume="familles, délais et prix, dépenses, étapes et notes, coordonnées, chronologie, archivage" ouvert={ouvertes.reste} onBasculer={() => basculer("reste")}>
            <div className="space-y-8 pt-2">
              <FamillesDossier key={`familles-${detail.id}`} detail={detail} onEnregistre={onRecharger} />
              <DelaisEcarts detail={detail} onMisAJour={onMisAJour} />
              <DepensesDossier detail={detail} />
              <section>
                <TitreSection>Étapes et notes</TitreSection>
                <TimelineEtapes detail={detail} onNoteAjoutee={onRecharger} />
              </section>
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
    </div>
  );
}

/* ── À compléter ─────────────────────────────────────────────────── */

/* ── Prochaine action ────────────────────────────────────────────── */

