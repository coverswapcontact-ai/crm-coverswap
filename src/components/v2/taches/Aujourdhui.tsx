"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { AjoutTache } from "@/app/(pilotage)/taches/_components/AjoutTache";
import { ModeTaches } from "@/app/(pilotage)/taches/_components/ModeTaches";
import { pluriel } from "@/lib/commun/format";
import type { ResultatLot } from "@/lib/a-faire/reponses";
import type { ListeTaches, LotVue, PlanMinutes, TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, libelleChoixMinutes } from "@/lib/a-faire/affichage";
import { MINUTES_V2, PLUS_TARD_VISIBLES, decouper, libelleVoirAutres, phraseVide } from "@/lib/v2/aujourdhui";
import type { ContexteReprendre } from "@/lib/v2/reprendre";
import { cn } from "@/lib/utils";
import { Journal, type DonneesJournal } from "../journal/Journal";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { TRANS_V2 } from "../transitions";
import { BandeauReprendre } from "./BandeauReprendre";
import { CarteTache } from "./CarteTache";
import { CLASSE_LISTE_V2, LigneFaiteV2, LigneTacheV2 } from "./LigneV2";
import { PanneauxRaccourcis } from "./PanneauxRaccourcis";
import { toastAnnulable } from "./toastAnnulable";
import { useGestesTaches } from "./useGestesTaches";
import { useListeTaches } from "./useListeTaches";

/**
 * Mission 22 (A2) — Aujourd'hui, l'accueil de la v2 (`/taches`, docs/CRM-V2.md § Aujourd'hui) : sept blocs au plus,
 * dans cet ordre, rien d'autre au-dessus.
 * 1. Reprendre (seulement s'il y a quelque chose, fermable) ;
 * 2. Maintenant : la première tâche du jour en grand, l'unique bouton principal = le geste prêt ; sous la carte, en
 *    contour, « Commencer » (les tâches à la suite, le mode plein écran de la v1) et « J'ai 5 / 15 / 30 min » (le plan
 *    qui tient, `GET /api/a-faire/minutes`, remplace la liste) ;
 * 3. Ensuite : les cinq suivantes en lignes, « Voir les N autres » ; puis « Ajouter une tâche » et « Actualiser » ;
 * 4. En lot (Tout classer, Revoir un par un) ; 5. Plus tard (trois lignes, replié) ; 6. Fait aujourd'hui (replié) ;
 * 7. Depuis ta dernière visite : le journal compact (lot A1). À droite sur ordinateur, dessous sur téléphone.
 * Chaque geste répond par `toastAnnulable` ; le moteur, les routes, les panneaux et les feuilles sont ceux de la v1.
 */
type Serie = { titre: string; taches: TacheVue[] };

const TITRE_BLOC = "text-titre font-semibold text-texte";
const REPLI = cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] px-1 text-left hover:bg-surface focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2);

