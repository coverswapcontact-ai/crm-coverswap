"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ListChecks, Play, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import type { DemandeEcranSms } from "@/components/pilotage/sms/EcranSms";
import { ouvrirEcranSms } from "@/components/pilotage/sms/EcranSms";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { EVENEMENT_APPEL_TERMINE, EVENEMENT_COMPTEURS, EVENEMENT_LEADS_MODIFIES } from "@/components/pilotage/evenements";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { RelectureMail } from "@/components/pilotage/relances/FeuilleRelances";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, EnTetePage, TRANS } from "@/components/pilotage/ui";
import { PanneauDossier, type DemandeOuverture } from "@/app/(pilotage)/dossiers/_components/PanneauDossier";
import { PanneauEntrant } from "@/app/(pilotage)/leads/_components/PanneauEntrant";
import { PanneauMail } from "@/app/(pilotage)/mail/_components/PanneauMail";
import { estRubriqueDossier } from "@/lib/dossiers/constants";
import { pluriel } from "@/lib/commun/format";
import type { EntreeReponse, ResultatAnnulation, ResultatLot, ResultatReponse } from "@/lib/a-faire/reponses";
import { LIBELLES_RAISON_PAS_A_FAIRE, type GroupeMinutes, type ListeTaches, type LotVue, type PlanMinutes, type RaisonPasAFaire, type TacheVue } from "@/lib/a-faire/types";
import { libelleCommencer, momentLisible, nomDuTitre, sousTitreTaches, texteDemain } from "@/lib/a-faire/affichage";
import { cn } from "@/lib/utils";
import { AjoutTache } from "./AjoutTache";
import { FeuilleDateChantier } from "./FeuilleDateChantier";
import { FeuilleReponse, type EtapeReponse } from "./FeuilleReponse";
import { LigneFaite, LigneTache, estSensible, propositionDe, raccourciDe, valideDansLaLigne, type ActionsLigne } from "./LigneTache";
import { Minutes } from "./Minutes";
import { ModeTaches } from "./ModeTaches";

/**
 * Mission 17 (partie A) — l'écran Tâches : une seule liste de ce que Lucas a à faire (docs/TACHES.md).
 *
 * Rendue d'emblée par le serveur ; relue ensuite aux gestes (`pilotage:compteurs`, `leads:modifies`, fin d'appel), au
 * retour sur l'onglet et toutes les 20 s tant que l'écran est visible. Le bouton principal d'une ligne FAIT l'action
 * (appel, SMS, mail, fil de l'espace, devis, encaissement, date du chantier…), sur place ; après, la liste revient au
 * même endroit, la tâche suivante en surbrillance. Trois réponses : Fait, Plus tard, Pas à faire — chacune annulable
 * 5 s (« Annuler » dans le message).
 *
 * Mission 17 (partie A, relecture) : une proposition sensible (argent ou client) ne se valide jamais d'ici — « Fait »,
 * le balayage et le bouton principal ouvrent son aperçu (relecture du mail, ou « À valider » sur la proposition) ;
 * « Annuler » d'un « Tout classer » ne défait que ce classement-là (son instant `le`).
 */

type Ouvert =
  | { vue: "DOSSIER"; dossierId: string; demande: DemandeOuverture | null }
  | { vue: "MAIL"; messageId: string }
  | { vue: "LEAD"; leadId: string }
  | { vue: "RELANCE"; propositionId: string; dossierId: string }
  | { vue: "PLANIFIER"; dossierId: string };

type Serie = { titre: string; taches: TacheVue[] };
type Retour = { id: string; suivante: string | null };

const CLE_POSITION = "taches:position";
const RELEVE_MS = 20_000;
/** Le moteur repasse 3 s après un geste (coche du CRM) : l'écran se relit encore un peu après. */
const RELECTURE_APRES_MS = 4_500;

const ajouter = (ensemble: Set<string>, id: string) => new Set(ensemble).add(id);
const retirer = (ensemble: Set<string>, id: string) => {
  const suivant = new Set(ensemble);
  suivant.delete(id);
  return suivant;
};

