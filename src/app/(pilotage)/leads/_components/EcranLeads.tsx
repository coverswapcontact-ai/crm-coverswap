"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FolderPlus, MessageSquare, Phone, PhoneCall, PhoneForwarded, Plus, RefreshCw, Search, SkipForward, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { LIBELLES_SOURCE_LEAD } from "@/lib/prospects/constantes";
import type { LigneLead, ListeLeads, VueLeads } from "@/lib/prospects/leads";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, TRANS } from "@/components/pilotage/ui";
import { FeuilleAppel } from "@/components/sms/FilConversation";
import { cn } from "@/lib/utils";
import { NouveauContact } from "../../prospects/_components/NouveauContact";
import { PanneauEntrant } from "../../prospects/_components/PanneauEntrant";
import { PastillePriorite } from "../../prospects/_components/pastilles";

/* ── Temps ─────────────────────────────────────────────────────────── */

function duree(depuis: string, maintenant: number): string {
  const minutes = Math.max(0, Math.round((maintenant - new Date(depuis).getTime()) / 60_000));
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  const jours = Math.floor(minutes / 1440);
  return `${jours} j`;
}

function heureArrivee(iso: string): string {
  const date = new Date(iso);
  const aujourdhui = new Date().toDateString() === date.toDateString();
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return aujourdhui ? `aujourd'hui ${heure}` : `${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ${heure}`;
}

/** Cinq minutes : l'objectif. Une heure : le lead refroidit. */
function tonAttente(depuis: string, maintenant: number): string {
  const minutes = (maintenant - new Date(depuis).getTime()) / 60_000;
  return minutes <= 5 ? "text-[#5DCAA5]" : minutes <= 60 ? "text-[#F5B454]" : "text-[#F87171]";
}

function Attente({ lead, maintenant }: { lead: LigneLead; maintenant: number }) {
  if (lead.attendDepuis) return <span className={cn("font-medium tabular-nums", tonAttente(lead.attendDepuis, maintenant))}>attend un appel depuis {duree(lead.attendDepuis, maintenant)}</span>;
  if (lead.rappelLe) {
    const echu = new Date(lead.rappelLe).getTime() <= maintenant;
    return <span className={echu ? "font-medium text-[#F87171]" : "text-[#9CA3AF]"}>{echu ? "rappel à faire depuis " + duree(lead.rappelLe, maintenant) : `rappel prévu ${heureArrivee(lead.rappelLe)}`}</span>;
  }
  if (lead.dernierAppel) return <span className="text-[#9CA3AF]">appelé il y a {duree(lead.dernierAppel.le, maintenant)}</span>;
  return null;
}

/* ── Une ligne ─────────────────────────────────────────────────────── */

function Reponses({ lead, toutes = false }: { lead: LigneLead; toutes?: boolean }) {
  const reponses = toutes ? lead.reponses : lead.reponses.slice(0, 4);
  if (reponses.length === 0 && !lead.message) return null;
  return (
    <div className="mt-2">
      {reponses.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {reponses.map((reponse) => (
            <li key={`${reponse.question}:${reponse.reponse}`} className="rounded-[6px] bg-[#22262D] px-2 py-[3px] text-[11.5px] leading-tight text-[#D1D5DB]">
              <span className="text-[#8B919C]">{reponse.question} : </span>
              {reponse.reponse}
            </li>
          ))}
        </ul>
      ) : null}
      {lead.message ? <p className={cn("mt-1.5 text-[12.5px] leading-snug text-[#9CA3AF]", !toutes && "line-clamp-2")}>« {lead.message} »</p> : null}
    </div>
  );
}

function Provenance({ lead }: { lead: LigneLead }) {
  return (
    <>
      {lead.libelleSource}
      {lead.campagne ? <span className="text-[#D1D5DB]"> · {lead.campagne}</span> : null}
    </>
  );
}