export function Aujourdhui({ initiale, journal, reprendre }: { initiale: ListeTaches; journal: DonneesJournal; reprendre: ContexteReprendre | null }) {
  const { liste, maintenant, horsLigne, masquees, masquer, demasquer, relire, relireApres, remplacer } = useListeTaches(initiale);
  const [serie, setSerie] = useState<Serie | null>(null);
  const [autresOuverts, setAutresOuverts] = useState(false);
  const [plusTardOuvert, setPlusTardOuvert] = useState(false);
  const [plusTardTout, setPlusTardTout] = useState(false);
  const [faitOuvert, setFaitOuvert] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanMinutes | null>(null);
  const [chargementPlan, setChargementPlan] = useState(false);
  const [actualisation, setActualisation] = useState(false);
  const [lotEnCours, setLotEnCours] = useState<string | null>(null);

  /* ── Ce qui s'affiche ────────────────────────────────────────────── */

  const aujourdhui = useMemo(() => liste.aujourdhui.filter((t) => !masquees.has(t.id)), [liste.aujourdhui, masquees]);
  const plusTard = useMemo(() => liste.plusTard.filter((t) => !(masquees.has(t.id) && t.statut === "A_FAIRE")), [liste.plusTard, masquees]);
  // « J'ai N minutes » : le plan remplace la liste du jour tant qu'il est choisi.
  const planActif = minutes !== null && plan && plan.minutes === minutes ? plan : null;
  const vue = useMemo(() => (planActif ? planActif.taches.filter((t) => !masquees.has(t.id)) : aujourdhui), [planActif, aujourdhui, masquees]);
  const blocs = useMemo(() => decouper(vue), [vue]);
  const minutesAujourdhui = aujourdhui.reduce((s, t) => s + t.dureeMin, 0);
  const ordre = useMemo(() => [...vue, ...plusTard].map((t) => t.id), [vue, plusTard]);

  const gestes = useGestesTaches({ ordre, relire, relireApres, masquer, demasquer });
  const { occupees, retour, traitees, actions } = gestes;

  const fermees = useMemo(() => new Set([...liste.faitAujourdhui.map((t) => t.id), ...liste.plusTard.filter((t) => t.statut === "PLUS_TARD" && t.plusTardJusqua && Date.parse(t.plusTardJusqua) > maintenant).map((t) => t.id)]), [liste, maintenant]);
  const restantes = useMemo(() => (serie ? serie.taches.filter((t) => !traitees.has(t.id) && !fermees.has(t.id)) : []), [serie, traitees, fermees]);
  // La surbrillance : la tâche d'où l'on revient si elle est encore là, sinon la suivante.
  const surbrillance = retour ? (ordre.includes(retour.id) ? retour.id : retour.suivante && ordre.includes(retour.suivante) ? retour.suivante : null) : null;

  // La tâche en surbrillance reste à l'écran (le panneau refermé, la liste relue).
  useEffect(() => {
    if (!surbrillance || gestes.ouvert || serie) return;
    const minuterie = window.setTimeout(() => document.querySelector(`[data-tache="${surbrillance}"]`)?.scrollIntoView({ block: "nearest" }), 60);
    return () => window.clearTimeout(minuterie);
  }, [surbrillance, gestes.ouvert, serie]);

  /* ── J'ai N minutes, Commencer, lots ─────────────────────────────── */

  useEffect(() => {
    if (minutes === null) return;
    let actif = true;
    const minuterie = window.setTimeout(() => {
      setChargementPlan(true);
      appelApi<PlanMinutes>(`/api/a-faire/minutes?m=${minutes}`)
        .then((lu) => actif && setPlan(lu))
        .catch((erreur: unknown) => actif && toast.error("Calcul impossible", { description: messageErreur(erreur) }))
        .finally(() => actif && setChargementPlan(false));
    }, 0);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [minutes, liste.genereLe]);

  function lancerSerie(titre: string, taches: TacheVue[]) {
    if (taches.length === 0) return;
    gestes.viderTraitees();
    setSerie({ titre, taches });
  }

  /** Défait CE classement (l'instant `le` rendu par « Tout classer »), jamais ceux des jours d'avant. */
  async function annulerLot(lot: LotVue, le: string) {
    try {
      const resultat = await envoyerJson<{ restaurees: number; nonDefaits: string[] }>(`/api/a-faire/lots/${encodeURIComponent(lot.cle)}/annuler`, "POST", { le });
      toast.success("Annulé", { description: resultat.nonDefaits.length ? `Ne se défait pas : ${resultat.nonDefaits.join(" ; ")}.` : `${pluriel(resultat.restaurees, "tâche revenue", "tâches revenues")}.` });
      void relire();
    } catch (erreur) {
      toast.error("Annulation impossible", { description: messageErreur(erreur) });
    }
  }

  async function toutClasser(lot: LotVue) {
    setLotEnCours(lot.cle);
    try {
      const resultat = await envoyerJson<ResultatLot>(`/api/a-faire/lots/${encodeURIComponent(lot.cle)}/classer`, "POST");
      toastAnnulable(pluriel(resultat.classees, "tâche classée", "tâches classées"), () => void annulerLot(lot, resultat.le), resultat.laissees ? `${pluriel(resultat.laissees, "contact a", "contacts ont")} un dossier : à revoir un par un.` : lot.libelle);
      relireApres();
    } catch (erreur) {
      toast.error("Classement impossible", { description: messageErreur(erreur) });
    } finally {
      setLotEnCours(null);
    }
  }

  async function revoirLot(lot: LotVue) {
    setLotEnCours(lot.cle);
    try {
      const { taches } = await appelApi<{ taches: TacheVue[] }>(`/api/a-faire/lots/${encodeURIComponent(lot.cle)}`);
      if (taches.length === 0) toast.info("Plus rien dans ce lot.");
      lancerSerie(lot.libelle, taches);
    } catch (erreur) {
      toast.error("Lot illisible", { description: messageErreur(erreur) });
    } finally {
      setLotEnCours(null);
    }
  }

  async function actualiser() {
    setActualisation(true);
    try {
      const resultat = await envoyerJson<{ nouvelles: number; cochees: number; liste: ListeTaches }>("/api/a-faire/detecter", "POST");
      remplacer(resultat.liste);
      const parties = [resultat.nouvelles ? pluriel(resultat.nouvelles, "nouvelle") : null, resultat.cochees ? `${pluriel(resultat.cochees, "cochée", "cochées")} par le CRM` : null].filter(Boolean);
      toast.success("Liste à jour", { description: parties.length ? parties.join(" · ") : "Rien de nouveau." });
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    } finally {
      setActualisation(false);
    }
  }

  const ligne = (tache: TacheVue) => <LigneTacheV2 key={tache.id} tache={tache} maintenant={maintenant} surbrillance={surbrillance === tache.id} occupe={occupees.has(tache.id)} actions={actions} />;
  const plusTardVisibles = plusTardTout ? plusTard : plusTard.slice(0, PLUS_TARD_VISIBLES);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-8 md:py-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
      <h1 className="sr-only">Aujourd&apos;hui</h1>

      <div className="flex flex-col gap-4">
        {horsLigne ? (
          <p role="status" className="flex min-h-11 items-center gap-2 rounded-[8px] border border-attention/60 bg-surface px-4 py-2 text-corps-tel text-attention-texte md:text-corps">
            <WifiOff size={18} aria-hidden /> Hors ligne : voici la dernière liste connue.
          </p>
        ) : null}

        {/* 1. Reprendre */}
        <BandeauReprendre serveur={reprendre} genereLe={initiale.genereLe} />

        {/* 2. Maintenant */}
        {blocs.maintenant ? (
          <>
            <CarteTache key={blocs.maintenant.id} tache={blocs.maintenant} maintenant={maintenant} occupe={occupees.has(blocs.maintenant.id)} actions={actions} onPasAFaire={(tache) => gestes.demanderReponse(tache, "pasAFaire")} />
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Commencer, ou le temps dont je dispose">
              <button type="button" onClick={() => lancerSerie(planActif ? `${libelleChoixMinutes(planActif.minutes)} · ${pluriel(vue.length, "tâche")}` : "Tâches à la suite", vue)} className={cn(BOUTON_SECONDAIRE, "gap-2")}>
                <Play size={18} aria-hidden /> Commencer
                <span className="text-texte-3">
                  · {pluriel(vue.length, "tâche")} · {dureeLisible(planActif ? planActif.utilisees : minutesAujourdhui)}
                </span>
              </button>
              {MINUTES_V2.map((m) => (
                <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(minutes === m ? null : m)} className={cn(BOUTON_SECONDAIRE, "px-3", minutes === m && "border-action bg-action-fond text-action-clair")}>
                  J&apos;ai {libelleChoixMinutes(m)}
                </button>
              ))}
            </div>
            {minutes !== null ? (
              <p role="status" aria-live="polite" className="text-corps-tel text-texte-2 md:text-corps">
                {!planActif ? (chargementPlan ? "Je regarde ce qui tient…" : "…") : planActif.taches.length === 0 ? `Rien ne tient en ${libelleChoixMinutes(minutes)}.` : `En ${libelleChoixMinutes(minutes)} : ${pluriel(vue.length, "tâche")}, environ ${dureeLisible(planActif.utilisees)}. La liste ne montre que celles-là.`}
              </p>
            ) : null}
          </>
        ) : (
          <section aria-label="Rien à faire" className="rounded-[11px] border border-trait bg-surface p-4">
            <p className="text-corps-tel text-texte md:text-corps">{planActif ? `Rien ne tient en ${libelleChoixMinutes(planActif.minutes)}.` : phraseVide(liste.demain)}</p>
            {planActif ? (
              <button type="button" onClick={() => setMinutes(null)} className={cn(BOUTON_SECONDAIRE, "mt-3")}>
                Tout voir
              </button>
            ) : null}
          </section>
        )}

        {/* 3. Ensuite */}
        <section aria-labelledby="ensuite-titre" className="flex flex-col gap-2">
          <div className="flex min-h-11 items-center justify-between gap-2 px-1">
            <h2 id="ensuite-titre" className={TITRE_BLOC}>
              Ensuite{blocs.ensuite.length ? <span className="text-texte-3"> · {blocs.ensuite.length + blocs.autres.length}</span> : null}
            </h2>
            <button type="button" onClick={() => void actualiser()} disabled={actualisation} title="Relire le CRM maintenant (sinon toutes les 15 minutes)" className={cn("flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-corps text-texte-3 hover:bg-surface hover:text-texte focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:opacity-50", TRANS_V2)}>
              <RefreshCw size={18} aria-hidden className={cn(actualisation && "animate-spin motion-reduce:animate-none")} /> Actualiser
            </button>
          </div>
          {blocs.ensuite.length ? (
            <ul className={CLASSE_LISTE_V2}>
              {blocs.ensuite.map(ligne)}
              {autresOuverts ? blocs.autres.map(ligne) : null}
            </ul>
          ) : (
            <p className="px-1 text-corps-tel text-texte-3 md:text-corps">{blocs.maintenant ? "Rien d'autre pour aujourd'hui." : "Rien de prévu."}</p>
          )}
          {blocs.autres.length > 0 && !autresOuverts ? (
            <button type="button" onClick={() => setAutresOuverts(true)} className={cn(BOUTON_SECONDAIRE, "self-start")}>
              {libelleVoirAutres(blocs.autres.length)}
            </button>
          ) : null}
          <AjoutTache
            onAjoutee={(tache) => {
              // Ajoutée pour plus tard : « Plus tard » s'ouvre, la tâche en surbrillance avec son jour.
              if (tache.statut === "PLUS_TARD") {
                setPlusTardOuvert(true);
                setPlusTardTout(true);
                gestes.setRetour({ id: tache.id, suivante: null });
              }
              relireApres();
            }}
          />
        </section>

        {/* 4. En lot */}
        {liste.lots.length ? (
          <section aria-labelledby="lots-titre" className="flex flex-col gap-2">
            <h2 id="lots-titre" className={cn(TITRE_BLOC, "px-1")}>
              En lot
            </h2>
            <ul className={CLASSE_LISTE_V2}>
              {liste.lots.map((lot) => (
                <li key={lot.cle} className="flex flex-col gap-2 border-t border-trait px-4 py-3 first:border-t-0 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-corps-tel font-medium text-texte md:text-corps">{lot.libelle}</span>
                    <span className="block text-petit text-texte-3">environ {dureeLisible(lot.dureeMin)} un par un</span>
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button type="button" disabled={lotEnCours === lot.cle} onClick={() => void toutClasser(lot)} className={BOUTON_SECONDAIRE}>
                      Tout classer
                    </button>
                    <button type="button" disabled={lotEnCours === lot.cle} onClick={() => void revoirLot(lot)} className={BOUTON_SECONDAIRE}>
                      Revoir un par un
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 5. Plus tard */}
        {plusTard.length ? (
          <section aria-labelledby="plus-tard-titre" className="flex flex-col gap-2">
            <button type="button" aria-expanded={plusTardOuvert} onClick={() => setPlusTardOuvert((o) => !o)} className={REPLI}>
              <span id="plus-tard-titre" className={TITRE_BLOC}>
                Plus tard <span className="text-texte-3">· {plusTard.length}</span>
              </span>
              <span className="text-corps text-texte-3">{plusTardOuvert ? "Replier" : "Voir"}</span>
            </button>
            {plusTardOuvert ? (
              <>
                <ul className={CLASSE_LISTE_V2}>{plusTardVisibles.map(ligne)}</ul>
                {plusTard.length > plusTardVisibles.length ? (
                  <button type="button" onClick={() => setPlusTardTout(true)} className={cn(BOUTON_SECONDAIRE, "self-start")}>
                    {libelleVoirAutres(plusTard.length - plusTardVisibles.length)}
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        {/* 6. Fait aujourd'hui */}
        {liste.faitAujourdhui.length ? (
          <section aria-labelledby="fait-titre" className="flex flex-col gap-2">
            <button type="button" aria-expanded={faitOuvert} onClick={() => setFaitOuvert((o) => !o)} className={REPLI}>
              <span id="fait-titre" className={TITRE_BLOC}>
                Fait aujourd&apos;hui <span className="text-texte-3">· {liste.faitAujourdhui.length}</span>
              </span>
              <span className="text-corps text-texte-3">{faitOuvert ? "Replier" : "Voir"}</span>
            </button>
            {faitOuvert ? (
              <ul className={CLASSE_LISTE_V2}>
                {liste.faitAujourdhui.map((tache) => (
                  <LigneFaiteV2 key={tache.id} tache={tache} />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* 7. Depuis ta dernière visite */}
      <aside className="mt-8 border-t border-trait pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
        <Journal initiale={journal} compact />
      </aside>

      <PanneauxRaccourcis gestes={gestes} maintenant={maintenant} relireApres={relireApres} />

      {serie ? (
        <ModeTaches
          titre={serie.titre}
          serie={serie.taches}
          restantes={restantes}
          maintenant={maintenant}
          occupe={restantes[0] ? occupees.has(restantes[0].id) : false}
          actions={actions}
          onPasser={(tache) => gestes.ajouterTraitee(tache.id)}
          onPasAFaire={(tache) => gestes.demanderReponse(tache, "pasAFaire")}
          onQuitter={() => {
            setSerie(null);
            void relire();
          }}
        />
      ) : null}
    </div>
  );
}
