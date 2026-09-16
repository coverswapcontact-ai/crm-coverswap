"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Columns3, FolderOpen, FolderPlus, List, Search } from "lucide-react";
import { toast } from "sonner";
import { ETAPES_SORTIE } from "@/lib/dossiers/constants";
import type { DossierDetail, DossierResume, LeadTrouve } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { echeanceDe } from "./CarteDossier";
import { CreationDossier } from "./CreationDossier";
import { PanneauDossier } from "./PanneauDossier";
import { VueKanban } from "./VueKanban";
import { LIBELLES_TRI, SENS_PAR_DEFAUT, VueListe, type CleTri, type Tri } from "./VueListe";
import { appelApi, messageErreur } from "./client";
import { Bouton, EtatVide, TRANS } from "./ui";

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

const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function resumeDepuisDetail(detail: DossierDetail): DossierResume {
  return {
    id: detail.id,
    clientNom: detail.clientNom,
    clientVille: detail.clientVille,
    objet: detail.objet,
    etape: detail.etape,
    source: detail.source,
    montantEstime: detail.montantEstime,
    montantDernierDevis: detail.montantDernierDevis,
    prochaineAction: detail.prochaineAction,
    prochaineActionDate: detail.prochaineActionDate,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export default function DossiersPilotage({
  dossiersInitiaux,
  leadInitial,
  dossierInitialId,
}: {
  dossiersInitiaux: DossierResume[];
  leadInitial: LeadTrouve | null;
  dossierInitialId: string | null;
}) {
  const [dossiers, setDossiers] = useState(dossiersInitiaux);
  const vueParDefaut = useSyncExternalStore(sansAbonnement, lireVueParDefaut, () => "kanban" as const);
  const [vueChoisie, setVueChoisie] = useState<Vue | null>(null);
  const vue = vueChoisie ?? vueParDefaut;
  const [afficherSorties, setAfficherSorties] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<Tri>({ cle: "prochaineAction", sens: "asc" });
  const [dossierOuvertId, setDossierOuvertId] = useState<string | null>(dossierInitialId);
  const [creation, setCreation] = useState({ ouverte: leadInitial !== null, lead: leadInitial, cle: 0 });
  const [maintenant, setMaintenant] = useState(() => new Date());

  // Les retards se recalculent d'eux-mêmes si l'écran reste ouvert.
  useEffect(() => {
    const minuteur = window.setInterval(() => setMaintenant(new Date()), 60_000);
    return () => window.clearInterval(minuteur);
  }, []);

  // L'URL suit le dossier ouvert : un rechargement ou un lien partagé le rouvre.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (dossierOuvertId) url.searchParams.set("dossier", dossierOuvertId);
    else url.searchParams.delete("dossier");
    url.searchParams.delete("lead");
    window.history.replaceState(window.history.state, "", url);
  }, [dossierOuvertId]);

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

  const rafraichir = useCallback(async () => {
    try {
      const reponse = await appelApi<{ dossiers: DossierResume[] }>("/api/dossiers");
      setDossiers(reponse.dossiers);
    } catch (erreur) {
      toast.error("Liste des dossiers non rechargée", { description: messageErreur(erreur) });
    }
  }, []);

  const mettreAJour = useCallback((detail: DossierDetail) => {
    setDossiers((liste) => {
      const resume = resumeDepuisDetail(detail);
      return liste.some((dossier) => dossier.id === detail.id)
        ? liste.map((dossier) => (dossier.id === detail.id ? resume : dossier))
        : [resume, ...liste];
    });
  }, []);

  const sorties = useMemo(
    () => dossiers.filter((dossier) => (ETAPES_SORTIE as readonly string[]).includes(dossier.etape)),
    [dossiers]
  );

  const visibles = useMemo(() => {
    const termes = normaliser(recherche).split(/\s+/).filter(Boolean);
    return dossiers.filter((dossier) => {
      if (!afficherSorties && (ETAPES_SORTIE as readonly string[]).includes(dossier.etape)) return false;
      if (termes.length === 0) return true;
      const texte = normaliser(
        [dossier.clientNom, dossier.clientVille, dossier.objet, dossier.prochaineAction ?? ""].join(" ")
      );
      return termes.every((terme) => texte.includes(terme));
    });
  }, [dossiers, afficherSorties, recherche]);

  const enCours = dossiers.filter(
    (dossier) => dossier.etape !== "ENCAISSE" && !(ETAPES_SORTIE as readonly string[]).includes(dossier.etape)
  );
  const enRetard = enCours.filter((dossier) => echeanceDe(dossier, maintenant) === "retard").length;

  const ouvrirCreation = () => setCreation((actuelle) => ({ ouverte: true, lead: null, cle: actuelle.cle + 1 }));

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-6 md:px-8 md:py-8">
      <Link
        href="/dashboard"
        className={cn("inline-flex items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#F2F3F5]", TRANS)}
      >
        <ArrowLeft size={13} aria-hidden />
        CRM
      </Link>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-[18px] font-medium tracking-tight text-[#F2F3F5]">Dossiers en cours</h1>
          <p className="mt-1 text-[13px] text-[#9CA3AF]">
            {enCours.length} en cours
            {enRetard > 0 ? (
              <>
                {" · "}
                <span className="text-[#F87171]">
                  {enRetard} en retard
                </span>
              </>
            ) : null}
          </p>
        </div>
        <Bouton variante="primaire" icone={<FolderPlus size={15} aria-hidden />} onClick={ouvrirCreation}>
          Ouvrir un dossier
        </Bouton>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
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
                "flex h-9 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium sm:h-7",
                vue === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
                TRANS
              )}
            >
              <Icone size={14} aria-hidden />
              {libelle}
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
              "h-10 w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] pr-3 pl-8 text-[16px] text-[#F2F3F5] placeholder:text-[#6B7280] sm:h-8 sm:text-[13px]",
              "hover:border-[#3A3E47] focus:border-[#1D9E75]/60 focus:outline-none",
              TRANS
            )}
          />
        </label>

        <button
          type="button"
          aria-pressed={afficherSorties}
          onClick={() => setAfficherSorties((valeur) => !valeur)}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-[8px] border-[0.5px] px-3 text-[13px] sm:h-8",
            afficherSorties
              ? "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]"
              : "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5]",
            TRANS
          )}
        >
          Perdus et en pause
          <span className="rounded-full bg-[#22262D] px-1.5 text-[11px] text-[#9CA3AF] tabular-nums">{sorties.length}</span>
        </button>

        {vue === "liste" ? (
          <label className="flex items-center gap-2 text-[12px] text-[#9CA3AF] md:hidden">
            Trier par
            <select
              value={tri.cle}
              onChange={(evenement) => trier(evenement.target.value as CleTri)}
              className="h-10 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] px-2 text-[16px] text-[#F2F3F5] [color-scheme:dark]"
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

      <main className="mt-5">
        {dossiers.length === 0 ? (
          <EtatVide
            icone={<FolderOpen size={18} className="text-[#6B7280]" aria-hidden />}
            titre="Aucun dossier pour l'instant"
            texte="Un dossier s'ouvre à la conversion : photos du chantier, coordonnées complètes du client et nature du chantier."
          />
        ) : visibles.length === 0 && vue === "liste" ? (
          <EtatVide titre="Aucun dossier ne correspond" texte="Modifie la recherche ou affiche les dossiers perdus et en pause." />
        ) : vue === "kanban" ? (
          <VueKanban dossiers={visibles} afficherSorties={afficherSorties} maintenant={maintenant} onOuvrir={setDossierOuvertId} />
        ) : (
          <VueListe dossiers={visibles} tri={tri} onTrier={trier} maintenant={maintenant} onOuvrir={setDossierOuvertId} />
        )}
      </main>

      <PanneauDossier
        dossierId={dossierOuvertId}
        maintenant={maintenant}
        onFermer={() => setDossierOuvertId(null)}
        onMisAJour={mettreAJour}
      />

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