function Ligne({ lead, maintenant, occupe, onOuvrir, onAppelNote, onDossier }: { lead: LigneLead; maintenant: number; occupe: boolean; onOuvrir: () => void; onAppelNote: () => void; onDossier: () => void }) {
  return (
    <li className={cn("rounded-[14px] border-[0.5px] bg-[#1C1F25] p-3.5", lead.aAppeler ? "border-[#1D9E75]/35" : "border-[#2A2D34]")}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOuvrir} className="min-w-0 flex-1 text-left">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <PastillePriorite priorite={lead.priorite} motif={lead.prioriteMotif} />
            <span className="truncate text-[15px] font-medium text-[#F2F3F5]">{lead.nom}</span>
            {lead.smsNonLus > 0 ? <span className="rounded-full bg-[#1D9E75] px-1.5 text-[10.5px] leading-[17px] font-semibold text-[#06140F]">{lead.smsNonLus} SMS</span> : null}
          </p>
          <p className="mt-1 text-[12.5px] leading-snug text-[#8B919C]">
            {[lead.ville, lead.projet].filter(Boolean).join(" · ")}
            {lead.ville || lead.projet ? " · " : ""}
            <Provenance lead={lead} />
          </p>
          <p className="mt-1 text-[12.5px] leading-snug">
            <span className="text-[#8B919C]">Arrivé {heureArrivee(lead.recuLe)}</span>
            {lead.attendDepuis || lead.rappelLe || lead.dernierAppel ? <span className="text-[#4B5563]"> · </span> : null}
            <Attente lead={lead} maintenant={maintenant} />
          </p>
          <Reponses lead={lead} />
        </button>
        <ChevronRight size={16} aria-hidden className="mt-1 hidden shrink-0 text-[#4B5563] sm:block" />
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem] gap-2 sm:grid-cols-[minmax(0,15rem)_auto_auto_auto] sm:justify-start">
        {lead.telephoneLien ? (
          <a href={lead.telephoneLien} className={cn("flex h-12 items-center justify-center gap-2 rounded-[12px] px-3 text-[14.5px] font-semibold tabular-nums sm:h-10 sm:text-[13.5px]", lead.aAppeler ? "bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5]" : "bg-[#22262D] text-[#E5E7EB] hover:bg-[#2A2F37]", TRANS)}>
            <Phone size={16} aria-hidden /> {lead.telephone}
          </a>
        ) : (
          <span className="flex h-12 items-center justify-center rounded-[12px] bg-[#22262D] px-3 text-[12.5px] text-[#6B7280] sm:h-10">{lead.telephone ? `${lead.telephone} (illisible)` : "Pas de numéro"}</span>
        )}
        <button type="button" onClick={onAppelNote} aria-label={`Noter l'appel avec ${lead.nom}`} title="Noter l'appel" className={cn("flex h-12 items-center justify-center rounded-[12px] border-[0.5px] border-[#2A2D34] px-3 text-[#D1D5DB] hover:border-[#3A3E47] sm:h-10", TRANS)}>
          <PhoneCall size={16} aria-hidden />
        </button>
        <Link href={lead.conversationId ? `/sms?c=${lead.conversationId}` : `/sms?lead=${lead.id}`} aria-label={`Écrire à ${lead.nom}`} title="SMS" className={cn("flex h-12 items-center justify-center rounded-[12px] border-[0.5px] border-[#2A2D34] px-3 text-[#D1D5DB] hover:border-[#3A3E47] sm:h-10", TRANS)}>
          <MessageSquare size={16} aria-hidden />
        </Link>
        <button type="button" disabled={occupe} onClick={onDossier} aria-label={`Ouvrir le dossier de ${lead.nom}`} title="Ouvrir un dossier" className={cn("flex h-12 items-center justify-center gap-1.5 rounded-[12px] border-[0.5px] border-[#1D9E75]/45 px-3 text-[13px] font-medium text-[#5DCAA5] hover:bg-[#1D9E75]/10 disabled:opacity-50 sm:h-10", TRANS)}>
          <FolderPlus size={16} aria-hidden /> <span className="hidden sm:inline">{occupe ? "Ouverture…" : "Ouvrir un dossier"}</span>
        </button>
      </div>
    </li>
  );
}

/* ── Enchaîner les appels ──────────────────────────────────────────── */

