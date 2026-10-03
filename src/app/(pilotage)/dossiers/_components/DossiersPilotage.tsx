"use client";

import { alertesACompleter } from "@/lib/dossiers/completude";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Archive, CircleCheck, Columns3, FolderOpen, FolderPlus, Info, List, Play, Search, Smartphone } from "lucide-react";
import { toast } from "sonner";
import type { PageDossiers } from "@/lib/dossiers/dossiers";
import type { DossierDetail, DossierResume, LeadTrouve } from "@/lib/dossiers/types";
import type { EtapeEspace } from "@/lib/espace/etapes";
import type { FiltreEspace } from "@/lib/espace/suivi-types";
import { cn } from "@/lib/utils";
import { PropositionsEnAttente } from "@/components/pilotage/PropositionsEnAttente";
import { DossiersArchives } from "./ArchivageDossier";
import { CreationDossier } from "./CreationDossier";
import { FiltreEspaces } from "./EspaceColonne";
import { Legende } from "./Legende";
import { PanneauDossier, type DemandeOuverture } from "./PanneauDossier";
import { VueKanban } from "./VueKanban";
import { type DemandeRaccourci } from "./CarteDossier";
import { LIBELLES_TRI, SENS_PAR_DEFAUT, VueListe, type CleTri, type Tri } from "./VueListe";
import { Pagination, Bouton, EtatVide, TRANS } from "@/components/pilotage/ui";
import { appelApi, messageErreur } from "@/components/pilotage/client";

type Vue = "kanban" | "liste";
const CLE_VUE = "dossiers:vue";

const sansAbonnement = () => () => {};

/** Vue mémorisée ; à défaut, la liste sur téléphone (triée par prochaine action). */
function lireVueParDefaut(): Vue {
  try {
    const memorisee = window.localStorage.getItem(CLE_VUE);
    if (memorisee === "kanban" || memorisee === "liste") return memorisee;
  } catch {
    // stockage indisponible : choix selon l'écran
  }
  return window.matchMedia("(max-width: 767px)").matches ? "liste" : "kanban";
}

/** Le résumé refait depuis le panneau ; l'état de l'espace (calculé par la liste) reste celui de la ligne. */
function resumeDepuisDetail(detail: DossierDetail, precedent?: DossierResume): DossierResume {
  return {
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
    espace: precedent?.espace,
  };
}

const CLASSE_ONGLET = "flex h-11 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium sm:h-7";

const CLE_INACTIFS = "dossiers:masquer-inactifs";

function lireMasquerInactifs(): boolean {
  try {
    return window.localStorage.getItem(CLE_INACTIFS) === "1";
  } catch {
    return false;
  }
}

