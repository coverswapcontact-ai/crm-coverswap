"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, PhoneForwarded, Plus, RefreshCw, Search, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { LIBELLES_SOURCE_LEAD } from "@/lib/prospects/constantes";
import { LIBELLES_MOTIF_ARCHIVAGE, type ActionLeads, type MotifArchivage } from "@/lib/prospects/menage-constantes";
import type { LigneLead, ListeLeads, VueLeads } from "@/lib/prospects/leads";
import type { SimulationsSiteRecentes } from "@/lib/simulations/site";
import type { TravauxSiteRecents } from "@/lib/simulations/travaux-lecture";
import { SurLeSite } from "./SurLeSite";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { EVENEMENT_APPEL_TERMINE, EVENEMENT_LEADS_MODIFIES, type DetailAppelTermine } from "@/components/pilotage/evenements";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { LigneDuJour } from "@/components/pilotage/relances/FeuilleRelances";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, Pagination, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { NouveauContact } from "./NouveauContact";
import { PanneauEntrant } from "./PanneauEntrant";
import { jourSemaineHeure, pluriel } from "@/lib/commun/format";
import { ChoixMotif, Ligne } from "./LigneLead";
import { ModeAppels } from "./ModeAppels";

/* ── L'écran ───────────────────────────────────────────────────────── */

/** Les puces du haut : une liste à la fois (mission 14, partie 3). */
const VUES: { valeur: VueLeads; libelle: string }[] = [
  { valeur: "A_APPELER", libelle: "À appeler" },
  { valeur: "A_RAPPELER", libelle: "À rappeler" },
  { valeur: "SANS_SUITE", libelle: "Sans suite" },
  { valeur: "ARCHIVES", libelle: "Archivés" },
];

