"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Columns3, List } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { DossiersArchives } from "@/app/(pilotage)/dossiers/_components/ArchivageDossier";
import { CreationDossier } from "@/app/(pilotage)/dossiers/_components/CreationDossier";
import { FiltreEspaces } from "@/app/(pilotage)/dossiers/_components/EspaceColonne";
import { VueKanban } from "@/app/(pilotage)/dossiers/_components/VueKanban";
import { alertesACompleter } from "@/lib/dossiers/completude";
import type { PageDossiers } from "@/lib/dossiers/dossiers";
import type { DossierDetail, DossierResume, LeadTrouve } from "@/lib/dossiers/types";
import type { EtapeEspace } from "@/lib/espace/etapes";
import type { FiltreEspace, TriEspace } from "@/lib/espace/suivi-types";
import { CLE_VUE_DOSSIERS, SEGMENTS_DOSSIERS, dansLeSegment, decouperLignes, trierCeQuiMattend, vueDuSegment, type DemandeOuvertureV2, type SegmentDossiers, type VueDossiersV2 } from "@/lib/v2/dossiers";
import { cn } from "@/lib/utils";
import { PanneauDossierV2 } from "../dossier/PanneauDossierV2";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { Segments } from "../liste/Segments";
import { BoutonVoirAutres, ChampRecherche, LISTE_V2, PagesV2, Vide } from "../liste/Troncature";
import { LigneDossierV2 } from "./LigneDossierV2";

/**
 * Mission 22 (A4) — l'écran Dossiers de la v2 (`/dossiers`, docs/CRM-V2.md § Dossiers) : la liste « ce qui m'attend »
 * d'abord (le filtre « À faire » du serveur, triée retards en tête), les segments Chez moi · Chez le client · Tous ·
 * Archives, la recherche (`?q=`), une ligne = la situation en trois lignes + le geste principal, cinq lignes puis
 * « Voir les N autres », puis les pages du serveur. Le kanban de la v1 reste en seconde vue (« Vue en colonnes »,
 * même préférence `localStorage["dossiers:vue"]`). Le panneau est celui de la v2 ; création, archives et filtre
 * « Espaces » sont les composants de la v1. Mêmes adresses : `?dossier=`, `?rubrique=`, `?espace=`, `?archives=1`,
 * `?lead=` / `?client=` / `?prospect=` (création préremplie). Aucun badge, aucun compteur.
 */
const sansAbonnement = () => () => {};

/** La préférence de la v1 ; à défaut, la liste (même sur ordinateur : la vue claire d'abord). */
function lireVueParDefaut(): VueDossiersV2 {
  try {
    const memorisee = window.localStorage.getItem(CLE_VUE_DOSSIERS);
    if (memorisee === "kanban" || memorisee === "liste") return memorisee;
  } catch {
    // stockage indisponible
  }
  return "liste";
}

/** Le résumé refait depuis le panneau ; l'espace et les champs de la ligne (téléphone, photos, date) restent ceux de la liste. */
function resumeDepuisDetail(detail: DossierDetail, precedent?: DossierResume): DossierResume {
  return {
    ...(precedent ?? {}),
    id: detail.id,
    clientNom: detail.clientNom,
    clientVille: detail.clientVille,
    objet: detail.objet,
    etape: detail.etape,
    source: detail.source,
    montantEstime: detail.montantEstime,
    teintes: detail.teintes,
    montantDernierDevis: detail.montantDernierDevis,
    prochaineAction: detail.prochaineAction,
    prochaineActionDate: detail.prochaineActionDate,
    etapeAvantSortie: detail.etapeAvantSortie,
    aCompleter: alertesACompleter(detail.completude).length,
    attenteClient: detail.completude.filter((p) => !p.masque && p.attenteClient).length,
    main: detail.main,
    mainLe: detail.mainLe,
    mainMotif: detail.mainMotif,
    ouvertLe: detail.ouvertLe,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    prestations: detail.prestations,
    espace: detail.espace === undefined ? precedent?.espace : detail.espace,
    dateChantier: detail.dateChantier,
    nbPhotos: detail.photos.length,
    clientTelephone: detail.clientTelephone,
  };
}

