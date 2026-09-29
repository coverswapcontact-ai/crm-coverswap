"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, CheckCheck, PhoneForwarded, Plus, RefreshCw, Search, WifiOff, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { LIBELLES_SOURCE_LEAD } from "@/lib/prospects/constantes";
import { LIBELLES_MOTIF_ARCHIVAGE, type ActionLeads, type MotifArchivage } from "@/lib/prospects/menage-constantes";
import type { LigneLead, ListeLeads, VueLeads } from "@/lib/prospects/leads";
import type { SimulationsSiteRecentes } from "@/lib/simulations/site";
import { SurLeSite } from "./SurLeSite";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, Pagination, TRANS } from "@/components/pilotage/ui";
import { LienParMail, type CibleLienMail } from "@/components/pilotage/espace/LienParMail";
import { cn } from "@/lib/utils";
import { NouveauContact } from "./NouveauContact";
import { PanneauEntrant } from "./PanneauEntrant";
import { pluriel } from "@/lib/commun/format";
import { ChoixMotif, Ligne } from "./LigneLead";
import { ModeAppels } from "./ModeAppels";

/* ── L'écran ───────────────────────────────────────────────────────── */

export default function EcranLeads({ initial, siteInitial, leadInitial, appelsInitial }: { initial: ListeLeads; siteInitial: SimulationsSiteRecentes; leadInitial: string | null; appelsInitial: boolean }) {
  const routeur = useRouter();
  const [donnees, setDonnees] = useState(initial);
  const [vue, setVue] = useState<VueLeads>("ACTIFS");
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
  // Mission 13 (lot 3) : les cases à cocher n'apparaissent qu'en mode sélection (archiver ou traiter plusieurs leads).
  const [modeSelection, setModeSelection] = useState(false);
  const [nouveau, setNouveau] = useState(false);
  const [modeAppels, setModeAppels] = useState(appelsInitial);
  const [passes, setPasses] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [motifGroupe, setMotifGroupe] = useState(false);
  const [enCours, setEnCours] = useState<Set<string>>(new Set());
  const [ouverture, setOuverture] = useState<string | null>(null);
  const [suite, setSuite] = useState<{ lead: LigneLead; suite: SuiteAppel; dossierId: string | null } | null>(null);
  // Mission 7 : le mail prend le relais du SMS après un appel (lien de son espace, « j'ai essayé de vous joindre »).
  const [lienMail, setLienMail] = useState<CibleLienMail | null>(null);
  const [totalAppels, setTotalAppels] = useState(() => initial.lignes.filter((lead) => lead.aAppeler && lead.priorite !== "A_ECARTER").length);
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

  // La file d'appels : les leads à appeler, dans l'ordre de la liste, sans les « à écarter » ni ceux qu'on vient de passer.
  const aAppeler = useMemo(() => donnees.lignes.filter((lead) => lead.aAppeler), [donnees.lignes]);
  const ecartes = donnees.lignes.filter((lead) => lead.priorite === "A_ECARTER" && lead.attendDepuis).length;
  const file = useMemo(
    () => aAppeler.filter((lead) => lead.priorite !== "A_ECARTER" && !passes.has(lead.id)).sort((a, b) => Number(b.simulation) - Number(a.simulation)),
    [aAppeler, passes]
  );

  function demarrerAppels() {
    setVue("ACTIFS");
    setSource(null);
    setRecherche("");
    setPasses(new Set());
    setTotalAppels(aAppeler.filter((lead) => lead.priorite !== "A_ECARTER").length);
    setModeAppels(true);
  }

  const INVERSE: Record<ActionLeads, ActionLeads> = { ARCHIVER: "RESTAURER", RESTAURER: "ARCHIVER", TRAITER: "REPRENDRE", REPRENDRE: "TRAITER" };

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
        TRAITER: `${qui} marqué${changes.length > 1 ? "s" : ""} comme traité${changes.length > 1 ? "s" : ""} : hors de la file d'appels`,
        REPRENDRE: `${qui} remis dans la file d'appels`,
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

  async function noterDansLaFile(lead: LigneLead, issue: IssueAppel, note: string, avecDossier: boolean) {
    try {
      // Intéressé + dossier : le dossier s'ouvre d'abord, l'appel et sa note s'écrivent dans SON histoire.
      const dossierId = lead.dossierId ?? (avecDossier ? await ouvrirDossier(lead, { rester: true }) : null);
      if (avecDossier && !dossierId) return;
      const { suite: resultat } = await envoyerJson<{ suite: SuiteAppel }>("/api/commercial/appels", "POST", { ...(dossierId ? { dossierId } : { leadId: lead.id }), issue, note });
      await rafraichir();
      // Un mail est prêt à relire (lien de son espace, « j'ai essayé de vous joindre ») : on le propose avant de passer au suivant.
      if (resultat.messagePropose) setSuite({ lead, suite: resultat, dossierId });
      else toast.success(resultat.resume);
    } catch (erreur) {
      toast.error("Appel non enregistré", { description: messageErreur(erreur) });
    }
  }

  useRetourFerme(Boolean(suite), () => setSuite(null));

  return (
    <div className={cn("mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8", selection.size > 0 && "pb-40 md:pb-28")}>
      <EnTetePage
        titre="Leads"
        sousTitre="Tout ce qui est entré et n'a pas encore de dossier. Le plus récent en haut."
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
          <p className="mb-4 flex items-center gap-2 rounded-[12px] border-[0.5px] border-[#EF9F27]/30 bg-[#EF9F27]/10 px-3.5 py-2.5 text-[12.5px] text-[#F5B454]">
            <WifiOff size={14} aria-hidden /> Hors ligne : voici la dernière liste connue. Appeler reste possible.
          </p>
        ) : null}
      </div>

      <button type="button" onClick={demarrerAppels} disabled={file.length === 0 && passes.size === 0} className={cn("flex h-14 w-full items-center justify-center gap-2.5 rounded-[14px] text-[16px] font-semibold disabled:bg-[#22262D] disabled:text-[#6B7280]", (file.length > 0 || passes.size > 0) && "bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5]", TRANS)}>
        <PhoneForwarded size={19} aria-hidden />
        {file.length > 0 || passes.size > 0 ? `Enchaîner les appels · ${donnees.compteurs.aAppeler} à appeler` : "Personne à appeler pour l'instant"}
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {([
          ["ACTIFS", `En cours · ${donnees.compteurs.actifs}`],
          ["SANS_SUITE", `Sans suite · ${donnees.compteurs.sansSuite}`],
          ["ARCHIVES", `Archivés · ${donnees.compteurs.archives}`],
        ] as const).map(([valeur, libelle]) => (
          <button key={valeur} type="button" aria-pressed={vue === valeur} onClick={() => setVue(valeur)} className={cn("h-11 sm:h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", vue === valeur ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
            {libelle}
          </button>
        ))}
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
          className={cn("h-11 sm:h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", modeSelection ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
        >
          {modeSelection ? "Fin de sélection" : "Sélectionner"}
        </button>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input value={recherche} onChange={(evenement) => setRecherche(evenement.target.value)} placeholder="Nom, téléphone, ville, campagne" aria-label="Rechercher un lead" className={cn(CLASSE_SAISIE, "h-11 sm:h-9 rounded-full pl-8 text-[13px]")} />
        </label>
      </div>

      {/* Mission 13 (B19) : ce qui s'est passé sur le site cette semaine, à côté des leads qui en viennent. */}
      {modeAppels ? null : <SurLeSite resume={siteInitial} onOuvrirLead={(id) => setOuvert(id)} />}

      {/* Le mode appels couvre tout l'écran : la liste se retire (une seule note par contact à l'écran). */}
      {modeAppels ? null : donnees.lignes.length === 0 ? (
        <div className="mt-8">
          <EtatVide titre={recherche || source ? "Aucun lead ne correspond" : vue === "ACTIFS" ? "Aucun lead en attente" : vue === "ARCHIVES" ? "Aucun lead archivé" : "Aucun lead sans suite"} texte={vue === "ACTIFS" && !recherche && !source ? "Les demandes Meta, du site et les contacts saisis à la main arrivent ici. Ceux qui ont un dossier sont dans Dossiers." : undefined} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {donnees.lignes.map((lead) => (
            <Ligne key={lead.id} lead={lead} maintenant={maintenant} selection={modeSelection} selectionne={selection.has(lead.id)} onSelection={() => basculer(lead.id)} onOuvrir={() => setOuvert(lead.id)} />
          ))}
        </ul>
      )}
      {modeAppels ? null : <Pagination total={donnees.total ?? donnees.lignes.length} page={page} onPage={(p) => setPageDemandee({ page: p, cle: cleFiltres })} />}

      {selection.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-3 pb-2 md:bottom-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-[14px] border-[0.5px] border-[#2A2D34] bg-[#22262D] p-2.5 shadow-lg shadow-black/40">
            <p className="px-1.5 text-[13.5px] font-medium text-[#F2F3F5]">
              {selection.size} sélectionné{selection.size > 1 ? "s" : ""}
            </p>
            <button type="button" onClick={() => setSelection(new Set(donnees.lignes.map((l) => l.id)))} className="h-11 sm:h-9 rounded-[10px] px-2.5 text-[12.5px] text-[#9CA3AF] hover:text-[#F2F3F5]">
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
                <>
                  <Bouton icone={<CheckCheck size={15} aria-hidden />} chargement={enCours.size > 0} onClick={() => void agir("TRAITER", [...selection])}>
                    Traités
                  </Bouton>
                  <Bouton variante="primaire" icone={<Archive size={15} aria-hidden />} onClick={() => setMotifGroupe(true)}>
                    Archiver
                  </Bouton>
                </>
              )}
              <button type="button" onClick={() => setSelection(new Set())} aria-label="Tout désélectionner" className="flex h-11 sm:h-9 w-11 sm:w-9 items-center justify-center rounded-[10px] text-[#9CA3AF] hover:bg-[#2A2F37]">
                <X size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PanneauEntrant
        id={ouvert}
        ligne={donnees.lignes.find((l) => l.id === ouvert) ?? null}
        onAction={(action, motif) => {
          const cible = donnees.lignes.find((l) => l.id === ouvert);
          if (cible) void agir(action, [cible.id], motif, cible.archiveMotif ? (Object.entries(LIBELLES_MOTIF_ARCHIVAGE).find(([, libelle]) => libelle === cible.archiveMotif)?.[0] as MotifArchivage | undefined) : undefined);
        }}
        onRecharger={rafraichir}
        onFermer={() => setOuvert(null)}
        onModifie={() => void rafraichir()}
      />

      <LienParMail cible={lienMail} onFermer={() => setLienMail(null)} onEnvoye={() => void rafraichir()} />

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
          onPasser={(id) => setPasses((actuels) => new Set(actuels).add(id))}
          onNote={noterDansLaFile}
          onDossier={(lead) => void ouvrirDossier(lead, { rester: true })}
        />
      ) : null}

      {suite ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[16px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-5">
            <p className="text-[16px] font-medium text-[#F2F3F5]">Appel noté</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#9CA3AF]">
              {suite.suite.messagePropose === "LIEN_ESPACE" ? `Un mail avec le lien de son espace est prêt pour ${suite.lead.prenom} : vous le relisez, vous l'envoyez.` : `Le mail « j'ai essayé de vous joindre » est prêt pour ${suite.lead.prenom} : vous le relisez, vous l'envoyez.`}
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => {
                  const { suite: resultat, lead } = suite;
                  setSuite(null);
                  if (resultat.messagePropose) setLienMail({ dossierId: resultat.dossierId, leadId: resultat.dossierId ? null : lead.id, code: resultat.messagePropose });
                }}
                className={cn("flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[#1D9E75] text-[15px] font-semibold text-[#06140F] hover:bg-[#5DCAA5]", TRANS)}
              >
                <Mail size={16} aria-hidden /> Relire le mail
              </button>
              <button type="button" onClick={() => setSuite(null)} className={cn("h-12 rounded-[12px] border-[0.5px] border-[#2A2D34] text-[15px] text-[#E5E7EB] hover:border-[#3A3E47]", TRANS)}>
                Plus tard · lead suivant
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