export default function EcranLeads({ initial, vueInitiale, siteInitial, travauxInitial, leadInitial, appelsInitial }: { initial: ListeLeads; vueInitiale: VueLeads; siteInitial: SimulationsSiteRecentes; travauxInitial: TravauxSiteRecents; leadInitial: string | null; appelsInitial: boolean }) {
  const routeur = useRouter();
  const [donnees, setDonnees] = useState(initial);
  const [vue, setVue] = useState<VueLeads>(vueInitiale);
  const [source, setSource] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [charge, setCharge] = useState(false);
  // Mission 13 (lot 6) : une page à la fois ; un filtre qui change ramène à la première (la clé des filtres change).
  const cleFiltres = `${vue}|${source ?? ""}|${recherche}`;
  const [pageDemandee, setPageDemandee] = useState({ page: initial.page ?? 1, cle: cleFiltres });
  const page = pageDemandee.cle === cleFiltres ? pageDemandee.page : 1;
  const [horsLigne, setHorsLigne] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [ouvert, setOuvert] = useState<string | null>(leadInitial);
  // Mission 13 (lot 3) : les cases à cocher n'apparaissent qu'en mode sélection (archiver ou restaurer plusieurs leads).
  const [modeSelection, setModeSelection] = useState(false);
  const [nouveau, setNouveau] = useState(false);
  const [modeAppels, setModeAppels] = useState(appelsInitial);
  const [passes, setPasses] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [motifGroupe, setMotifGroupe] = useState(false);
  const [enCours, setEnCours] = useState<Set<string>>(new Set());
  const [ouverture, setOuverture] = useState<string | null>(null);
  const [rappelEnCours, setRappelEnCours] = useState<string | null>(null);
  const [totalAppels, setTotalAppels] = useState(0);
  const filtres = useRef({ vue, source, recherche, page });

  const rafraichir = useCallback(async () => {
    const { vue: v, source: s, recherche: q, page: p } = filtres.current;
    setCharge(true);
    try {
      const parametres = new URLSearchParams({ vue: v, page: String(p), ...(s ? { source: s } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
      setDonnees(await appelApi<ListeLeads>(`/api/leads?${parametres}`));
      setHorsLigne(vientDuCache());
      setMaintenant(Date.now());
      rafraichirCompteurs();
    } catch (erreur) {
      if (erreur instanceof ErreurApi) toast.error(messageErreur(erreur));
      else setHorsLigne(true);
    } finally {
      setCharge(false);
    }
  }, []);

  const [vueSuivie, setVueSuivie] = useState(vue);
  if (vueSuivie !== vue) {
    setVueSuivie(vue);
    setSelection(new Set());
    setMotifGroupe(false);
  }

  useEffect(() => {
    filtres.current = { vue, source, recherche, page };
    const minuterie = window.setTimeout(() => void rafraichir(), recherche ? 250 : 0);
    return () => window.clearTimeout(minuterie);
  }, [vue, source, recherche, page, rafraichir]);

  // Un lead arrive pendant que l'écran est ouvert : il apparaît tout seul. L'horloge de l'attente tourne chaque demi-minute.
  useEffect(() => {
    const surRetour = () => document.visibilityState === "visible" && void rafraichir();
    const horloge = window.setInterval(() => setMaintenant(Date.now()), 30_000);
    const releve = window.setInterval(surRetour, 60_000);
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("online", surRetour);
    const oublier = ecouterLeCache(() => setHorsLigne(true));
    return () => {
      window.clearInterval(horloge);
      window.clearInterval(releve);
      document.removeEventListener("visibilitychange", surRetour);
      window.removeEventListener("online", surRetour);
      oublier();
    };
  }, [rafraichir]);

  // Mission 14 (partie 4) : la feuille de fin d'appel a écrit (la liste se recharge) ; un appel de la file est fini,
  // SMS compris (la file passe au lead suivant : il n'est plus gardé en tête).
  useEffect(() => {
    const surModification = () => void rafraichir();
    const surAppelTermine = (evenement: Event) => {
      const leadId = (evenement as CustomEvent<DetailAppelTermine>).detail?.leadId;
      if (leadId) setPasses((actuels) => new Set(actuels).add(leadId));
    };
    window.addEventListener(EVENEMENT_LEADS_MODIFIES, surModification);
    window.addEventListener(EVENEMENT_APPEL_TERMINE, surAppelTermine);
    return () => {
      window.removeEventListener(EVENEMENT_LEADS_MODIFIES, surModification);
      window.removeEventListener(EVENEMENT_APPEL_TERMINE, surAppelTermine);
    };
  }, [rafraichir]);

  // La file d'appels (mission 14) : les lignes de la page affichée — sur « À appeler », les jamais appelés sans les « à
  // écarter » (les simulations d'abord) ; sur « À rappeler », les rappels en retard, dans l'ordre de la liste. Ni ceux qu'on vient de passer.
  const aRappelerSeulement = vue === "A_RAPPELER";
  const ecartes = vue === "A_APPELER" ? donnees.lignes.filter((lead) => lead.aAppeler && lead.priorite === "A_ECARTER").length : 0;
  const aEnchainer = useMemo(
    () =>
      vue === "A_RAPPELER"
        ? donnees.lignes.filter((lead) => lead.enRetard)
        : vue === "A_APPELER"
          ? donnees.lignes.filter((lead) => lead.aAppeler && lead.priorite !== "A_ECARTER").sort((a, b) => Number(b.simulation) - Number(a.simulation))
          : [],
    [vue, donnees.lignes]
  );
  const vivante = useMemo(() => aEnchainer.filter((lead) => !passes.has(lead.id)), [aEnchainer, passes]);
  // Mission 14 (partie 3) : une note d'appel compte comme un appel (le lead passe dans « À rappeler » dès qu'elle est
  // enregistrée). Le lead affiché dans « Appels à la suite » y reste pourtant en tête jusqu'à son issue ou « Passer »,
  // même si un rafraîchissement (retour du téléphone, relevé de la minute) l'a retiré de la liste entre-temps.
  const [affiche, setAffiche] = useState<LigneLead | null>(null);
  const file = useMemo(() => {
    if (!modeAppels || !affiche || passes.has(affiche.id)) return vivante;
    return [vivante.find((lead) => lead.id === affiche.id) ?? affiche, ...vivante.filter((lead) => lead.id !== affiche.id)];
  }, [modeAppels, affiche, passes, vivante]);
  if (modeAppels && (file[0]?.id ?? null) !== (affiche?.id ?? null)) setAffiche(file[0] ?? null);
  const passer = (id: string) => setPasses((actuels) => new Set(actuels).add(id));

  function demarrerAppels() {
    setAffiche(null);
    setPasses(new Set());
    setTotalAppels(aEnchainer.length);
    setModeAppels(true);
  }

  /** La date de rappel changée d'un geste sur la ligne (effacée : « Sans date »). */
  async function deplacerRappel(lead: LigneLead, rappelLe: string | null) {
    setRappelEnCours(lead.id);
    try {
      await envoyerJson(`/api/prospects/entrants/${lead.id}`, "PATCH", { rappelLe });
      toast.success(rappelLe ? `Rappel déplacé au ${jourSemaineHeure(rappelLe)}` : "Rappel sans date", {
        description: rappelLe ? lead.nom : lead.dernierAppelLe || lead.dernierContactLe ? `${lead.nom} reste dans « À rappeler », après les rappels datés.` : `${lead.nom}, jamais appelé, revient dans « À appeler ».`,
      });
      await rafraichir();
    } catch (erreur) {
      toast.error("Rappel non modifié", { description: messageErreur(erreur) });
    } finally {
      setRappelEnCours(null);
    }
  }

  const INVERSE: Record<ActionLeads, ActionLeads> = { ARCHIVER: "RESTAURER", RESTAURER: "ARCHIVER" };

  async function executer(action: ActionLeads, ids: string[], motif?: MotifArchivage): Promise<string[]> {
    const { ids: changes } = await envoyerJson<{ ids: string[] }>("/api/leads/actions", "POST", { action, ids, ...(motif ? { motif } : {}) });
    return changes;
  }

  /** Une action rapide, puis « Annuler » quelques secondes : l'action inverse, sur les mêmes leads. */
  async function agir(action: ActionLeads, ids: string[], motif?: MotifArchivage, motifAnnulation?: MotifArchivage) {
    setEnCours((actuels) => new Set([...actuels, ...ids]));
    try {
      const changes = await executer(action, ids, motif);
      setSelection((actuelle) => new Set([...actuelle].filter((id) => !changes.includes(id))));
      await rafraichir();
      if (changes.length === 0) {
        toast.info("Rien à changer : déjà fait.");
        return;
      }
      const qui = changes.length === 1 ? (donnees.lignes.find((l) => l.id === changes[0])?.nom ?? "Lead") : `${changes.length} leads`;
      const messages: Record<ActionLeads, string> = {
        ARCHIVER: `${qui} archivé${changes.length > 1 ? "s" : ""}${motif ? ` · ${LIBELLES_MOTIF_ARCHIVAGE[motif]}` : ""}`,
        RESTAURER: `${qui} restauré${changes.length > 1 ? "s" : ""}`,
      };
      toast.success(messages[action], {
        duration: 7000,
        action: {
          label: "Annuler",
          onClick: () => {
            void executer(INVERSE[action], changes, INVERSE[action] === "ARCHIVER" ? (motifAnnulation ?? "AUTRE") : undefined)
              .then(() => rafraichir())
              .then(() => toast.success("Annulé"))
              .catch((erreur) => toast.error("Annulation impossible", { description: messageErreur(erreur) }));
          },
        },
      });
    } catch (erreur) {
      toast.error("Action impossible", { description: messageErreur(erreur) });
    } finally {
      setEnCours((actuels) => new Set([...actuels].filter((id) => !ids.includes(id))));
    }
  }

  function basculer(id: string) {
    setSelection((actuelle) => {
      const suivante = new Set(actuelle);
      if (suivante.has(id)) suivante.delete(id);
      else suivante.add(id);
      return suivante;
    });
  }

  /**
   * Mission 25 (lot 6) — « Archiver les anciens leads » : le nombre exact d'abord (dans le bouton et la confirmation),
   * puis l'archivage d'un geste, motif « Ancien lead, avant la campagne du 25/09 », et « Annuler » quelques secondes.
   */
  const [archivageAnciens, setArchivageAnciens] = useState(false);
  async function archiverAnciens() {
    const nombre = donnees.compteurs.anciens ?? 0;
    if (!nombre) return;
    if (!window.confirm(`Archiver ${pluriel(nombre, "lead reçu", "leads reçus")} avant le 25/09/2026 et jamais appelé${nombre > 1 ? "s" : ""} ?

Motif : « Ancien lead, avant la campagne du 25/09 ». C'est réversible : ils restent dans « Archivés », disponibles pour une campagne de réactivation.`)) return;
    setArchivageAnciens(true);
    try {
      const { ids } = await envoyerJson<{ ids: string[] }>("/api/leads/anciens", "POST");
      await rafraichir();
      toast.success(`${pluriel(ids.length, "ancien lead archivé", "anciens leads archivés")}`, {
        duration: 10_000,
        action: {
          label: "Annuler",
          onClick: () => {
            // 200 leads au plus par action : la restauration se fait par paquets.
            const paquets = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
            void paquets
              .reduce((suite, paquet) => suite.then(() => executer("RESTAURER", paquet).then(() => undefined)), Promise.resolve())
              .then(() => rafraichir())
              .then(() => toast.success("Annulé : les anciens leads sont revenus dans « À appeler »"))
              .catch((erreur) => toast.error("Annulation impossible", { description: messageErreur(erreur) }));
          },
        },
      });
    } catch (erreur) {
      toast.error("Archivage impossible", { description: messageErreur(erreur) });
    } finally {
      setArchivageAnciens(false);
    }
  }

  async function ouvrirDossier(lead: LigneLead, options: { rester?: boolean } = {}): Promise<string | null> {
    setOuverture(lead.id);
    try {
      const resultat = await envoyerJson<{ dossierId: string; cree: boolean; photosRangees: number; simulationsRangees: number }>(`/api/leads/${lead.id}/dossier`, "POST");
      const rangees = resultat.photosRangees + resultat.simulationsRangees;
      toast.success(resultat.cree ? `Dossier ouvert pour ${lead.nom}` : `${lead.nom} avait déjà un dossier`, { description: rangees > 0 ? `${pluriel(rangees, "image rangée", "images rangées")} dans ses photos.` : "Coordonnées, projet et réponses repris." });
      if (options.rester) await rafraichir();
      else routeur.push(`/dossiers?dossier=${resultat.dossierId}`);
      return resultat.dossierId;
    } catch (erreur) {
      toast.error("Dossier non ouvert", { description: messageErreur(erreur) });
      return null;
    } finally {
      setOuverture(null);
    }
  }

  return (
    <div className={cn("mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8", selection.size > 0 && "pb-40 md:pb-28")}>
      <EnTetePage
        titre="Leads"
        sousTitre="Jamais appelés d'un côté, à rappeler de l'autre. Un lead en sort vers un dossier, sans suite ou archivé."
        actions={
          <>
            <Bouton icone={<Plus size={15} aria-hidden />} onClick={() => setNouveau(true)}>
              Nouveau
            </Bouton>
            <Bouton variante="fantome" taille="icone" aria-label="Rafraîchir" chargement={charge} onClick={() => void rafraichir()}>
              <RefreshCw size={15} aria-hidden />
            </Bouton>
          </>
        }
      />

      <div className="mt-5">
        <NotificationsAppareil application="crm" />
        {horsLigne ? (
          <p className="mb-4 flex items-center gap-2 rounded-[12px] border-[0.5px] border-attention/30 bg-attention/10 px-3.5 py-2.5 text-[12.5px] text-attention-texte">
            <WifiOff size={14} aria-hidden /> Hors ligne : voici la dernière liste connue. Appeler reste possible.
          </p>
        ) : null}
      </div>

      {vue === "A_APPELER" || vue === "A_RAPPELER" ? (
        <button type="button" onClick={demarrerAppels} disabled={aEnchainer.length === 0} className={cn("flex h-14 w-full items-center justify-center gap-2.5 rounded-[14px] px-3 text-[16px] font-semibold disabled:bg-surface-2 disabled:text-texte-3", aEnchainer.length > 0 && "bg-action text-action-texte hover:bg-action-clair", TRANS)}>
          <PhoneForwarded size={19} aria-hidden className="shrink-0" />
          <span className="truncate">{aEnchainer.length > 0 ? `Enchaîner les appels · ${aEnchainer.length} ${aRappelerSeulement ? "en retard" : "à appeler"}` : aRappelerSeulement ? "Aucun rappel en retard sur cette page" : "Personne à appeler sur cette page"}</span>
        </button>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {VUES.map(({ valeur, libelle }) => {
          const nombre = { A_APPELER: donnees.compteurs.aAppeler, A_RAPPELER: donnees.compteurs.aRappeler, SANS_SUITE: donnees.compteurs.sansSuite, ARCHIVES: donnees.compteurs.archives }[valeur] ?? 0;
          const retards = valeur === "A_RAPPELER" ? (donnees.compteurs.enRetard ?? 0) : 0;
          return (
            <button key={valeur} type="button" aria-pressed={vue === valeur} onClick={() => setVue(valeur)} className={cn("h-11 sm:h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", vue === valeur ? "border-action/60 bg-action/15 text-action-clair" : "border-trait text-texte-3 hover:text-texte", TRANS)}>
              {libelle} · {nombre}
              {retards > 0 ? <span className="font-medium text-retard-texte"> dont {retards} en retard</span> : null}
            </button>
          );
        })}
        {donnees.sources.length > 1 ? (
          <select value={source ?? ""} onChange={(evenement) => setSource(evenement.target.value || null)} aria-label="Source" className={cn(CLASSE_SAISIE, "h-11 sm:h-9 w-auto max-w-[14rem] rounded-full py-0 text-[13px]")}>
            <option value="">Toutes les sources</option>
            {donnees.sources.map((valeur) => (
              <option key={valeur} value={valeur}>
                {LIBELLES_SOURCE_LEAD[valeur] ?? valeur}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          aria-pressed={modeSelection}
          onClick={() => {
            setModeSelection((mode) => !mode);
            setSelection(new Set());
          }}
          className={cn("h-11 sm:h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", modeSelection ? "border-action/60 bg-action/15 text-action-clair" : "border-trait text-texte-3 hover:text-texte", TRANS)}
        >
          {modeSelection ? "Fin de sélection" : "Sélectionner"}
        </button>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-texte-3" />
          <input value={recherche} onChange={(evenement) => setRecherche(evenement.target.value)} placeholder="Nom, téléphone, ville, campagne" aria-label="Rechercher un lead" className={cn(CLASSE_SAISIE, "h-11 sm:h-9 rounded-full pl-8 text-[13px]")} />
        </label>
      </div>

      {/* Mission 14 (partie 7) : les nombres du jour — rappels (→ « À rappeler ») et relances (mission 25 : celles de la messagerie). */}
      {modeAppels ? null : <LigneDuJour aujourdhui={donnees.compteurs.aujourdhui ?? 0} enRetard={donnees.compteurs.enRetard ?? 0} onRappels={() => setVue("A_RAPPELER")} />}

      {/* Mission 25 (lot 6) : les leads d'avant la campagne du 25/09, encore « À appeler » : le nombre, puis le bouton. */}
      {!modeAppels && vue === "A_APPELER" && (donnees.compteurs.anciens ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] border-[0.5px] border-trait bg-surface px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-[13px] text-texte-2">
            {pluriel(donnees.compteurs.anciens ?? 0, "lead reçu", "leads reçus")} avant le 25/09 dans « À appeler ».
          </p>
          <Bouton icone={<Archive size={15} aria-hidden />} chargement={archivageAnciens} onClick={() => void archiverAnciens()}>
            Archiver les anciens leads ({donnees.compteurs.anciens})
          </Bouton>
        </div>
      ) : null}

      {/* Mission 13 (B19) : ce qui s'est passé sur le site cette semaine, à côté des leads qui en viennent. */}
      {modeAppels ? null : <SurLeSite resume={siteInitial} travaux={travauxInitial} onOuvrirLead={(id) => setOuvert(id)} />}

      {/* Le mode appels couvre tout l'écran : la liste se retire (une seule note par contact à l'écran). */}
      {modeAppels ? null : donnees.lignes.length === 0 ? (
        <div className="mt-8">
          <EtatVide
            titre={recherche || source ? "Aucun lead ne correspond" : vue === "A_APPELER" ? "Personne à appeler" : vue === "A_RAPPELER" ? "Aucun rappel" : vue === "ARCHIVES" ? "Aucun lead archivé" : "Aucun lead sans suite"}
            texte={recherche || source ? undefined : vue === "A_APPELER" ? "Les demandes Meta, du site et les contacts saisis à la main arrivent ici tant qu'ils n'ont pas été appelés. Ceux qui ont un dossier sont dans Dossiers." : vue === "A_RAPPELER" ? "Un lead appelé arrive ici, avec sa date de rappel ; il en sort vers un dossier, sans suite ou archivé." : undefined}
          />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-[12px] border-[0.5px] border-trait bg-surface">
          {donnees.lignes.map((lead) => (
            <Ligne
              key={lead.id}
              lead={lead}
              maintenant={maintenant}
              selection={modeSelection}
              selectionne={selection.has(lead.id)}
              onSelection={() => basculer(lead.id)}
              onOuvrir={() => setOuvert(lead.id)}
              onRappel={vue === "A_RAPPELER" ? (rappelLe) => void deplacerRappel(lead, rappelLe) : undefined}
              rappelEnCours={rappelEnCours === lead.id}
            />
          ))}
        </ul>
      )}
      {modeAppels ? null : <Pagination total={donnees.total ?? donnees.lignes.length} page={page} onPage={(p) => setPageDemandee({ page: p, cle: cleFiltres })} />}

      {selection.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-3 pb-2 md:bottom-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-[14px] border-[0.5px] border-trait bg-surface-2 p-2.5 shadow-lg shadow-black/40">
            <p className="px-1.5 text-[13.5px] font-medium text-texte">
              {selection.size} sélectionné{selection.size > 1 ? "s" : ""}
            </p>
            <button type="button" onClick={() => setSelection(new Set(donnees.lignes.map((l) => l.id)))} className="h-11 sm:h-9 rounded-[10px] px-2.5 text-[12.5px] text-texte-3 hover:text-texte">
              Tout ({donnees.lignes.length})
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {vue === "ARCHIVES" ? (
                <Bouton variante="primaire" icone={<ArchiveRestore size={15} aria-hidden />} chargement={enCours.size > 0} onClick={() => void agir("RESTAURER", [...selection])}>
                  Restaurer
                </Bouton>
              ) : motifGroupe ? (
                <ChoixMotif
                  occupe={enCours.size > 0}
                  onAnnuler={() => setMotifGroupe(false)}
                  onChoisir={(motif) => {
                    setMotifGroupe(false);
                    void agir("ARCHIVER", [...selection], motif);
                  }}
                />
              ) : (
                <Bouton variante="primaire" icone={<Archive size={15} aria-hidden />} onClick={() => setMotifGroupe(true)}>
                  Archiver
                </Bouton>
              )}
              <button type="button" onClick={() => setSelection(new Set())} aria-label="Tout désélectionner" className="flex h-11 sm:h-9 w-11 sm:w-9 items-center justify-center rounded-[10px] text-texte-3 hover:bg-surface-2">
                <X size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PanneauEntrant
        id={ouvert}
        ligne={donnees.lignes.find((l) => l.id === ouvert) ?? null}
        onRecharger={rafraichir}
        onFermer={() => setOuvert(null)}
        onModifie={() => void rafraichir()}
      />

      {nouveau ? (
        <NouveauContact
          onFermer={() => setNouveau(false)}
          onCree={(id) => {
            setNouveau(false);
            setOuvert(id);
            void rafraichir();
          }}
        />
      ) : null}

      {modeAppels ? (
        <ModeAppels
          file={file}
          total={Math.max(totalAppels, file.length)}
          ecartes={ecartes}
          maintenant={maintenant}
          occupe={ouverture !== null}
          onQuitter={() => setModeAppels(false)}
          onPasser={passer}
          // Comme avant : son dossier ouvert, il quitte la file.
          onDossier={(lead) => void ouvrirDossier(lead, { rester: true }).then((dossierId) => dossierId && passer(lead.id))}
        />
      ) : null}
    </div>
  );
}
