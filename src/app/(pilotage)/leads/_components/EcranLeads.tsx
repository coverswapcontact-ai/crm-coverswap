"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, CheckCheck, ChevronRight, FolderOpen, FolderPlus, Phone, PhoneForwarded, PhoneOff, Plus, RefreshCw, Search, SkipForward, Sparkles, WifiOff, X, Mail } from "lucide-react";
import { toast } from "sonner";
import { ISSUES_APPEL, LIBELLES_ISSUE, type IssueAppel, type SuiteAppel } from "@/lib/commercial/constantes";
import { LIBELLES_SOURCE_LEAD } from "@/lib/prospects/constantes";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { LIBELLES_MOTIF_ARCHIVAGE, MOTIFS_ARCHIVAGE, type ActionLeads, type MotifArchivage } from "@/lib/prospects/menage-constantes";
import type { LigneLead, ListeLeads, SimulationLead, VueLeads } from "@/lib/prospects/leads";
import type { SimulationsSiteRecentes } from "@/lib/simulations/site";
import { SurLeSite } from "./SurLeSite";
import { ErreurApi, appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { NotesAppel, finAppel, noterDebutAppel, type NotesAppelRef } from "@/components/pilotage/NotesAppel";
import { useGlisserPourFermer, useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { NotificationsAppareil } from "@/components/pilotage/NotificationsAppareil";
import { ecouterLeCache, vientDuCache } from "@/components/pilotage/serviDepuisLeCache";
import { Bouton, CLASSE_SAISIE, EnTetePage, EtatVide, TRANS } from "@/components/pilotage/ui";
import { LienParMail, type CibleLienMail } from "@/components/pilotage/espace/LienParMail";
import { cn } from "@/lib/utils";
import { NouveauContact } from "../../prospects/_components/NouveauContact";
import { PanneauEntrant } from "../../prospects/_components/PanneauEntrant";
import { PastillePriorite, PastilleSimulation } from "../../prospects/_components/pastilles";

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

/** Le motif en un geste : quatre boutons, un tap archive. */
function ChoixMotif({ onChoisir, onAnnuler, occupe }: { onChoisir: (motif: MotifArchivage) => void; onAnnuler: () => void; occupe: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Motif de l'archivage">
      <span className="mr-0.5 text-[12px] text-[#8B919C]">Archiver :</span>
      {MOTIFS_ARCHIVAGE.map((motif) => (
        <button key={motif} type="button" disabled={occupe} onClick={() => onChoisir(motif)} className={cn("h-9 rounded-full border-[0.5px] border-[#EF9F27]/45 px-3 text-[13px] text-[#F5B454] hover:bg-[#EF9F27]/15 disabled:opacity-50", TRANS)}>
          {LIBELLES_MOTIF_ARCHIVAGE[motif]}
        </button>
      ))}
      <button type="button" onClick={onAnnuler} aria-label="Ne pas archiver" className="flex h-9 w-9 items-center justify-center rounded-full text-[#8B919C] hover:bg-[#22262D]">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Mission 13 (lot 3) — une ligne par lead : pastille de priorité, nom · ville ·
 * source, le délai, UN bouton « Appeler » (44 px), chevron. Noter, écrire,
 * ouvrir le dossier, archiver, fusionner un doublon : dans le panneau, au toucher.
 */
function Ligne({ lead, maintenant, selection, selectionne, onSelection, onOuvrir }: { lead: LigneLead; maintenant: number; selection: boolean; selectionne: boolean; onSelection: () => void; onOuvrir: () => void }) {
  const archive = Boolean(lead.archiveLe);
  const priorite = lead.priorite && lead.priorite in LIBELLES_PRIORITE ? (lead.priorite as Priorite) : null;
  const couleur = priorite === "PRIORITAIRE" ? "bg-[#EF4444]" : priorite === "STANDARD" ? "bg-[#1D9E75]" : priorite === "A_ECARTER" ? "bg-[#EF9F27]" : priorite === "SECONDAIRE" ? "bg-[#6B7280]" : "bg-[#2A2D34]";
  return (
    <li className={cn("flex items-center border-t-[0.5px] border-[#2A2D34] first:border-t-0", selectionne && "bg-[#1D9E75]/[0.06]")}>
      {selection ? (
        <label className="flex h-14 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={selectionne} onChange={onSelection} aria-label={`Sélectionner ${lead.nom}`} className="h-[18px] w-[18px] accent-[#1D9E75]" />
        </label>
      ) : null}
      <button type="button" onClick={onOuvrir} className={cn("flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 text-left hover:bg-[#20232A] focus-visible:bg-[#20232A] focus-visible:outline-none", selection ? "pl-1" : "pl-3.5", TRANS)}>
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", couleur)} title={priorite ? `${LIBELLES_PRIORITE[priorite]}${lead.prioriteMotif ? ` — ${lead.prioriteMotif}` : ""}` : undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14.5px] font-medium text-[#F2F3F5]">{lead.nom}</span>
            {lead.simulation ? <Sparkles size={13} aria-label="Simulation faite sur le site" className="shrink-0 text-[#93C5FD]" /> : null}
            {lead.smsNonLus > 0 ? <span className="shrink-0 rounded-full bg-[#1D9E75] px-1.5 text-[10.5px] leading-[17px] font-semibold text-[#06140F]">{lead.smsNonLus} SMS</span> : null}
            {lead.doublon && !archive ? <span className="shrink-0 rounded-full border-[0.5px] border-[#EF9F27]/40 px-1.5 text-[10.5px] leading-[17px] text-[#F5B454]">Doublon ?</span> : null}
            {lead.traiteLe && !archive ? <span className="shrink-0 rounded-full border-[0.5px] border-[#2A2D34] px-1.5 text-[10.5px] leading-[17px] text-[#9CA3AF]">Traité</span> : null}
          </span>
          <span className="block truncate text-[12.5px] text-[#8B919C]">{[lead.ville, `${lead.libelleSource}${lead.campagne ? ` · ${lead.campagne}` : ""}`].filter(Boolean).join(" · ")}</span>
          <span className="block truncate text-[12.5px] text-[#8B919C]">
            {archive ? `Archivé le ${new Date(lead.archiveLe!).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}${lead.archiveMotif ? ` · ${lead.archiveMotif}` : ""}` : lead.attendDepuis || lead.rappelLe || lead.dernierAppel ? <Attente lead={lead} maintenant={maintenant} /> : `Arrivé ${heureArrivee(lead.recuLe)}`}
          </span>
        </span>
      </button>
      {archive ? null : lead.telephoneLien ? (
        <a href={lead.telephoneLien} onClick={() => noterDebutAppel(lead.id, { nom: lead.nom, dossierId: lead.dossierId })} aria-label={`Appeler ${lead.nom}`} title={lead.telephone ?? undefined} className={cn("mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full", lead.aAppeler ? "bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5]" : "bg-[#22262D] text-[#E5E7EB] hover:bg-[#2A2F37]", TRANS)}>
          <Phone size={18} aria-hidden />
        </a>
      ) : (
        <span className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-[#4B5563]" title="Pas de numéro">
          <PhoneOff size={16} aria-hidden />
        </span>
      )}
      <ChevronRight size={16} aria-hidden className="mr-3 shrink-0 text-[#4B5563]" />
    </li>
  );
}

/* ── Ses simulations, pour en parler pendant l'appel ─────────────────── */

function SesSimulations({ simulations, dossierId }: { simulations: SimulationLead[]; dossierId: string | null }) {
  const [ouverte, setOuverte] = useState<{ simulation: SimulationLead; vue: "apres" | "avant" } | null>(null);
  useRetourFerme(Boolean(ouverte), () => setOuverte(null));
  return (
    <div className="mt-4">
      <p className="mb-2 flex items-center justify-between text-[12px] font-medium text-[#9CA3AF]">
        Ce qu&apos;il a vu
        {dossierId ? (
          <a href={`/dossiers?dossier=${dossierId}`} target="_blank" rel="noopener" className="font-normal text-[#5DCAA5] hover:underline">
            Toutes les photos du dossier
          </a>
        ) : null}
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {simulations.map((simulation) => (
          <li key={simulation.id}>
            <button type="button" disabled={!simulation.apres && !simulation.avant} onClick={() => setOuverte({ simulation, vue: simulation.apres ? "apres" : "avant" })} className="block w-full text-left disabled:opacity-60">
              <span className="block aspect-[4/3] overflow-hidden rounded-[10px] border-[0.5px] border-[#2A2D34] bg-[#22262D]">
                {/* eslint-disable-next-line @next/next/no-img-element -- image protégée par la session, servie telle quelle */}
                {simulation.apres || simulation.avant ? <img src={simulation.apres ?? simulation.avant ?? ""} alt="Rendu de la simulation" loading="lazy" className="h-full w-full object-cover" /> : null}
              </span>
              <span className="mt-1 block truncate text-[11.5px] text-[#8B919C]">
                {[simulation.reference, simulation.prix ? `${Math.round(simulation.prix)} €` : null].filter(Boolean).join(" · ") || new Date(simulation.le).toLocaleDateString("fr-FR")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {ouverte ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/95" onClick={() => setOuverte(null)}>
          <div className="flex items-center justify-between gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2" onClick={(evenement) => evenement.stopPropagation()}>
            <div className="flex gap-1.5">
              {(["avant", "apres"] as const).map((vue) =>
                ouverte.simulation[vue] ? (
                  <button key={vue} type="button" aria-pressed={ouverte.vue === vue} onClick={() => setOuverte({ ...ouverte, vue })} className={cn("h-10 rounded-full px-4 text-[14px]", ouverte.vue === vue ? "bg-[#F2F3F5] text-[#16181D]" : "bg-white/10 text-[#E5E7EB]")}>
                    {vue === "avant" ? "Avant" : "Après"}
                  </button>
                ) : null
              )}
            </div>
            <button type="button" onClick={() => setOuverte(null)} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[#E5E7EB]">
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {/* eslint-disable-next-line @next/next/no-img-element -- image protégée par la session, servie telle quelle */}
            <img src={ouverte.simulation[ouverte.vue] ?? ""} alt={ouverte.vue === "avant" ? "Sa pièce avant" : "Sa pièce après, simulée"} className="max-h-full max-w-full rounded-[10px] object-contain" />
          </div>
          {ouverte.simulation.reference ? <p className="pb-4 text-center text-[13px] text-[#9CA3AF]">Finition {ouverte.simulation.reference}{ouverte.simulation.prix ? ` · ${Math.round(ouverte.simulation.prix)} € simulés` : ""}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Enchaîner les appels ──────────────────────────────────────────── */

function ModeAppels({ file, total, ecartes, maintenant, onQuitter, onPasser, onNote, onDossier, occupe }: { file: LigneLead[]; total: number; ecartes: number; maintenant: number; onQuitter: () => void; onPasser: (id: string) => void; onNote: (lead: LigneLead, issue: IssueAppel, note: string, ouvrirDossier: boolean) => Promise<void>; onDossier: (lead: LigneLead) => void; occupe: boolean }) {
  const lead = file[0] ?? null;
  const [issue, setIssue] = useState<IssueAppel | null>(null);
  const [avecDossier, setAvecDossier] = useState(true);
  const notes = useRef<NotesAppelRef>(null);
  const [envoi, setEnvoi] = useState(false);
  const idCourant = lead?.id ?? null;
  const [idSuivi, setIdSuivi] = useState(idCourant);
  // Plein écran sur téléphone : le geste retour ou un glissement depuis le bord gauche en sort.
  useRetourFerme(true, onQuitter);
  const glisser = useGlisserPourFermer(onQuitter, "droite");
  if (idSuivi !== idCourant) {
    // Un nouveau lead s'affiche : la feuille repart vide.
    setIdSuivi(idCourant);
    setIssue(null);
    setAvecDossier(true);
  }

  async function enregistrer() {
    if (!lead || !issue) return;
    setEnvoi(true);
    try {
      // La note part d'abord (l'issue s'y accroche), puis l'appel est enregistré.
      await notes.current?.vider();
      finAppel(lead.id);
      await onNote(lead, issue, "", issue === "INTERESSE" && avecDossier);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#16181D]" style={glisser.style} {...glisser.gestionnaires}>
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
                {lead.simulation ? <PastilleSimulation nombre={lead.simulations.length} /> : null}
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
              {lead.simulations.length > 0 ? <SesSimulations simulations={lead.simulations} dossierId={lead.dossierId} /> : null}

              {lead.telephoneLien ? (
                <a href={lead.telephoneLien} onClick={() => noterDebutAppel(lead.id, { nom: lead.nom, dossierId: lead.dossierId })} className={cn("mt-5 flex h-16 items-center justify-center gap-3 rounded-[16px] bg-[#1D9E75] text-[19px] font-semibold tabular-nums text-[#06140F] active:bg-[#5DCAA5]", TRANS)}>
                  <Phone size={22} aria-hidden /> {lead.telephone}
                </a>
              ) : (
                <p className="mt-5 rounded-[14px] bg-[#22262D] px-4 py-4 text-center text-[14px] text-[#F5B454]">Numéro illisible{lead.telephone ? ` : ${lead.telephone}` : ""}. {lead.email ? `E-mail : ${lead.email}` : ""}</p>
              )}

              <NotesAppel key={lead.id} ref={notes} leadId={lead.id} notes={lead.notesAppel} variante="appels" />

              <p className="mt-5 mb-2 text-[12px] font-medium text-[#9CA3AF]">Issue de l&apos;appel</p>
              <div className="grid grid-cols-2 gap-2">
                {ISSUES_APPEL.map((valeur) => (
                  <button key={valeur} type="button" aria-pressed={issue === valeur} onClick={() => setIssue(valeur)} className={cn("h-14 rounded-[12px] border-[0.5px] text-[15px] font-medium", issue === valeur ? "border-[#1D9E75] bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] bg-[#1C1F25] text-[#E5E7EB] hover:border-[#3A3E47]", TRANS)}>
                    {LIBELLES_ISSUE[valeur]}
                  </button>
                ))}
              </div>
              {issue === "INTERESSE" && lead.dossierId ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Son dossier est déjà ouvert : l&apos;appel s&apos;y écrit, puis le mail avec le lien de son espace vous sera proposé.</p> : null}
              {issue === "INTERESSE" && !lead.dossierId ? (
                <label className="mt-3 flex items-start gap-2.5 text-[13.5px] leading-snug text-[#D1D5DB]">
                  <input type="checkbox" checked={avecDossier} onChange={(evenement) => setAvecDossier(evenement.target.checked)} className="mt-0.5 h-5 w-5 accent-[#1D9E75]" />
                  <span>
                    Ouvrir son dossier tout de suite
                    <span className="block text-[12px] text-[#8B919C]">Tout est repris ; il sort de Leads. Le mail avec le lien de son espace sera proposé ensuite.</span>
                  </span>
                </label>
              ) : null}
              {issue === "PAS_DE_REPONSE" ? <p className="mt-3 text-[12.5px] text-[#8B919C]">Rappel posé à demain 10 h ; le mail « j&apos;ai essayé de vous joindre » vous sera proposé.</p> : null}
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
            {lead.dossierId ? (
              // Nouvel onglet : la file d'appels reste où elle en est.
              <a href={`/dossiers?dossier=${lead.dossierId}`} target="_blank" rel="noopener" className="mx-auto mt-2 flex w-fit items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline">
                <FolderOpen size={13} aria-hidden /> Voir le dossier
              </a>
            ) : (
              <button type="button" onClick={() => onDossier(lead)} disabled={occupe} className="mx-auto mt-2 flex items-center gap-1.5 text-[12.5px] text-[#5DCAA5] hover:underline disabled:opacity-50">
                <FolderPlus size={13} aria-hidden /> Ouvrir son dossier sans noter d&apos;appel
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

/* ── L'écran ───────────────────────────────────────────────────────── */

export default function EcranLeads({ initial, siteInitial, leadInitial, appelsInitial }: { initial: ListeLeads; siteInitial: SimulationsSiteRecentes; leadInitial: string | null; appelsInitial: boolean }) {
  const routeur = useRouter();
  const [donnees, setDonnees] = useState(initial);
  const [vue, setVue] = useState<VueLeads>("ACTIFS");
  const [source, setSource] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [charge, setCharge] = useState(false);
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

  const [vueSuivie, setVueSuivie] = useState(vue);
  if (vueSuivie !== vue) {
    setVueSuivie(vue);
    setSelection(new Set());
    setMotifGroupe(false);
  }

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
        <button
          type="button"
          aria-pressed={modeSelection}
          onClick={() => {
            setModeSelection((mode) => !mode);
            setSelection(new Set());
          }}
          className={cn("h-9 rounded-full border-[0.5px] px-3.5 text-[13px]", modeSelection ? "border-[#1D9E75]/60 bg-[#1D9E75]/15 text-[#5DCAA5]" : "border-[#2A2D34] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
        >
          {modeSelection ? "Fin de sélection" : "Sélectionner"}
        </button>
        <label className="relative ml-auto w-full sm:w-64">
          <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#6B7280]" />
          <input value={recherche} onChange={(evenement) => setRecherche(evenement.target.value)} placeholder="Nom, téléphone, ville, campagne" aria-label="Rechercher un lead" className={cn(CLASSE_SAISIE, "h-9 rounded-full pl-8 text-[13px]")} />
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

      {selection.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-3 pb-2 md:bottom-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-[14px] border-[0.5px] border-[#2A2D34] bg-[#22262D] p-2.5 shadow-lg shadow-black/40">
            <p className="px-1.5 text-[13.5px] font-medium text-[#F2F3F5]">
              {selection.size} sélectionné{selection.size > 1 ? "s" : ""}
            </p>
            <button type="button" onClick={() => setSelection(new Set(donnees.lignes.map((l) => l.id)))} className="h-9 rounded-[10px] px-2.5 text-[12.5px] text-[#9CA3AF] hover:text-[#F2F3F5]">
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
              <button type="button" onClick={() => setSelection(new Set())} aria-label="Tout désélectionner" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[#9CA3AF] hover:bg-[#2A2F37]">
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