/** Encore à faire (dans « Aujourd'hui », ou « Plus tard » sans être reportée) : ce qu'un masquage cache. */
function ouvertes(liste: ListeTaches): Set<string> {
  return new Set([...liste.aujourdhui, ...liste.plusTard.filter((t) => t.statut === "A_FAIRE")].map((t) => t.id));
}

function commencer(id: string): void {
  // La mesure du temps réel : sans attendre, sans bruit (ni compteurs relus, ni message en cas d'échec).
  void fetch(`/api/a-faire/${id}/commencer`, { method: "POST", keepalive: true }).catch(() => undefined);
}

function messageReponse(tache: TacheVue, entree: EntreeReponse, apres: TacheVue | null, maintenant: number): string {
  if (entree.reponse === "FAIT") return valideDansLaLigne(tache) ? "Validé" : "Fait";
  if (entree.reponse === "PLUS_TARD") return apres?.plusTardJusqua ? `Plus tard · revient ${momentLisible(apres.plusTardJusqua, new Date(maintenant))}` : "Plus tard";
  if (tache.type === "VALIDER" && entree.raison === "PAS_PERTINENT") return "Ignoré";
  const raison = entree.raison && entree.raison in LIBELLES_RAISON_PAS_A_FAIRE ? LIBELLES_RAISON_PAS_A_FAIRE[entree.raison as RaisonPasAFaire].toLowerCase() : null;
  return raison ? `Pas à faire · ${raison}` : "Pas à faire";
}