function ModeAppels({ file, total, ecartes, maintenant, onQuitter, onPasser, onNote, onDossier, occupe }: { file: LigneLead[]; total: number; ecartes: number; maintenant: number; onQuitter: () => void; onPasser: (id: string) => void; onNote: (lead: LigneLead, issue: IssueAppel, note: string, ouvrirDossier: boolean) => Promise<void>; onDossier: (lead: LigneLead) => void; occupe: boolean }) {
  const lead = file[0] ?? null;
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [note, setNote] = useState("");
  const [avecDossier, setAvecDossier] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const idCourant = lead?.id ?? null;
  const [idSuivi, setIdSuivi] = useState(idCourant);
  if (idSuivi !== idCourant) {
    // Un nouveau lead s'affiche : la feuille repart vide.
    setIdSuivi(idCourant);
    setIssue(null);
    setNote("");
    setAvecDossier(true);
  }

  async function enregistrer() {
    if (!lead || !issue) return;
    setEnvoi(true);
    try {
      await onNote(lead, issue, note, issue === "INTERESSE" && avecDossier);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#16181D]">
      <header className="flex items-center justify-between gap-3 border-b-[0.5px] border-[#2A2D34] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="text-[15px] font-medium text-[#F2F3F5]">Appels à la suite</p>
          <p className="text-[12px] text-[#8B919C]">
            {file.length > 0 ? `${total - file.length + 1} sur ${total}` : "Terminé"}
            {ecartes > 0 ? ` · ${ecartes} « à écarter » laissé${ecartes > 1 ? "s" : ""} de côté` : ""}
          </p>
        </div>
        <Bouton variante="fantome" icone={<X size={16} aria-hidden />} onClick={onQuitter}>
          Quitter
        </Bouton>
      </header>

      {!lead ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-medium text-[#F2F3F5]">Plus personne à appeler</p>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-[#9CA3AF]">Tous les leads ont été appelés ou ont un rappel prévu. Les prochains arriveront ici, avec une notification.</p>
          <Bouton variante="primaire" onClick={onQuitter}>
            Revenir à la liste
          </Bouton>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-full max-w-xl">
              <p className="flex flex-wrap items-center gap-2">
                <PastillePriorite priorite={lead.priorite} motif={lead.prioriteMotif} />
                <span className="text-[12.5px]">
                  <Attente lead={lead} maintenant={maintenant} />
                </span>
              </p>
              <h2 className="mt-2 text-[24px] leading-tight font-semibold tracking-tight text-[#F2F3F5]">{lead.nom}</h2>
              <p className="mt-1 text-[13.5px] text-[#9CA3AF]">
                {[lead.ville, lead.codePostal].filter(Boolean).join(" ")}
                {lead.ville ? " · " : ""}
                {lead.projet}
              </p>
              <p className="mt-0.5 text-[13px] text-[#8B919C]">
                <Provenance lead={lead} /> · arrivé {heureArrivee(lead.recuLe)}
              </p>
              {lead.prioriteMotif ? <p className="mt-1 text-[12.5px] text-[#8B919C]">{lead.prioriteMotif}</p> : null}
              <Reponses lead={lead} toutes />
              {lead.dernierAppel ? <p className="mt-2 text-[12.5px] text-[#8B919C]">Dernier appel : {lead.dernierAppel.contenu}</p> : null}

              {lead.telephoneLien ? (
                <a href={lead.telephoneLien} className={cn("mt-5 flex h-16 items-center justify-center gap-3 rounded-[16px] bg-[#1D9E75] text-[19px] font-semibold tabular-nums text-[#06140F] active:bg-[#5DCAA5]", TRANS)}>
                  <Phone size={22} aria-hidden /> {lead.telephone}
                </a>
              ) : (
                <p className="mt-5 rounded-[14px] bg-[#22262D] px-4 py-4 text-center text-[14px] text-[#F5B454]">Numéro illisible{lead.telephone ? ` : ${lead.telephone}` : ""}. {lead.email ? `E-mail : ${lead.email}` : ""}</p>
              )}

              <p className="mt-6 mb-2 text-[12px] font-medium text-[#9CA3AF]">Issue de l&apos;appel</p>
              <div className="grid grid-cols-2 gap-2">
                {ISSUES_APPEL.map((valeur) => (
                  <button key={valeur} type="button" aria-pressed={issue === valeur} onClick={() => setIssue(valeur)} className={cn("h-14 rounded-[12px] border-[0.5px] text-[15px] font-medium", issue === valeur ? "border-[#1D9E75] bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#E5E7EB] hover:border-[#3A3E47]", TRANS)}>
                    {LIBELLES_ISSUE[valeur]}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={(evenement) => setNote(evenement.target.value)} rows={2} placeholder="En une ligne (facultatif) : cuisine de 2015, veut refaire les façades avant Noël" aria-label="Note de l'appel" className={cn(CLASSE_SAISIE, "mt-3 min-h-[64px] resize-y py-2 text-[15px] leading-relaxed sm:text-[13.5px]")} />
              {issue === "INTERESSE" ? (
                <label className="mt-3 flex items-start gap-2.5 text-[13.5px] leading-snug text-[#D1D5DB]">
                  <input type="checkbox" checked={avecDossier} onChange={(evenement) => setAvecDossier(evenement.target.checked)} className="mt-0.5 h-5 w-5 accent-[#1D9E75]" />
                  <span>
                    Ouvrir son dossier tout de suite
                    <span className="block text-[12px] text-[#8B919C]">Tout est repris ; il sort de Leads. Le SMS avec le lien de son espace sera proposé ensuite.</span>
                  </span>
                </label>
              ) : null}
              {issue === "PAS_DE_REPONSE" ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Rappel posé à demain 10 h ; le SMS « j&apos;ai essayé de vous joindre » vous sera proposé.</p> : null}
              {issue === "A_RAPPELER" ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Rappel posé à demain 10 h (modifiable depuis sa fiche).</p> : null}
            </div>
          </div>
          <footer className="border-t-[0.5px] border-[#2A2D34] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto grid w-full max-w-xl grid-cols-[auto_minmax(0,1fr)] gap-2">
              <button type="button" onClick={() => onPasser(lead.id)} className={cn("flex h-14 items-center justify-center gap-1.5 rounded-[14px] border-[0.5px] border-[#2A2D34] px-4 text-[14px] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
                <SkipForward size={16} aria-hidden /> Passer
              </button>
              <button type="button" disabled={!issue || envoi || occupe} onClick={() => void enregistrer()} className={cn("flex h-14 items-center justify-center gap-2 rounded-[14px] bg-[#1D9E75] text-[16px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-40", TRANS)}>
                {envoi ? "Enregistrement…" : "Enregistrer · suivant"}
              </button>
            </div>
            <button type="button" onClick={() => onDossier(lead)} disabled={occupe} className="mx-auto mt-2 flex items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline disabled:opacity-50">
              <FolderPlus size={13} aria-hidden /> Ouvrir son dossier sans noter d&apos;appel
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

/* ── L'écran ───────────────────────────────────────────────────────── */

export default function EcranLeads({ initial, leadInitial, appelsInitial }: { initial: ListeLeads; leadInitial: string | null; appelsInitial: boolean }) {
  const routeur = useRouter();
  const [donnees, setDonnees] = useState(initial);
  const [vue, setVue] = useState<VueLeads>("ACTIFS");
  const [source, setSource] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [charge, setCharge] = useState(false);
  const [horsLigne, setHorsLigne] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [ouvert, setOuvert] = useState<string | null>(leadInitial);
  const [feuilleAppel, setFeuilleAppel] = useState<LigneLead | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [modeAppels, setModeAppels] = useState(appelsInitial);
  const [passes, setPasses] = useState<Set<string>>(new Set());
  const [ouverture, setOuverture] = useState<string | null>(null);
  const [suite, setSuite] = useState<{ lead: LigneLead; suite: SuiteAppel; dossierId: string | null } | null>(null);
  const [totalAppels, setTotalAppels] = useState(() => initial.lignes.filter((lead) => lead.aAppeler && lead.priorite !== "A_ECARTER").length);
  const filtres = useRef({ vue, source, recherche });

  const rafraichir = useCallback(async () => {
    const { vue: v, source: s, recherche: q } = filtres.current;
    setCharge(true);
    try {
      const parametres = new URLSearchParams({ vue: v, ...(s ? { source: s } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
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

  useEffect(() => {
    filtres.current = { vue, source, recherche };
    const minuterie = window.setTimeout(() => void rafraichir(), recherche ? 250 : 0);
    return () => window.clearTimeout(minuterie);
  }, [vue, source, recherche, rafraichir]);

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
  const file = useMemo(() => aAppeler.filter((lead) => lead.priorite !== "A_ECARTER" && !passes.has(lead.id)), [aAppeler, passes]);

  function demarrerAppels() {
    setVue("ACTIFS");
    setSource(null);
    setRecherche("");
    setPasses(new Set());
    setTotalAppels(aAppeler.filter((lead) => lead.priorite !== "A_ECARTER").length);
    setModeAppels(true);
  }

  async function ouvrirDossier(lead: LigneLead, options: { rester?: boolean } = {}): Promise<string | null> {
    setOuverture(lead.id);
    try {
      const resultat = await envoyerJson<{ dossierId: string; cree: boolean; photosRangees: number; simulationsRangees: number }>(`/api/leads/${lead.id}/dossier`, "POST");
      const rangees = resultat.photosRangees + resultat.simulationsRangees;
      toast.success(resultat.cree ? `Dossier ouvert pour ${lead.nom}` : `${lead.nom} avait déjà un dossier`, { description: rangees > 0 ? `${rangees} image(s) rangée(s) dans ses photos.` : "Coordonnées, projet et réponses repris." });
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
      const dossierId = avecDossier ? await ouvrirDossier(lead, { rester: true }) : null;
      if (avecDossier && !dossierId) return;
      const { suite: resultat } = await envoyerJson<{ suite: SuiteAppel }>("/api/commercial/appels", "POST", { ...(dossierId ? { dossierId } : { leadId: lead.id }), issue, note });
      await rafraichir();
      // Un message est prêt à relire (lien de son espace, « j'ai essayé de vous joindre ») : on le propose avant de passer au suivant.
      if (resultat.messagePropose && lead.telephoneLien) setSuite({ lead, suite: resultat, dossierId });
      else toast.success(resultat.resume);
    } catch (erreur) {
      toast.error("Appel non enregistré", { description: messageErreur(erreur) });
    }
  }

  const lienMessage = suite ? `/sms?${suite.dossierId ? `dossier=${suite.dossierId}` : `lead=${suite.lead.id}`}&proposer=${suite.suite.messagePropose}&retour=appels` : "#";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
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
        ] as const).map(([valeur, libelle]) => (
          <button key={valeur} type="button" aria-pressed={vue === valeur} onClick={() => setVue(valeur)} className={cn("h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", vue === valeur ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
            {libelle}
          </button>
        ))}
        {donnees.sources.length > 1 ? (
          <select value={source ?? ""} onChange={(evenement) => setSource(evenement.target.value || null)} aria-label="Source" className={cn(CLASSE_SAISIE, "h-9 w-auto max-w-[14rem] rounded-full py-0 text-[13px]")}>
            <option value="">Toutes les sources</option>
            {donnees.sources.map((valeur) => (
              <option key={valeur} value={valeur}>
                {LIBELLES_SOURCE_LEAD[valeur] ?? valeur}
              </option>
            ))}
          </select>
        ) : null}
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input value={recherche} onChange={(evenement) => setRecherche(evenement.target.value)} placeholder="Nom, téléphone, ville, campagne" aria-label="Rechercher un lead" className={cn(CLASSE_SAISIE, "h-9 rounded-full pl-8 text-[13px]")} />
        </label>
      </div>

      {donnees.lignes.length === 0 ? (
        <div className="mt-8">
          <EtatVide titre={recherche || source ? "Aucun lead ne correspond" : vue === "ACTIFS" ? "Aucun lead en attente" : "Aucun lead sans suite"} texte={vue === "ACTIFS" && !recherche && !source ? "Les demandes Meta, du site et les contacts saisis à la main arrivent ici. Ceux qui ont un dossier sont dans Dossiers." : undefined} />
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {donnees.lignes.map((lead) => (
            <Ligne key={lead.id} lead={lead} maintenant={maintenant} occupe={ouverture === lead.id} onOuvrir={() => setOuvert(lead.id)} onAppelNote={() => setFeuilleAppel(lead)} onDossier={() => void ouvrirDossier(lead)} />
          ))}
        </ul>
      )}

      <PanneauEntrant id={ouvert} onFermer={() => setOuvert(null)} onModifie={() => void rafraichir()} />

      <FeuilleAppel
        ouverte={feuilleAppel !== null}
        leadId={feuilleAppel?.id ?? null}
        dossierId={null}
        onFermer={() => setFeuilleAppel(null)}
        onFait={(resultat) => {
          void rafraichir();
          if (resultat.messagePropose && feuilleAppel) routeur.push(`/sms?lead=${feuilleAppel.id}&proposer=${resultat.messagePropose}`);
        }}
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
              {suite.suite.messagePropose === "LIEN_ESPACE" ? `Un SMS avec le lien de son espace est prêt pour ${suite.lead.prenom} : vous le relisez, vous l'envoyez.` : `Le SMS « j'ai essayé de vous joindre » est prêt pour ${suite.lead.prenom} : vous le relisez, vous l'envoyez.`}
            </p>
            <div className="mt-4 grid gap-2">
              <Link href={lienMessage} className={cn("flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[#1D9E75] text-[15px] font-semibold text-[#06140F] hover:bg-[#5DCAA5]", TRANS)}>
                <MessageSquare size={16} aria-hidden /> Relire le SMS
              </Link>
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