export default function DossiersPilotage({
  initial,
  leadInitial,
  dossierInitialId,
  demandeInitiale = null,
  espaceInitial = null,
  archivesInitiales = false,
}: {
  /** Mission 13 (lot 6) : la première page (50), rendue par le serveur avec l'écran ; le reste se demande page par page. */
  initial: PageDossiers;
  leadInitial: LeadTrouve | null;
  dossierInitialId: string | null;
  /** Mission 13 (lot 4) : ?rubrique= dans l'adresse (notification, tâche) — la rubrique du panneau à ouvrir. */
  demandeInitiale?: DemandeOuverture | null;
  /** Mission 18 (A1) : ?espace= (et ?etapeEspace=) — le filtre « Espaces » ouvert d'emblée (/espaces y redirige). */
  espaceInitial?: { filtre: FiltreEspace; etape: EtapeEspace | null } | null;
  /** ?archives=1 : les dossiers archivés ouverts d'emblée. */
  archivesInitiales?: boolean;
}) {
  const [dossiers, setDossiers] = useState(initial.dossiers);
  const [total, setTotal] = useState(initial.total);
  const [compteurs, setCompteurs] = useState(initial.compteurs);
  const vueParDefaut = useSyncExternalStore(sansAbonnement, lireVueParDefaut, () => "kanban" as const);
  const [vueChoisie, setVueChoisie] = useState<Vue | null>(null);
  const vue = vueChoisie ?? vueParDefaut;
  const [afficherSorties, setAfficherSorties] = useState(false);
  // Masquer les dossiers sans activité depuis 30 jours (jamais ceux où j'ai la main) : mémorisé sur l'appareil.
  const masquerInactifsParDefaut = useSyncExternalStore(sansAbonnement, lireMasquerInactifs, () => false);
  const [masquerInactifsChoisi, setMasquerInactifsChoisi] = useState<boolean | null>(null);
  const masquerInactifs = masquerInactifsChoisi ?? masquerInactifsParDefaut;
  const [filtreAFaire, setFiltreAFaire] = useState(false);
  const [legendeOuverte, setLegendeOuverte] = useState(false);
  const [archivesOuvertes, setArchivesOuvertes] = useState(archivesInitiales);
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<Tri>({ cle: "prochaineAction", sens: "asc" });
  // Mission 18 (A1) : le filtre « Espaces » (l'ancien onglet Espaces clients) ; null = éteint. Il remplace « Tous / À
  // faire », « Perdus et en pause » et les inactifs : le serveur filtre tous les dossiers qui ont un espace.
  const [filtreEspace, setFiltreEspace] = useState<FiltreEspace | null>(espaceInitial?.filtre ?? null);
  const [etapeEspace, setEtapeEspace] = useState<EtapeEspace | null>(espaceInitial?.etape ?? null);
  const [compteursEspaces, setCompteursEspaces] = useState(initial.espaces);
  const espaceActif = filtreEspace !== null;
  // Mission 13 (lot 6) : une page à la fois ; changer un filtre ramène à la première page (la clé des filtres change).
  const cleFiltres = `${filtreAFaire}|${afficherSorties}|${recherche}|${masquerInactifs}|${filtreEspace}|${etapeEspace}`;
  const [pageDemandee, setPageDemandee] = useState({ page: initial.page, cle: cleFiltres });
  const page = pageDemandee.cle === cleFiltres ? pageDemandee.page : 1;
  const [dossierOuvertId, setDossierOuvertId] = useState<string | null>(dossierInitialId);
  // Mission 13 (lot 4) : la rubrique demandée par un raccourci (ligne, Espaces clients, notification), une fois.
  const [demande, setDemande] = useState<{ dossierId: string; demande: DemandeOuverture } | null>(dossierInitialId && demandeInitiale ? { dossierId: dossierInitialId, demande: demandeInitiale } : null);
  const ouvrirDossier = useCallback((id: string, raccourci?: DemandeRaccourci) => {
    setDossierOuvertId(id);
    setDemande((actuelle) => (raccourci ? { dossierId: id, demande: { ...raccourci, cle: (actuelle?.demande.cle ?? 0) + 1 } } : null));
  }, []);
  const [creation, setCreation] = useState({ ouverte: leadInitial !== null, lead: leadInitial, cle: 0 });
  const [maintenant, setMaintenant] = useState(() => new Date());

  // Les retards se recalculent d'eux-mêmes si l'écran reste ouvert.
  useEffect(() => {
    const minuteur = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(minuteur);
  }, []);

  // L'URL suit le dossier ouvert et le filtre « Espaces » : un rechargement ou un lien partagé les rouvre.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (dossierOuvertId) url.searchParams.set("dossier", dossierOuvertId);
    else url.searchParams.delete("dossier");
    if (filtreEspace) url.searchParams.set("espace", filtreEspace);
    else url.searchParams.delete("espace");
    if (filtreEspace && etapeEspace) url.searchParams.set("etapeEspace", etapeEspace);
    else url.searchParams.delete("etapeEspace");
    // Pré-remplissage consommé : un rechargement ne doit pas rouvrir la création (dossier en double).
    url.searchParams.delete("lead");
    url.searchParams.delete("prospect");
    url.searchParams.delete("client");
    url.searchParams.delete("archives");
    window.history.replaceState(window.history.state, "", url);
  }, [dossierOuvertId, filtreEspace, etapeEspace]);

  const choisirVue = (nouvelle: Vue) => {
    setVueChoisie(nouvelle);
    try {
      window.localStorage.setItem(CLE_VUE, nouvelle);
    } catch {
      // préférence non mémorisée
    }
  };

  const trier = (cle: CleTri) =>
    setTri((actuel) =>
      actuel.cle === cle ? { cle, sens: actuel.sens === "asc" ? "desc" : "asc" } : { cle, sens: SENS_PAR_DEFAUT[cle] }
    );

  // Le serveur ne rend qu'une page, filtrée là-bas ; les filtres vivent dans une référence pour que la fonction reste stable.
  const filtres = useRef({ page, filtreAFaire, afficherSorties, recherche, masquerInactifs, filtreEspace, etapeEspace });
  const rafraichir = useCallback(async () => {
    const f = filtres.current;
    try {
      const parametres = new URLSearchParams({
        page: String(f.page),
        vue: f.filtreAFaire ? "A_FAIRE" : f.afficherSorties ? "TOUS" : "EN_COURS",
        ...(f.recherche.trim() ? { q: f.recherche.trim() } : {}),
        ...(f.masquerInactifs ? { inactifs: "0" } : {}),
        ...(f.filtreEspace ? { espace: f.filtreEspace } : {}),
        ...(f.filtreEspace && f.etapeEspace ? { etapeEspace: f.etapeEspace } : {}),
      });
      const reponse = await appelApi<PageDossiers>(`/api/dossiers?${parametres}`);
      setDossiers(reponse.dossiers);
      setTotal(reponse.total);
      setCompteurs(reponse.compteurs);
      setCompteursEspaces(reponse.espaces);
    } catch (erreur) {
      toast.error("Liste des dossiers non rechargée", { description: messageErreur(erreur) });
    }
  }, []);

  const premierRendu = useRef(true);
  useEffect(() => {
    filtres.current = { page, filtreAFaire, afficherSorties, recherche, masquerInactifs, filtreEspace, etapeEspace };
    if (premierRendu.current) {
      premierRendu.current = false;
      // La première page est arrivée avec l'écran (filtre « Espaces » de l'adresse compris) : on ne la redemande que
      // si l'appareil masque les inactifs (sans effet sous le filtre « Espaces »).
      if (page === initial.page && !filtreAFaire && !afficherSorties && !recherche && (filtreEspace !== null || !masquerInactifs)) return;
    }
    const minuterie = window.setTimeout(() => void rafraichir(), recherche ? 250 : 0);
    return () => window.clearTimeout(minuterie);
  }, [page, filtreAFaire, afficherSorties, recherche, masquerInactifs, filtreEspace, etapeEspace, rafraichir, initial.page]);

  const mettreAJour = useCallback((detail: DossierDetail) => {
    setDossiers((liste) => {
      const precedent = liste.find((dossier) => dossier.id === detail.id);
      const resume = resumeDepuisDetail(detail, precedent);
      return precedent ? liste.map((dossier) => (dossier.id === detail.id ? resume : dossier)) : [resume, ...liste];
    });
  }, []);

  const basculerEspaces = () => {
    if (espaceActif) {
      setFiltreEspace(null);
      setEtapeEspace(null);
      return;
    }
    setFiltreAFaire(false);
    setFiltreEspace("TOUS");
  };

  // Mission 13 (lot 6) : la page arrive déjà filtrée par le serveur.
  const visibles = dossiers;
  const inactifs = compteurs.inactifs;

  const basculerInactifs = () => {
    const suite = !masquerInactifs;
    setMasquerInactifsChoisi(suite);
    try {
      window.localStorage.setItem(CLE_INACTIFS, suite ? "1" : "0");
    } catch {
      // préférence non mémorisée
    }
  };

  // Les chiffres viennent du serveur, sur tous les dossiers vivants (la page n'en montre que 50).
  const { enCours, enRetard, aFaire } = compteurs;
  const tous = filtreAFaire ? compteurs.enCours : total;

  const ouvrirCreation = () => setCreation((actuelle) => ({ ouverte: true, lead: null, cle: actuelle.cle + 1 }));

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight text-[#F2F3F5]">Dossiers en cours</h1>
          <p className="mt-1 text-[13px] text-[#9CA3AF]">
            {enCours} en cours · <span className="text-[#F2F3F5]">{aFaire} à faire</span>
            {enRetard > 0 ? (
              <>
                {" · "}
                <span className="text-[#F87171]">{enRetard} en retard</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PropositionsEnAttente />
          <Bouton variante="primaire" icone={<FolderPlus size={15} aria-hidden />} onClick={ouvrirCreation}>
            Ouvrir un dossier
          </Bouton>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {/* Filtre rapide : « À faire » ne garde que les dossiers où j'ai la main (le filtre « Espaces » a les siens). */}
        <div
          role="tablist"
          aria-label="Filtre rapide"
          className={cn("flex items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]", espaceActif && "hidden")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={!filtreAFaire}
            onClick={() => setFiltreAFaire(false)}
            className={cn(
              CLASSE_ONGLET,
              !filtreAFaire ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
              TRANS
            )}
          >
            Tous
            <span className="text-[11px] text-[#9CA3AF] tabular-nums">{tous}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filtreAFaire}
            onClick={() => setFiltreAFaire(true)}
            className={cn(
              CLASSE_ONGLET,
              "font-semibold",
              filtreAFaire ? "bg-[#F2F3F5] text-[#0B0D10]" : "text-[#F2F3F5] hover:bg-[#22262D]",
              TRANS
            )}
          >
            <Play size={11} strokeWidth={2.5} className="fill-current" aria-hidden />
            À faire
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                filtreAFaire ? "bg-[#0B0D10]/10 text-[#0B0D10]" : "bg-[#22262D] text-[#F2F3F5]"
              )}
            >
              {aFaire}
            </span>
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Affichage"
          className="flex items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]"
        >
          {(
            [
              { valeur: "kanban", libelle: "Kanban", Icone: Columns3 },
              { valeur: "liste", libelle: "Liste", Icone: List },
            ] as const
          ).map(({ valeur, libelle, Icone }) => (
            <button
              key={valeur}
              type="button"
              role="tab"
              aria-selected={vue === valeur}
              onClick={() => choisirVue(valeur)}
              className={cn(
                CLASSE_ONGLET,
                vue === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
                TRANS
              )}
            >
              <Icone size={14} aria-hidden />
              {/* Icône seule sur téléphone : filtre et affichage tiennent sur une ligne. */}
              <span className="sr-only sm:not-sr-only">{libelle}</span>
            </button>
          ))}
        </div>

        <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <span className="sr-only">Rechercher un dossier</span>
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="search"
            value={recherche}
            onChange={(evenement) => setRecherche(evenement.target.value)}
            placeholder="Client, ville, objet…"
            className={cn(
              "h-11 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] pr-3 pl-8 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] sm:h-8 sm:text-[13px]",
              "hover:border-[#3A3E47] focus:border-[#1D9E75]/60 focus:outline-none",
              TRANS
            )}
          />
        </label>

        {filtreAFaire || espaceActif ? null : (
          <button
            type="button"
            aria-pressed={afficherSorties}
            onClick={() => setAfficherSorties((valeur) => !valeur)}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] px-3 text-[13px] sm:h-8",
              afficherSorties
                ? "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]"
                : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5]",
              TRANS
            )}
          >
            Perdus et en pause
            <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{compteurs.sorties}</span>
          </button>
        )}

        {!espaceActif && (inactifs > 0 || masquerInactifs) ? (
          <button
            type="button"
            aria-pressed={masquerInactifs}
            onClick={basculerInactifs}
            title="Dossiers sans activité depuis 30 jours, où le client a la main"
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] px-3 text-[13px] sm:h-8",
              masquerInactifs
                ? "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]"
                : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5]",
              TRANS
            )}
          >
            <span className="sm:hidden">{masquerInactifs ? "Inactifs masqués" : "Inactifs"}</span>
            <span className="hidden sm:inline">{masquerInactifs ? "Inactifs masqués" : "Masquer les inactifs"}</span>
            <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{inactifs}</span>
          </button>
        ) : null}

        {/* Mission 18 (A1) : l'ancien onglet Espaces clients — les dossiers qui ont un espace, par qui a la main et par signal. */}
        <button
          type="button"
          aria-pressed={espaceActif}
          onClick={basculerEspaces}
          title="Les dossiers qui ont un espace client : qui a la main, signaux, étape de l'espace"
          className={cn(
            "inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] px-3 text-[13px] sm:h-8",
            espaceActif
              ? "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]"
              : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5]",
            TRANS
          )}
        >
          <Smartphone size={13} aria-hidden />
          Espaces
        </button>

        <Bouton variante="fantome" taille="sm" icone={<Archive size={13} aria-hidden />} onClick={() => setArchivesOuvertes(true)} aria-label="Dossiers archivés" className="h-11 sm:ml-auto sm:h-7">
          <span className="sr-only sm:not-sr-only">Archivés</span>
        </Bouton>

        <Bouton
          variante="fantome"
          taille="sm"
          icone={<Info size={13} aria-hidden />}
          aria-expanded={legendeOuverte}
          aria-controls="legende-dossiers"
          onClick={() => setLegendeOuverte((valeur) => !valeur)}
          aria-label="Légende"
          className="h-11 sm:h-7"
        >
          <span className="sr-only sm:not-sr-only">Légende</span>
        </Bouton>

        {vue === "liste" ? (
          <label className="flex w-full items-center gap-2 text-[12px] text-[#9CA3AF] md:hidden">
            Trier par
            <select
              value={tri.cle}
              onChange={(evenement) => trier(evenement.target.value as CleTri)}
              className="h-11 sm:h-10 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2 text-[16px] text-[#F2F3F5] [color-scheme:dark]"
            >
              {(Object.keys(LIBELLES_TRI) as CleTri[]).map((cle) => (
                <option key={cle} value={cle}>
                  {LIBELLES_TRI[cle]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {filtreEspace ? <FiltreEspaces filtre={filtreEspace} etape={etapeEspace} compteurs={compteursEspaces} onFiltre={setFiltreEspace} onEtape={setEtapeEspace} /> : null}

      {legendeOuverte ? <Legende onFermer={() => setLegendeOuverte(false)} /> : null}

      <main className="mt-5">
        {total === 0 && compteurs.enCours + compteurs.sorties === 0 ? (
          <EtatVide
            icone={<FolderOpen size={18} className="text-[#6B7280]" aria-hidden />}
            titre="Aucun dossier pour l'instant"
            texte="Un dossier s'ouvre à la conversion : photos du chantier, coordonnées complètes du client et nature du chantier."
          />
        ) : espaceActif && visibles.length === 0 ? (
          <EtatVide
            icone={<Smartphone size={18} className="text-[#6B7280]" aria-hidden />}
            titre="Aucun espace client dans ce filtre"
            texte="Un espace s'ouvre depuis un lead ou un dossier (« Ouvrir l'espace client »), puis le lien part par mail ou par SMS. Un client n'en a qu'un, pour tous ses projets."
          />
        ) : filtreAFaire && visibles.length === 0 ? (
          <EtatVide
            icone={<CircleCheck size={18} className="text-[#1D9E75]" aria-hidden />}
            titre={recherche.trim() ? "Aucun dossier à faire ne correspond" : "Rien à faire pour l'instant"}
            texte={
              recherche.trim()
                ? "Modifie la recherche ou repasse sur « Tous »."
                : "Les dossiers en cours sont chez les clients, sans retard."
            }
          />
        ) : visibles.length === 0 && vue === "liste" ? (
          <EtatVide titre="Aucun dossier ne correspond" texte="Modifie la recherche ou affiche les dossiers perdus et en pause." />
        ) : vue === "kanban" ? (
          <VueKanban
            dossiers={visibles}
            afficherSorties={afficherSorties || espaceActif}
            masquerColonnesVides={filtreAFaire || espaceActif}
            maintenant={maintenant}
            onOuvrir={ouvrirDossier}
          />
        ) : (
          <VueListe dossiers={visibles} tri={tri} onTrier={trier} maintenant={maintenant} onOuvrir={ouvrirDossier} />
        )}
        <Pagination total={total} page={page} onPage={(p) => setPageDemandee({ page: p, cle: cleFiltres })} />
      </main>

      <PanneauDossier
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
      <DossiersArchives ouverte={archivesOuvertes} onFermer={() => setArchivesOuvertes(false)} onRestaure={() => void rafraichir()} />

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