function Section({ titre, nombre, children, action }: { titre: string; nombre?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <h2 className="text-[12px] font-medium tracking-wide text-texte-3 uppercase">
          {titre}
          {nombre !== undefined ? <span className="tabular-nums"> · {nombre}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionRepliee({ titre, nombre, ouverte, onBasculer, children }: { titre: string; nombre: number; ouverte: boolean; onBasculer: () => void; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <button type="button" aria-expanded={ouverte} onClick={onBasculer} className={cn("-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center gap-2 rounded-[10px] px-2 text-left hover:bg-surface pointer-fine:min-h-9", TRANS)}>
        <span className="text-[12px] font-medium tracking-wide text-texte-3 uppercase">
          {titre} <span className="tabular-nums">· {nombre}</span>
        </span>
        <span className="flex-1" />
        <ChevronDown size={15} aria-hidden className={cn("shrink-0 text-texte-3 transition-transform", ouverte && "rotate-180")} />
      </button>
      {ouverte ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}

const CLASSE_LISTE = "overflow-hidden rounded-[12px] border-[0.5px] border-trait bg-surface";
/** Les boutons communs (32 px dès sm) : 44 px au doigt à toutes les largeurs, compacts pour un pointeur fin. */
const CLASSE_BOUTON_DOIGT = "sm:h-11 pointer-fine:h-8";

export default function EcranTaches({ initiale }: { initiale: ListeTaches }) {
  const routeur = useRouter();
  const [liste, setListe] = useState(initiale);
  // L'heure de la liste servie : le premier rendu est le même au serveur et au navigateur.
  const [maintenant, setMaintenant] = useState(() => Date.parse(initiale.genereLe));
  const [horsLigne, setHorsLigne] = useState(false);
  const [masquees, setMasquees] = useState<Set<string>>(new Set());
  const [occupees, setOccupees] = useState<Set<string>>(new Set());
  const [retour, setRetour] = useState<Retour | null>(null);
  const [reponse, setReponse] = useState<{ tache: TacheVue; etape: EtapeReponse; cle: number } | null>(null);
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const [serie, setSerie] = useState<Serie | null>(null);
  const [traitees, setTraitees] = useState<Set<string>>(new Set());
  const [plusTardOuvert, setPlusTardOuvert] = useState(false);
  const [faitOuvert, setFaitOuvert] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanMinutes | null>(null);
  const [chargementPlan, setChargementPlan] = useState(false);
  const [actualisation, setActualisation] = useState(false);
  const [lotEnCours, setLotEnCours] = useState<string | null>(null);

  /* ── Relire la liste ─────────────────────────────────────────────── */

  const enVol = useRef<Promise<void> | null>(null);
  const encore = useRef(false);
  const relire = useCallback((): Promise<void> => {
    if (enVol.current) {
      encore.current = true;
      return enVol.current;
    }
    const tour = (async () => {
      try {
        do {
          encore.current = false;
          const lue = await appelApi<ListeTaches>("/api/a-faire");
          const encoreOuvertes = ouvertes(lue);
          setListe(lue);
          // Une réponse partie : sa tâche reste cachée tant qu'une liste lue avant elle la montre encore.
          setMasquees((actuelles) => (actuelles.size ? new Set([...actuelles].filter((id) => encoreOuvertes.has(id))) : actuelles));
          setHorsLigne(vientDuCache());
          setMaintenant(Date.now());
        } while (encore.current);
      } catch (erreur) {
        if (!(erreur instanceof ErreurApi)) setHorsLigne(true);
      } finally {
        enVol.current = null;
      }
    })();
    enVol.current = tour;
    return tour;
  }, []);

  const minuteries = useRef<number[]>([]);
  const relireApres = useCallback(() => {
    void relire();
    minuteries.current.push(window.setTimeout(() => void relire(), RELECTURE_APRES_MS));
  }, [relire]);

  useEffect(() => {
    let rafale = 0;
    const bientot = () => {
      window.clearTimeout(rafale);
      rafale = window.setTimeout(() => void relire(), 200);
    };
    const surVisibilite = () => {
      if (document.visibilityState === "visible") bientot();
    };
    const releve = window.setInterval(() => {
      if (document.visibilityState === "visible") void relire();
    }, RELEVE_MS);
    const apresAppel = () => relireApres();
    window.addEventListener(EVENEMENT_COMPTEURS, bientot);
    window.addEventListener(EVENEMENT_LEADS_MODIFIES, bientot);
    window.addEventListener(EVENEMENT_APPEL_TERMINE, apresAppel);
    window.addEventListener("online", bientot);
    document.addEventListener("visibilitychange", surVisibilite);
    const oublier = ecouterLeCache(() => setHorsLigne(true));
    const enAttente = minuteries.current;
    return () => {
      window.clearTimeout(rafale);
      window.clearInterval(releve);
      for (const m of enAttente) window.clearTimeout(m);
      window.removeEventListener(EVENEMENT_COMPTEURS, bientot);
      window.removeEventListener(EVENEMENT_LEADS_MODIFIES, bientot);
      window.removeEventListener(EVENEMENT_APPEL_TERMINE, apresAppel);
      window.removeEventListener("online", bientot);
      document.removeEventListener("visibilitychange", surVisibilite);
      oublier();
    };
  }, [relire, relireApres]);

  /* ── Ce qui s'affiche ────────────────────────────────────────────── */

  const aujourdhui = useMemo(() => liste.aujourdhui.filter((t) => !masquees.has(t.id)), [liste.aujourdhui, masquees]);
  const plusTard = useMemo(() => liste.plusTard.filter((t) => !(masquees.has(t.id) && t.statut === "A_FAIRE")), [liste.plusTard, masquees]);
  const minutesAujourdhui = aujourdhui.reduce((s, t) => s + t.dureeMin, 0);
  const ordre = useMemo(() => [...aujourdhui, ...plusTard].map((t) => t.id), [aujourdhui, plusTard]);
  const fermees = useMemo(() => new Set([...liste.faitAujourdhui.map((t) => t.id), ...liste.plusTard.filter((t) => t.statut === "PLUS_TARD" && t.plusTardJusqua && Date.parse(t.plusTardJusqua) > maintenant).map((t) => t.id)]), [liste, maintenant]);
  const restantes = useMemo(() => (serie ? serie.taches.filter((t) => !traitees.has(t.id) && !fermees.has(t.id)) : []), [serie, traitees, fermees]);
  // La surbrillance : la tâche d'où l'on revient si elle est encore là, sinon la suivante.
  const surbrillance = retour ? (ordre.includes(retour.id) ? retour.id : retour.suivante && ordre.includes(retour.suivante) ? retour.suivante : null) : null;

  const suivanteDe = (id: string) => {
    const rang = ordre.indexOf(id);
    return rang >= 0 ? (ordre.slice(rang + 1)[0] ?? null) : null;
  };

  /* ── Revenir au même endroit ─────────────────────────────────────── */

  function noterRetour(tache: TacheVue) {
    const position = { id: tache.id, suivante: suivanteDe(tache.id), y: window.scrollY };
    setRetour({ id: position.id, suivante: position.suivante });
    try {
      sessionStorage.setItem(CLE_POSITION, JSON.stringify(position));
    } catch {
      // stockage indisponible : la surbrillance reste, pas le défilement après une navigation
    }
  }

  // Retour d'un écran quitté par un raccourci (simulateur, page du CRM) : le défilement et la surbrillance reviennent.
  useEffect(() => {
    const minuterie = window.setTimeout(() => {
      let position: (Retour & { y: number }) | null = null;
      try {
        position = JSON.parse(sessionStorage.getItem(CLE_POSITION) ?? "null") as (Retour & { y: number }) | null;
        sessionStorage.removeItem(CLE_POSITION);
      } catch {
        position = null;
      }
      if (!position?.id) return;
      setRetour({ id: position.id, suivante: position.suivante ?? null });
      window.scrollTo({ top: Number(position.y) || 0 });
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, []);

  // La tâche en surbrillance reste à l'écran (le panneau refermé, la liste relue).
  useEffect(() => {
    if (!surbrillance || ouvert || serie) return;
    const minuterie = window.setTimeout(() => document.querySelector(`[data-tache="${surbrillance}"]`)?.scrollIntoView({ block: "nearest" }), 60);
    return () => window.clearTimeout(minuterie);
  }, [surbrillance, ouvert, serie]);

  /* ── Répondre ────────────────────────────────────────────────────── */

  async function annuler(tache: TacheVue) {
    try {
      const resultat = await envoyerJson<ResultatAnnulation>(`/api/a-faire/${tache.id}/annuler`, "POST");
      setMasquees((m) => retirer(m, tache.id));
      setTraitees((t) => retirer(t, tache.id));
      toast.success("Annulé", { description: resultat.nonDefaits.length ? `Ne se défait pas : ${resultat.nonDefaits.join(" ; ")}.` : tache.titre });
      void relire();
    } catch (erreur) {
      toast.error("Annulation impossible", { description: messageErreur(erreur) });
    }
  }

  async function repondre(tache: TacheVue, entree: EntreeReponse) {
    setReponse(null);
    const suivante = suivanteDe(tache.id);
    setOccupees((o) => ajouter(o, tache.id));
    setMasquees((m) => ajouter(m, tache.id));
    setTraitees((t) => ajouter(t, tache.id));
    try {
      const resultat = await envoyerJson<ResultatReponse>(`/api/a-faire/${tache.id}/reponse`, "POST", entree);
      setRetour({ id: tache.id, suivante });
      toast.success(messageReponse(tache, entree, resultat.tache, Date.now()), {
        description: tache.titre,
        duration: 5000,
        action: { label: "Annuler", onClick: () => void annuler(tache) },
      });
      if (resultat.regle?.creee) toast.info("Une règle est proposée", { description: "La même raison revient souvent : elle attend ta décision dans « À valider »." });
      relireApres();
    } catch (erreur) {
      setMasquees((m) => retirer(m, tache.id));
      setTraitees((t) => retirer(t, tache.id));
      const propositionId = propositionDe(tache);
      if (erreur instanceof ErreurApi && erreur.status === 409 && propositionId) {
        toast.error("À valider avec son aperçu", { description: messageErreur(erreur), action: { label: "Ouvrir", onClick: () => routeur.push(`/validation?proposition=${encodeURIComponent(propositionId)}`) } });
      } else {
        toast.error("Réponse non enregistrée", { description: messageErreur(erreur) });
      }
    } finally {
      setOccupees((o) => retirer(o, tache.id));
    }
  }

  const demanderReponse = (tache: TacheVue, etape: EtapeReponse) => setReponse({ tache, etape, cle: Date.now() });

  /* ── Les raccourcis : l'action, sur place ───────────────────────── */

  const fermerRaccourci = useCallback(() => {
    setOuvert(null);
    relireApres();
  }, [relireApres]);
  const rien = useCallback(() => undefined, []);
  const dateMaintenant = useMemo(() => new Date(maintenant), [maintenant]);

  async function corriger(tache: TacheVue): Promise<void> {
    const cle = tache.raccourci.cleCoherence;
    if (!cle) return ouvrirFiche(tache);
    setOccupees((o) => ajouter(o, tache.id));
    try {
      const resultat = await envoyerJson<{ corrigee: boolean; message: string }>("/api/coherence/corriger", "POST", { cle });
      if (resultat.corrigee) toast.success("Corrigé", { description: resultat.message });
      else toast.info(resultat.message);
      relireApres();
    } catch (erreur) {
      toast.error("Correction impossible", { description: messageErreur(erreur) });
    } finally {
      setOccupees((o) => retirer(o, tache.id));
    }
  }

  function aller(href: string) {
    if (/^https?:\/\//.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else routeur.push(href);
  }

  /** La fiche de la tâche (le toucher de la ligne) : le dossier, le contact, le mail ; sinon l'action elle-même. */
  function ouvrirFiche(tache: TacheVue): void {
    const r = raccourciDe(tache);
    const dossierId = r.dossierId ?? tache.dossierId;
    const leadId = r.leadId ?? tache.leadId;
    if (r.genre === "MAIL" || r.genre === "ESPACE" || r.genre === "DOSSIER" || r.genre === "DEVIS" || r.genre === "ENCAISSER" || r.genre === "LEAD") return lancer(tache);
    noterRetour(tache);
    if (dossierId) setOuvert({ vue: "DOSSIER", dossierId, demande: null });
    else if (leadId) setOuvert({ vue: "LEAD", leadId });
    else if (r.href && r.genre !== "APPEL") aller(r.href);
    else demanderReponse(tache, "choix");
  }

  function lancer(tache: TacheVue): void {
    const r = raccourciDe(tache);
    const dossierId = r.dossierId ?? tache.dossierId;
    const leadId = r.leadId ?? tache.leadId;
    const messageId = r.messageId ?? (Array.isArray(tache.donnees.messageIds) && typeof tache.donnees.messageIds[0] === "string" ? tache.donnees.messageIds[0] : null);
    const dossier = (demande: Omit<DemandeOuverture, "cle"> | null): void => (dossierId ? setOuvert({ vue: "DOSSIER", dossierId, demande: demande ? { ...demande, cle: Date.now() } : null }) : ouvrirFiche(tache));
    commencer(tache.id);
    noterRetour(tache);
    switch (r.genre) {
      case "APPEL":
        // Sans numéro lisible : la fiche (le numéro s'y corrige).
        return ouvrirFiche(tache);
      case "SMS":
        if (!r.sms) return ouvrirFiche(tache);
        return ouvrirEcranSms({ demande: r.sms as DemandeEcranSms, onFini: ({ copie }) => copie && relireApres() });
      case "MAIL":
        if (messageId) return setOuvert({ vue: "MAIL", messageId });
        return r.href ? aller(r.href) : ouvrirFiche(tache);
      case "ESPACE":
        return dossier({ rubrique: "messages" });
      case "DOSSIER":
        return dossier(estRubriqueDossier(r.rubrique) ? { rubrique: r.rubrique } : null);
      case "DEVIS":
        // Mission 18 (B3) : « gmail » — la modale de dépôt préremplie avec le PDF parti de Gmail.
        if (r.devis === "gmail" && r.pieceId) return dossier({ rubrique: "devis", devis: "gmail", piece: r.pieceId });
        return dossier({ rubrique: "devis", devis: r.devis === "pdf" ? "pdf" : "nouveau" });
      case "ENCAISSER":
        return dossier({ rubrique: "encaisser" });
      case "SIMULATEUR":
        return aller(r.href ?? (dossierId ? `/simulateur?dossier=${dossierId}` : "/simulateur"));
      case "RELANCE_MAIL":
        if (r.propositionId && dossierId) return setOuvert({ vue: "RELANCE", propositionId: r.propositionId, dossierId });
        // Sans dossier : la proposition, ouverte dans « À valider ».
        if (r.propositionId) return aller(`/validation?proposition=${encodeURIComponent(r.propositionId)}`);
        return ouvrirFiche(tache);
      case "PLANIFIER":
        if (dossierId) return setOuvert({ vue: "PLANIFIER", dossierId });
        return ouvrirFiche(tache);
      case "VALIDER":
        // Garde : raccourciDe a déjà changé une proposition sensible en « Relire et valider ».
        return estSensible(tache) ? undefined : void repondre(tache, { reponse: "FAIT" });
      case "LEAD":
        if (leadId) return setOuvert({ vue: "LEAD", leadId });
        return r.href ? aller(r.href) : demanderReponse(tache, "choix");
      case "COHERENCE":
        return void corriger(tache);
      case "PAGE":
        // Une page externe s'ouvre par son lien (nouvel onglet) ; une page du CRM ici.
        if (r.href && !r.externe) aller(r.href);
        return;
    }
  }

  function appeler(tache: TacheVue) {
    const dossierId = tache.raccourci.dossierId ?? tache.dossierId;
    const leadId = tache.raccourci.leadId ?? tache.leadId;
    commencer(tache.id);
    noterRetour(tache);
    // La fin d'appel à 4 boutons revient au retour dans l'application ; `depuisFile` : pas de « Suivant » des Leads.
    if (leadId || dossierId) noterDebutAppel(leadId ?? `dossier:${dossierId}`, { nom: nomDuTitre(tache.titre), dossierId, depuisFile: true });
  }

  const actions: ActionsLigne = {
    onPrincipal: lancer,
    onAppel: appeler,
    onOuvrir: ouvrirFiche,
    onMenu: (tache) => demanderReponse(tache, "choix"),
    // Une proposition sensible : « Fait » (balayage, mode Commencer) ouvre son aperçu, rien ne se valide d'un geste.
    onFait: (tache) => (estSensible(tache) ? lancer(tache) : void repondre(tache, { reponse: "FAIT" })),
    onPlusTard: (tache) => demanderReponse(tache, "plusTard"),
    onIgnorer: (tache) => void repondre(tache, { reponse: "PAS_A_FAIRE", raison: "PAS_PERTINENT" }),
  };

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
    setTraitees(new Set());
    setSerie({ titre, taches });
  }

  function lancerGroupe(groupe: GroupeMinutes | null) {
    if (!plan) return;
    const taches = groupe ? plan.taches.filter((t) => groupe.ids.includes(t.id)) : plan.taches;
    lancerSerie(groupe ? groupe.libelle : `${minutes === 60 ? "1 h" : `${minutes} min`} · ${pluriel(plan.taches.length, "tâche")}`, taches);
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
      toast.success(pluriel(resultat.classees, "tâche classée", "tâches classées"), {
        description: resultat.laissees ? `${pluriel(resultat.laissees, "contact a", "contacts ont")} un dossier : à revoir un par un.` : lot.libelle,
        duration: 5000,
        action: { label: "Annuler", onClick: () => void annulerLot(lot, resultat.le) },
      });
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
      setListe(resultat.liste);
      setMaintenant(Date.now());
      const parties = [resultat.nouvelles ? pluriel(resultat.nouvelles, "nouvelle") : null, resultat.cochees ? `${pluriel(resultat.cochees, "cochée", "cochées")} par le CRM` : null].filter(Boolean);
      toast.success("Liste à jour", { description: parties.length ? parties.join(" · ") : "Rien de nouveau." });
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    } finally {
      setActualisation(false);
    }
  }

  const toutTraite = aujourdhui.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Tâches"
        sousTitre={sousTitreTaches({ aujourdhui: aujourdhui.length, minutesAujourdhui })}
        actions={
          <Bouton variante="fantome" className={CLASSE_BOUTON_DOIGT} icone={<RefreshCw size={15} aria-hidden />} chargement={actualisation} onClick={() => void actualiser()} title="Relire le CRM maintenant (sinon toutes les 15 minutes)">
            Actualiser
          </Bouton>
        }
      />

      {horsLigne ? (
        <p className="mt-4 flex items-center gap-2 rounded-[12px] border-[0.5px] border-attention/30 bg-attention/10 px-3.5 py-2.5 text-[12.5px] text-attention-texte">
          <WifiOff size={14} aria-hidden /> Hors ligne : voici la dernière liste connue.
        </p>
      ) : null}

      <AjoutTache
        onAjoutee={(tache) => {
          // Ajoutée pour plus tard : « Plus tard » s'ouvre, la tâche en surbrillance avec son jour.
          if (tache.statut === "PLUS_TARD") {
            setPlusTardOuvert(true);
            setRetour({ id: tache.id, suivante: null });
          }
          relireApres();
        }}
      />

      {toutTraite ? null : (
        <>
          <Minutes choisies={minutes} plan={plan} chargement={chargementPlan} onChoisir={setMinutes} onLancer={lancerGroupe} />
          <button type="button" onClick={() => lancerSerie("Tâches à la suite", aujourdhui)} className={cn("mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-[14px] bg-action px-3 text-[16px] font-semibold text-action-texte hover:bg-action-clair", TRANS)}>
            <Play size={18} aria-hidden className="shrink-0" />
            <span className="truncate">{libelleCommencer(aujourdhui.length, minutesAujourdhui)}</span>
          </button>
        </>
      )}

      {toutTraite ? (
        <section className="mt-6 rounded-[12px] border-[0.5px] border-trait bg-surface px-5 py-8 text-center">
          <CheckCircle2 size={28} aria-hidden className="mx-auto text-action-clair" />
          <h2 className="mt-3 text-[18px] font-medium tracking-tight text-texte">Tout est traité</h2>
          <p className="mt-1 text-[13.5px] text-texte-3">{texteDemain(liste.demain)}</p>
        </section>
      ) : (
        <Section titre="Aujourd'hui" nombre={aujourdhui.length}>
          <ul className={CLASSE_LISTE}>
            {aujourdhui.map((tache) => (
              <LigneTache key={tache.id} tache={tache} maintenant={maintenant} surbrillance={surbrillance === tache.id} occupe={occupees.has(tache.id)} actions={actions} />
            ))}
          </ul>
        </Section>
      )}

      {toutTraite ? (
        <Section titre="Fait aujourd'hui" nombre={liste.faitAujourdhui.length}>
          {liste.faitAujourdhui.length ? (
            <ul className={CLASSE_LISTE}>
              {liste.faitAujourdhui.map((tache) => (
                <LigneFaite key={tache.id} tache={tache} />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[13px] text-texte-3">Rien encore aujourd&apos;hui.</p>
          )}
        </Section>
      ) : null}

      {liste.lots.length ? (
        <Section titre="En lot">
          <ul className={CLASSE_LISTE}>
            {liste.lots.map((lot) => (
              <li key={lot.cle} className="flex flex-col gap-2 border-t-[0.5px] border-trait px-3.5 py-3 first:border-t-0 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-texte">{lot.libelle}</span>
                  <span className="block text-[12.5px] text-texte-3 tabular-nums">environ {lot.dureeMin >= 60 ? `${Math.round(lot.dureeMin / 60)} h` : `${lot.dureeMin} min`} un par un</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Bouton variante="secondaire" className={CLASSE_BOUTON_DOIGT} chargement={lotEnCours === lot.cle} onClick={() => void toutClasser(lot)}>
                    Tout classer
                  </Bouton>
                  <Bouton variante="fantome" className={CLASSE_BOUTON_DOIGT} disabled={lotEnCours === lot.cle} onClick={() => void revoirLot(lot)}>
                    Revoir un par un
                  </Bouton>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {plusTard.length ? (
        <SectionRepliee titre="Plus tard" nombre={plusTard.length} ouverte={plusTardOuvert} onBasculer={() => setPlusTardOuvert((o) => !o)}>
          <ul className={CLASSE_LISTE}>
            {plusTard.map((tache) => (
              <LigneTache key={tache.id} tache={tache} maintenant={maintenant} surbrillance={surbrillance === tache.id} occupe={occupees.has(tache.id)} actions={actions} />
            ))}
          </ul>
        </SectionRepliee>
      ) : null}

      {!toutTraite && liste.faitAujourdhui.length ? (
        <SectionRepliee titre="Fait aujourd'hui" nombre={liste.faitAujourdhui.length} ouverte={faitOuvert} onBasculer={() => setFaitOuvert((o) => !o)}>
          <ul className={CLASSE_LISTE}>
            {liste.faitAujourdhui.map((tache) => (
              <LigneFaite key={tache.id} tache={tache} />
            ))}
          </ul>
        </SectionRepliee>
      ) : null}

      {!toutTraite && !liste.lots.length && !plusTard.length && !liste.faitAujourdhui.length ? (
        <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-texte-3">
          <ListChecks size={14} aria-hidden /> {texteDemain(liste.demain)}
        </p>
      ) : null}

      {/* Les raccourcis, sur place. */}
      <PanneauDossier dossierId={ouvert?.vue === "DOSSIER" ? ouvert.dossierId : null} maintenant={dateMaintenant} onFermer={fermerRaccourci} onMisAJour={rien} demande={ouvert?.vue === "DOSSIER" ? ouvert.demande : null} />
      <PanneauMail messageId={ouvert?.vue === "MAIL" ? ouvert.messageId : null} nouveauPour={null} repondre onFermer={fermerRaccourci} onChange={relireApres} />
      <PanneauEntrant id={ouvert?.vue === "LEAD" ? ouvert.leadId : null} onFermer={fermerRaccourci} onModifie={relireApres} />
      {ouvert?.vue === "RELANCE" ? (
<RelectureMail propositionId={ouvert.propositionId} dossierId={ouvert.dossierId} onFini={fermerRaccourci} />
      ) : null}
      <FeuilleDateChantier dossierId={ouvert?.vue === "PLANIFIER" ? ouvert.dossierId : null} onFini={fermerRaccourci} />

      {serie ? (
        <ModeTaches
          titre={serie.titre}
          serie={serie.taches}
          restantes={restantes}
          maintenant={maintenant}
          occupe={restantes[0] ? occupees.has(restantes[0].id) : false}
          actions={actions}
          onPasser={(tache) => setTraitees((t) => ajouter(t, tache.id))}
          onPasAFaire={(tache) => demanderReponse(tache, "pasAFaire")}
          onQuitter={() => {
            setSerie(null);
            void relire();
          }}
        />
      ) : null}

      <FeuilleReponse
        demande={reponse}
        maintenant={maintenant}
        occupe={reponse ? occupees.has(reponse.tache.id) : false}
        onFermer={() => setReponse(null)}
        onRepondre={(tache, entree) => void repondre(tache, entree)}
        onApercu={(tache) => {
          setReponse(null);
          lancer(tache);
        }}
      />
    </div>
  );
}
