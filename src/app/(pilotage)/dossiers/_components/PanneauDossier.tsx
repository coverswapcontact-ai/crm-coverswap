"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  ChevronDown,
  Euro,
  ExternalLink,
  FileText,
  Hourglass,
  Landmark,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { LecteurMessage } from "@/components/pilotage/messages/LecteurMessage";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  LIBELLES_ETAPE,
  LIBELLES_SOURCE,
  LIBELLES_TYPE_EVENEMENT,
  type EtapeDossier,
  type RubriqueDossier,
  type TypeDocument,
  type TypeEvenement,
} from "@/lib/dossiers/constants";
import { formatMontant } from "@/lib/dossiers/montants";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { formatDateCourte, formatHorodatage, jourParis } from "@/lib/dossiers/dates";
import { echeanceDe, mainDe } from "@/lib/dossiers/pilotage";
import type { DocumentVue, DossierDetail, EvenementVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { PastilleRetard, ProchaineActionResume } from "./CarteDossier";
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
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, CLASSE_SAISIE, PastilleEtape, TRANS, TitreSection } from "./ui";

const CLASSE_PUCE_LIEN = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2.5 text-[12px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-7",
  TRANS
);

/** Mission 13 (lot 4) : ce qu'un raccourci demande en ouvrant le panneau — une rubrique, ou une étape à passer. */
export type DemandeOuverture = { rubrique: RubriqueDossier; etape?: EtapeDossier | null; cle: number };

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
  const [generateur, setGenerateur] = useState<{ type: TypeDocument; cle: number; remplace?: DocumentVue; variante?: boolean } | null>(null);
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
    return () => window.clearTimeout(minuterie);
  }, [demande]);
  // Mission 11 : dépôt d'un devis PDF déjà fait (numéro + libellé), proposé au client à côté des autres.
  const [depotPdf, setDepotPdf] = useState(0);
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
          {detail.origine ? (
            <Link
              href={detail.origine.type === "LEAD" ? `/leads?lead=${detail.origine.id}` : `/prospects?prospect=${detail.origine.id}`}
              className={CLASSE_PUCE_LIEN}
            >
              <ExternalLink size={12} aria-hidden />
              {detail.origine.type === "LEAD" ? "Contact" : "Prospect"} : {detail.origine.nom}
            </Link>
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
            <HistoriqueEvenements dossierId={detail.id} evenements={detail.evenements} onRecharger={onRecharger} />
          </SectionRepliable>

          {/* 4. Les rubriques qui portent des gestes : ouvertes quand elles attendent quelque chose, repliées sinon. */}
          <SectionRepliable id="rubrique-espace" titre="Espace client" ouvert={ouvertes.espace} onBasculer={() => basculer("espace")}>
            <EspaceDossier key={detail.id} detail={detail} onRecharger={onRecharger} onFaireDevis={faireDevis} onAjouterDevis={ajouterDevis} onDeposerPdf={deposerPdf} sansTitre />
          </SectionRepliable>
          <SectionRepliable
            id="rubrique-devis"
            titre="Devis et factures"
            resume={`${detail.documents.filter((d) => d.type === "DEVIS" && d.numero).length} devis · ${detail.documents.filter((d) => d.type === "FACTURE" && d.numero).length} facture(s)`.replace("facture(s)", detail.documents.filter((d) => d.type === "FACTURE" && d.numero).length > 1 ? "factures" : "facture")}
            ouvert={ouvertes.documents}
            onBasculer={() => basculer("documents")}
          >
            <DocumentsDossier
              detail={detail}
              onGenerer={(type) => setGenerateur((actuel) => ({ type, cle: (actuel?.cle ?? 0) + 1 }))}
              onRefaire={(devis) => setGenerateur((actuel) => ({ type: "DEVIS", cle: (actuel?.cle ?? 0) + 1, remplace: devis }))}
              onMisAJour={onMisAJour}
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

/**
 * Ce qui manque au dossier : signalé, jamais exigé. En alerte (orange) ce que
 * moi seul peux compléter ; en neutre ce que le client peut encore fournir
 * depuis son espace (« en attente du client ») ; chaque point a sa croix pour
 * le masquer sur ce dossier (mémorisé, réaffichable). Un point rempli disparaît.
 */
function ACompleter({ detail, onMisAJour }: { detail: DossierDetail; onMisAJour: (detail: DossierDetail) => void }) {
  const [occupe, setOccupe] = useState<string | null>(null);
  const [voirMasques, setVoirMasques] = useState(false);
  const alertes = detail.completude.filter((p) => !p.masque && !p.attenteClient);
  const attente = detail.completude.filter((p) => !p.masque && p.attenteClient);
  const masques = detail.completude.filter((p) => p.masque);
  if (detail.completude.length === 0) return null;

  async function basculer(code: string, masque: boolean) {
    setOccupe(code);
    try {
      await envoyerJson(`/api/dossiers/${detail.id}/completude`, "PATCH", { code, masque });
      onMisAJour(await appelApi<DossierDetail>(`/api/dossiers/${detail.id}`));
      if (masque) toast.success("Point masqué pour ce dossier", { description: "Il ne revient pas ; « réafficher » le remet." });
    } catch (probleme) {
      toast.error(messageErreur(probleme));
    } finally {
      setOccupe(null);
    }
  }

  const puce = (point: DossierDetail["completude"][number], ton: "alerte" | "neutre") => (
    <li
      key={point.code}
      className={cn(
        "flex items-center gap-0.5 rounded-full border-[0.5px] py-0.5 pr-0.5 pl-2 text-[12px]",
        ton === "alerte" ? "border-[#EF9F27]/30 text-[#FCD9A0]" : "border-[#3A3E47] text-[#B4BAC4]"
      )}
    >
      {point.libelle}
      <button
        type="button"
        disabled={occupe !== null}
        onClick={() => basculer(point.code, true)}
        aria-label={`Masquer « ${point.libelle} » pour ce dossier`}
        title="Pas nécessaire pour ce dossier : masquer"
        className={cn("flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40 sm:h-5 sm:w-5", ton === "alerte" ? "text-[#F5B454]" : "text-[#8B919C]")}
      >
        <X size={12} aria-hidden />
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      {alertes.length > 0 ? (
        <section aria-label="À compléter" className="rounded-[11px] border-[0.5px] border-[#EF9F27]/35 bg-[#EF9F27]/[0.07] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#F5B454]">
            <AlertTriangle size={13} aria-hidden />
            À compléter · {alertes.length}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">{alertes.map((p) => puce(p, "alerte"))}</ul>
        </section>
      ) : null}
      {attente.length > 0 ? (
        <section aria-label="En attente du client" className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#B4BAC4]">
            <Hourglass size={13} aria-hidden />
            En attente du client · il peut le donner dans son espace
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">{attente.map((p) => puce(p, "neutre"))}</ul>
        </section>
      ) : null}
      {masques.length > 0 ? (
        <div className="text-[12px] text-[#6B7280]">
          <button type="button" onClick={() => setVoirMasques((v) => !v)} className="underline-offset-2 hover:text-[#9CA3AF] hover:underline">
            {masques.length} point{masques.length > 1 ? "s" : ""} masqué{masques.length > 1 ? "s" : ""} · {voirMasques ? "cacher" : "voir"}
          </button>
          {voirMasques ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {masques.map((p) => (
                <li key={p.code} className="flex items-center gap-1.5 rounded-full border-[0.5px] border-[#2A2D34] py-0.5 pr-1 pl-2 text-[#8B919C]">
                  {p.libelle}
                  <button type="button" disabled={occupe !== null} onClick={() => basculer(p.code, false)} className="rounded-full px-1.5 text-[#5DCAA5] hover:bg-white/5 disabled:opacity-40">
                    Réafficher
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Prochaine action ────────────────────────────────────────────── */

const RACCOURCIS_DATE = [
  { libelle: "Aujourd'hui", jours: 0 },
  { libelle: "Demain", jours: 1 },
  { libelle: "Dans 3 j", jours: 3 },
  { libelle: "Dans 1 sem.", jours: 7 },
] as const;

function ProchaineActionEditeur({
  detail,
  maintenant,
  onMisAJour,
}: {
  detail: DossierDetail;
  maintenant: Date;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const actionInitiale = detail.prochaineAction ?? "";
  const dateInitiale = detail.prochaineActionDate ? jourParis(detail.prochaineActionDate) : "";
  const [action, setAction] = useState(actionInitiale);
  const [date, setDate] = useState(dateInitiale);
  const [envoi, setEnvoi] = useState(false);
  const modifie = action.trim() !== actionInitiale || date !== dateInitiale;

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", {
        prochaineAction: action.trim() || null,
        prochaineActionDate: date || null,
      });
      onMisAJour(nouveau);
      toast.success("Prochaine action enregistrée");
    } catch (probleme) {
      toast.error("Prochaine action non enregistrée", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section>
      <TitreSection>Prochaine action</TitreSection>
      <ProchaineActionResume dossier={detail} maintenant={maintenant} className="mb-3" />
      <form onSubmit={enregistrer} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
        <input
          aria-label="Prochaine action"
          value={action}
          maxLength={140}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Ex. Relancer par téléphone"
          className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}
        />
        <input
          type="date"
          aria-label="Date de la prochaine action"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(CLASSE_SAISIE, "h-10 sm:h-9")}
        />
        <Bouton type="submit" variante={modifie ? "primaire" : "secondaire"} disabled={!modifie} chargement={envoi}>
          Enregistrer
        </Bouton>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RACCOURCIS_DATE.map((raccourci) => (
          <button
            key={raccourci.jours}
            type="button"
            onClick={() => setDate(jourParis(new Date(Date.now() + raccourci.jours * 86_400_000)))}
            className={cn(
              "h-8 rounded-full border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-6 sm:text-[11px]",
              TRANS
            )}
          >
            {raccourci.libelle}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── Historique ──────────────────────────────────────────────────── */

const ICONES_EVENEMENT: Partial<Record<TypeEvenement, typeof FileText>> = {
  CHANGEMENT_ETAPE: ArrowRightLeft,
  DEVIS_GENERE: FileText,
  FACTURE_GENEREE: FileText,
  AVOIR_GENERE: FileText,
  DEVIS_ENVOYE: FileText,
  ENCAISSEMENT_ENREGISTRE: Euro,
  ENCAISSEMENT_CREDITE: Landmark,
  ENCAISSEMENT_REJETE: Ban,
  ENCAISSEMENT_ANNULE: Undo2,
  NOTE_AJOUTEE: StickyNote,
  APPEL: Phone,
  MAIL_RECU: Mail,
  MAIL_ENVOYE: Mail,
};

function HistoriqueEvenements({ dossierId, evenements, onRecharger }: { dossierId: string; evenements: EvenementVue[]; onRecharger: () => Promise<void> }) {
  const [tout, setTout] = useState(false);
  const [mail, setMail] = useState<string | null>(null);
  const liste = tout ? evenements : evenements.slice(0, 20);

  return (
    <div>
      <Link href={`/journal?dossierId=${dossierId}`} className={cn("inline-flex min-h-7 items-center text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
        Journal détaillé : chaque modification, par qui et quand
      </Link>
      {evenements.length === 0 ? <p className="mt-2 text-[12.5px] text-[#6B7280]">Rien encore.</p> : null}
      {evenements.length > 0 ? (
        <ol className="mt-3 space-y-3">
          {liste.map((evenement) => {
            const Icone = ICONES_EVENEMENT[evenement.type] ?? MessageSquare;
            return (
              <li key={evenement.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                  <Icone size={12} className="text-[#9CA3AF]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] break-words text-[#D1D5DB]">{evenement.contenu}</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    {LIBELLES_TYPE_EVENEMENT[evenement.type] ?? "Événement"} ·{" "}
                    {evenement.saisiLe ? `${formatDateCourte(evenement.date)} (saisi le ${formatDateCourte(evenement.saisiLe)})` : formatHorodatage(evenement.date)}
                    {evenement.messageId ? (
                      <>
                        {" · "}
                        <button type="button" onClick={() => setMail(evenement.messageId)} className={cn("text-[#9CA3AF] underline-offset-2 hover:text-[#F2F3F5] hover:underline", TRANS)}>
                          Lire le mail
                        </button>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
          {!tout && evenements.length > liste.length ? (
            <li>
              <Bouton variante="fantome" taille="sm" onClick={() => setTout(true)}>
                Voir les {evenements.length - liste.length} plus anciens
              </Bouton>
            </li>
          ) : null}
        </ol>
      ) : null}
      {mail ? <LecteurMessage key={mail} messageId={mail} onFermer={() => setMail(null)} onModifie={() => void onRecharger()} /> : null}
    </div>
  );
}