export function DossiersV2({ initial, leadInitial, dossierInitialId, demandeInitiale = null, espaceInitial = null, archivesInitiales = false, qInitial = "" }: { initial: PageDossiers; leadInitial: LeadTrouve | null; dossierInitialId: string | null; demandeInitiale?: DemandeOuvertureV2 | null; espaceInitial?: { filtre: FiltreEspace; etape: EtapeEspace | null } | null; archivesInitiales?: boolean; qInitial?: string }) {
  const [dossiers, setDossiers] = useState(initial.dossiers);
  const [total, setTotal] = useState(initial.total);
  const [compteursEspaces, setCompteursEspaces] = useState(initial.espaces);
  const [segment, setSegment] = useState<SegmentDossiers>(archivesInitiales ? "ARCHIVES" : "MOI");
  const [segmentAvantArchives, setSegmentAvantArchives] = useState<SegmentDossiers>("MOI");
  const [recherche, setRecherche] = useState(qInitial);
  const [filtreEspace, setFiltreEspace] = useState<FiltreEspace | null>(espaceInitial?.filtre ?? null);
  const [etapeEspace, setEtapeEspace] = useState<EtapeEspace | null>(espaceInitial?.etape ?? null);
  const [triEspace, setTriEspace] = useState<TriEspace>("MAIN");
  const [plusDeFiltres, setPlusDeFiltres] = useState(espaceInitial !== null);
  const vueParDefaut = useSyncExternalStore(sansAbonnement, lireVueParDefaut, () => "liste" as const);
  const [vueChoisie, setVueChoisie] = useState<VueDossiersV2 | null>(null);
  const vue = vueChoisie ?? vueParDefaut;
  const [tout, setTout] = useState(false);
  const [chargement, setChargement] = useState(false);
  const cleFiltres = `${segment}|${recherche.trim()}|${filtreEspace ?? ""}|${etapeEspace ?? ""}|${triEspace}`;
  const [pageDemandee, setPageDemandee] = useState({ page: initial.page, cle: cleFiltres });
  const page = pageDemandee.cle === cleFiltres ? pageDemandee.page : 1;
  const [dossierOuvertId, setDossierOuvertId] = useState<string | null>(dossierInitialId);
  const [demande, setDemande] = useState<{ dossierId: string; demande: DemandeOuvertureV2 } | null>(dossierInitialId && demandeInitiale ? { dossierId: dossierInitialId, demande: demandeInitiale } : null);
  const [creation, setCreation] = useState({ ouverte: leadInitial !== null, lead: leadInitial, cle: 0 });
  const [maintenant, setMaintenant] = useState(() => new Date());

  // Les retards et les dates relatives se recalculent d'eux-mêmes si l'écran reste ouvert.
  useEffect(() => {
    const minuteur = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(minuteur);
  }, []);

  // L'adresse suit le dossier ouvert, la recherche et le filtre « Espaces » : un rechargement ou un lien partagé les rouvrent.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (dossierOuvertId) url.searchParams.set("dossier", dossierOuvertId);
    else url.searchParams.delete("dossier");
    if (recherche.trim()) url.searchParams.set("q", recherche.trim());
    else url.searchParams.delete("q");
    if (filtreEspace) url.searchParams.set("espace", filtreEspace);
    else url.searchParams.delete("espace");
    if (filtreEspace && etapeEspace) url.searchParams.set("etapeEspace", etapeEspace);
    else url.searchParams.delete("etapeEspace");
    if (segment === "ARCHIVES") url.searchParams.set("archives", "1");
    else url.searchParams.delete("archives");
    // Pré-remplissage consommé : un rechargement ne doit pas rouvrir la création (dossier en double).
    url.searchParams.delete("lead");
    url.searchParams.delete("prospect");
    url.searchParams.delete("client");
    window.history.replaceState(window.history.state, "", url);
  }, [dossierOuvertId, recherche, filtreEspace, etapeEspace, segment]);

  const ouvrirDossier = useCallback((id: string, d?: Omit<DemandeOuvertureV2, "cle"> | null) => {
    setDossierOuvertId(id);
    setDemande((actuelle) => (d ? { dossierId: id, demande: { ...d, cle: (actuelle?.demande.cle ?? 0) + 1 } } : null));
  }, []);

  const choisirVue = (nouvelle: VueDossiersV2) => {
    setVueChoisie(nouvelle);
    try {
      window.localStorage.setItem(CLE_VUE_DOSSIERS, nouvelle);
    } catch {
      // préférence non mémorisée
    }
  };

  const choisirSegment = (s: SegmentDossiers) => {
    if (s === "ARCHIVES") setSegmentAvantArchives(segment === "ARCHIVES" ? "MOI" : segment);
    setSegment(s);
    setTout(false);
  };

  /* ── Le serveur : une page à la fois, filtrée là-bas ──────────────────────────────────────────────────────────── */
  const filtres = useRef({ segment, recherche, page, filtreEspace, etapeEspace, triEspace });
  const rafraichir = useCallback(async () => {
    const f = filtres.current;
    if (f.segment === "ARCHIVES") return;
    setChargement(true);
    try {
      const parametres = new URLSearchParams({
        page: String(f.page),
        vue: vueDuSegment(f.segment),
        ...(f.recherche.trim() ? { q: f.recherche.trim() } : {}),
        ...(f.filtreEspace ? { espace: f.filtreEspace } : {}),
        ...(f.filtreEspace && f.etapeEspace ? { etapeEspace: f.etapeEspace } : {}),
        ...(f.filtreEspace && f.triEspace !== "MAIN" ? { triEspace: f.triEspace } : {}),
      });
      const reponse = await appelApi<PageDossiers>(`/api/dossiers?${parametres}`);
      setDossiers(reponse.dossiers);
      setTotal(reponse.total);
      setCompteursEspaces(reponse.espaces);
    } catch (erreur) {
      toast.error("Liste des dossiers non rechargée", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }, []);

  const premierRendu = useRef(true);
  useEffect(() => {
    filtres.current = { segment, recherche, page, filtreEspace, etapeEspace, triEspace };
    if (premierRendu.current) {
      premierRendu.current = false;
      // La première page est arrivée avec l'écran (« Chez moi », ou le filtre « Espaces » de l'adresse, avec `?q=`).
      if (page === initial.page && (segment === "MOI" || segment === "ARCHIVES") && recherche === qInitial && filtreEspace === (espaceInitial?.filtre ?? null) && etapeEspace === (espaceInitial?.etape ?? null) && triEspace === "MAIN") return;
    }
    if (segment === "ARCHIVES") return;
    // Sous le filtre « Espaces », le serveur recalcule l'état de tous les espaces : la recherche attend la fin de la saisie.
    const minuterie = window.setTimeout(() => void rafraichir(), recherche ? (filtreEspace ? 600 : 250) : 0);
    return () => window.clearTimeout(minuterie);
  }, [segment, recherche, page, filtreEspace, etapeEspace, triEspace, rafraichir, initial.page, qInitial, espaceInitial]);

  const mettreAJour = useCallback((detail: DossierDetail) => {
    setDossiers((liste) => {
      const precedent = liste.find((dossier) => dossier.id === detail.id);
      const resume = resumeDepuisDetail(detail, precedent);
      return precedent ? liste.map((dossier) => (dossier.id === detail.id ? resume : dossier)) : [resume, ...liste];
    });
  }, []);

  /* ── Ce qui s'affiche ─────────────────────────────────────────────────────────────────────────────────────────── */
  // « Chez le client » se filtre ici sur la page « en cours » (la même règle que `mainDe`) ; sous « Espaces », l'ordre du serveur reste.
  const visibles = useMemo(() => {
    const retenus = filtreEspace ? dossiers : dossiers.filter((d) => dansLeSegment(d, segment, maintenant));
    return filtreEspace ? retenus : trierCeQuiMattend(retenus, maintenant);
  }, [dossiers, segment, maintenant, filtreEspace]);
  const decoupe = decouperLignes(visibles, tout);
  const libelleSegment = SEGMENTS_DOSSIERS.find((s) => s.valeur === segment)?.libelle ?? "";

  const ouvrirCreation = () => setCreation((actuelle) => ({ ouverte: true, lead: null, cle: actuelle.cle + 1 }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-8 md:py-6">
      <h1 className="sr-only">Dossiers</h1>
      <div className="flex flex-col gap-4">
        {/* 1. Ce qui m'attend : les segments, puis la recherche */}
        <section aria-label="Quels dossiers" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segments libelle="Quels dossiers" options={SEGMENTS_DOSSIERS} actif={segment} onChoisir={choisirSegment} />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => choisirVue(vue === "liste" ? "kanban" : "liste")} aria-pressed={vue === "kanban"} className={cn(BOUTON_SECONDAIRE, "gap-2 px-3")}>
                {vue === "liste" ? <Columns3 size={18} aria-hidden /> : <List size={18} aria-hidden />}
                {vue === "liste" ? "Vue en colonnes" : "Vue en liste"}
              </button>
              <button type="button" onClick={ouvrirCreation} className={BOUTON_SECONDAIRE}>
                Ouvrir un dossier
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ChampRecherche valeur={recherche} onChange={(v) => { setRecherche(v); setTout(false); }} placeholder="Client, ville, objet…" libelle="Rechercher un dossier" />
            <button type="button" aria-expanded={plusDeFiltres} onClick={() => setPlusDeFiltres((v) => !v)} className={cn(BOUTON_SECONDAIRE, "shrink-0")}>
              Plus de filtres
            </button>
          </div>
          {plusDeFiltres ? (
            <div className="flex flex-col gap-2 rounded-[11px] border border-trait bg-surface p-3">
              <button
                type="button"
                aria-pressed={filtreEspace !== null}
                onClick={() => {
                  setFiltreEspace(filtreEspace ? null : "TOUS");
                  setEtapeEspace(null);
                  setTout(false);
                }}
                className={cn(BOUTON_SECONDAIRE, "self-start", filtreEspace && "border-action bg-action-fond text-action-clair")}
              >
                Avec un espace client
              </button>
              {filtreEspace ? <FiltreEspaces filtre={filtreEspace} etape={etapeEspace} tri={triEspace} compteurs={compteursEspaces} onFiltre={setFiltreEspace} onEtape={setEtapeEspace} onTri={setTriEspace} /> : null}
            </div>
          ) : null}
        </section>

        {/* 2. La liste (ou les colonnes) */}
        <section aria-label={`Dossiers : ${libelleSegment}`} aria-busy={chargement} className={cn("flex flex-col gap-3", chargement && "opacity-60")}>
          {segment === "ARCHIVES" ? (
            <Vide>Les dossiers archivés s&apos;ouvrent dans le volet à droite ; un dossier restauré revient dans « Tous ».</Vide>
          ) : visibles.length === 0 ? (
            <Vide>
              {recherche.trim()
                ? "Aucun dossier ne correspond à cette recherche."
                : segment === "MOI"
                  ? "Rien à faire pour l'instant : les dossiers en cours sont chez les clients, sans retard."
                  : segment === "CLIENT"
                    ? "Aucun dossier n'attend le client en ce moment."
                    : "Aucun dossier pour l'instant. Un dossier s'ouvre à la conversion : photos du chantier, coordonnées complètes, nature du chantier."}
            </Vide>
          ) : vue === "kanban" ? (
            <VueKanban dossiers={visibles} afficherSorties={segment === "TOUS"} masquerColonnesVides={segment !== "TOUS"} ordreServeur={filtreEspace !== null} maintenant={maintenant} onOuvrir={(id) => ouvrirDossier(id)} />
          ) : (
            <>
              <ul className={LISTE_V2}>
                {decoupe.visibles.map((dossier) => (
                  <LigneDossierV2 key={dossier.id} dossier={dossier} maintenant={maintenant} onOuvrir={ouvrirDossier} />
                ))}
              </ul>
              <BoutonVoirAutres reste={decoupe.reste} onClick={() => setTout(true)} />
            </>
          )}
          {segment !== "ARCHIVES" ? <PagesV2 total={total} page={page} parPage={initial.parPage} onPage={(p) => { setPageDemandee({ page: p, cle: cleFiltres }); setTout(false); }} /> : null}
        </section>
      </div>

      <PanneauDossierV2
        dossierId={dossierOuvertId}
        demande={demande && demande.dossierId === dossierOuvertId ? demande.demande : null}
        maintenant={maintenant}
        onFermer={() => setDossierOuvertId(null)}
        onMisAJour={mettreAJour}
        onArchive={(id) => {
          setDossiers((liste) => liste.filter((dossier) => dossier.id !== id));
          setDossierOuvertId(null);
        }}
      />
      <DossiersArchives ouverte={segment === "ARCHIVES"} onFermer={() => setSegment(segmentAvantArchives)} onRestaure={() => void rafraichir()} />
      <CreationDossier
        key={creation.cle}
        ouverte={creation.ouverte}
        leadInitial={creation.lead}
        onFermer={() => setCreation((actuelle) => ({ ...actuelle, ouverte: false }))}
        onCree={(id) => {
          setCreation((actuelle) => ({ ...actuelle, ouverte: false }));
          void rafraichir();
          setDossierOuvertId(id);
        }}
      />
    </div>
  );
}
