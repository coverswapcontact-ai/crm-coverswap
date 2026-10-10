"use client";

import { ChevronRight, Sparkles, X } from "lucide-react";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";
import { LIBELLES_MOTIF_ARCHIVAGE, MOTIFS_ARCHIVAGE, type MotifArchivage } from "@/lib/prospects/menage-constantes";
import type { LigneLead } from "@/lib/prospects/leads";
import { pluriel } from "@/lib/commun/format";
import { BoutonsContact } from "@/components/messagerie/BoutonsContact";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { PuceRappel } from "./DateRappel";

/** Mission 13 (lot 7) — une ligne de la liste des leads et ses petites aides (attente, réponses, provenance, motif d'archivage) ; extrait d'EcranLeads. */

/* ── Temps ─────────────────────────────────────────────────────────── */

export function duree(depuis: string, maintenant: number): string {
  const minutes = Math.max(0, Math.round((maintenant - new Date(depuis).getTime()) / 60_000));
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  const jours = Math.floor(minutes / 1440);
  return `${jours} j`;
}

export function heureArrivee(iso: string): string {
  const date = new Date(iso);
  const aujourdhui = new Date().toDateString() === date.toDateString();
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return aujourdhui ? `aujourd'hui ${heure}` : `${date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ${heure}`;
}

/** Cinq minutes : l'objectif. Une heure : le lead refroidit. */
export function tonAttente(depuis: string, maintenant: number): string {
  const minutes = (maintenant - new Date(depuis).getTime()) / 60_000;
  return minutes <= 5 ? "text-action-clair" : minutes <= 60 ? "text-attention-texte" : "text-retard-texte";
}

export function Attente({ lead, maintenant }: { lead: LigneLead; maintenant: number }) {
  if (lead.attendDepuis) return <span className={cn("font-medium tabular-nums", tonAttente(lead.attendDepuis, maintenant))}>attend un appel depuis {duree(lead.attendDepuis, maintenant)}</span>;
  if (lead.rappelLe) {
    const echu = new Date(lead.rappelLe).getTime() <= maintenant;
    return <span className={echu ? "font-medium text-retard-texte" : "text-texte-3"}>{echu ? "rappel à faire depuis " + duree(lead.rappelLe, maintenant) : `rappel prévu ${heureArrivee(lead.rappelLe)}`}</span>;
  }
  if (lead.dernierAppel) return <span className="text-texte-3">appelé il y a {duree(lead.dernierAppel.le, maintenant)}</span>;
  return null;
}

/* ── Une ligne ─────────────────────────────────────────────────────── */

export function Reponses({ lead, toutes = false }: { lead: LigneLead; toutes?: boolean }) {
  const reponses = toutes ? lead.reponses : lead.reponses.slice(0, 4);
  if (reponses.length === 0 && !lead.message) return null;
  return (
    <div className="mt-2">
      {reponses.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {reponses.map((reponse) => (
            <li key={`${reponse.question}:${reponse.reponse}`} className="rounded-[6px] bg-surface-2 px-2 py-[3px] text-[11.5px] leading-tight text-texte-2">
              <span className="text-texte-3">{reponse.question} : </span>
              {reponse.reponse}
            </li>
          ))}
        </ul>
      ) : null}
      {lead.message ? <p className={cn("mt-1.5 text-[12.5px] leading-snug text-texte-3", !toutes && "line-clamp-2")}>« {lead.message} »</p> : null}
    </div>
  );
}

export function Provenance({ lead }: { lead: LigneLead }) {
  return (
    <>
      {lead.libelleSource}
      {lead.campagne ? <span className="text-texte-2"> · {lead.campagne}</span> : null}
    </>
  );
}

/** Le motif en un geste : quatre boutons, un tap archive. */
export function ChoixMotif({ onChoisir, onAnnuler, occupe }: { onChoisir: (motif: MotifArchivage) => void; onAnnuler: () => void; occupe: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Motif de l'archivage">
      <span className="mr-0.5 text-[12px] text-texte-3">Archiver :</span>
      {MOTIFS_ARCHIVAGE.map((motif) => (
        <button key={motif} type="button" disabled={occupe} onClick={() => onChoisir(motif)} className={cn("h-11 sm:h-9 rounded-full border-[0.5px] border-attention/45 px-3 text-[13px] text-attention-texte hover:bg-attention/15 disabled:opacity-50", TRANS)}>
          {LIBELLES_MOTIF_ARCHIVAGE[motif]}
        </button>
      ))}
      <button type="button" onClick={onAnnuler} aria-label="Ne pas archiver" className="flex h-11 sm:h-9 w-11 sm:w-9 items-center justify-center rounded-full text-texte-3 hover:bg-surface-2">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Mission 13 (lot 3) — une ligne par lead : pastille de priorité, nom · ville ·
 * source, le délai, UN bouton « Appeler » (44 px), chevron. Noter, écrire,
 * ouvrir le dossier, archiver, fusionner un doublon : dans le panneau, au toucher.
 * Mission 14 (partie 3) — dans « À rappeler » (`onRappel` fourni), le délai
 * laisse la place à la puce de la date de rappel, modifiable en un geste, et au
 * nombre de tentatives sans réponse.
 * Mission 25 (lot 6) — nom, ville, la ligne Situation de « Où on en est », et les
 * boutons ronds 📞 💬 ✉️ (appeler, ouvrir Messages sur le numéro, copier le mail).
 */
export function Ligne({ lead, maintenant, selection, selectionne, onSelection, onOuvrir, onRappel, rappelEnCours = false }: { lead: LigneLead; maintenant: number; selection: boolean; selectionne: boolean; onSelection: () => void; onOuvrir: () => void; onRappel?: (iso: string | null) => void; rappelEnCours?: boolean }) {
  const archive = Boolean(lead.archiveLe);
  const priorite = lead.priorite && lead.priorite in LIBELLES_PRIORITE ? (lead.priorite as Priorite) : null;
  // Mission 14 : « à écarter » en gris (un anneau, pour ne pas le confondre avec « secondaire », gris plein) ; il reste dans « À appeler ».
  const couleur = priorite === "PRIORITAIRE" ? "bg-retard" : priorite === "STANDARD" ? "bg-action" : priorite === "A_ECARTER" ? "border-[1.5px] border-texte-3" : priorite === "SECONDAIRE" ? "bg-texte-3" : "bg-trait";
  const rappel = Boolean(onRappel) && !archive;
  return (
    <li className={cn("flex items-center border-t-[0.5px] border-trait first:border-t-0", selectionne && "bg-action/[0.06]")}>
      {selection ? (
        <label className="flex h-14 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={selectionne} onChange={onSelection} aria-label={`Sélectionner ${lead.nom}`} className="h-[18px] w-[18px] accent-action" />
        </label>
      ) : null}
      <div className={cn("min-w-0 flex-1", selection ? "pl-1" : "pl-3.5")}>
        <button type="button" onClick={onOuvrir} className={cn("flex w-full min-w-0 items-center gap-3 text-left hover:bg-surface focus-visible:bg-surface focus-visible:outline-none", rappel ? "min-h-[48px] pt-2" : "min-h-[60px] py-2", TRANS)}>
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", couleur)} title={priorite ? `${LIBELLES_PRIORITE[priorite]}${lead.prioriteMotif ? ` — ${lead.prioriteMotif}` : ""}` : undefined} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14.5px] font-medium text-texte">{lead.nom}</span>
              {lead.simulation ? <Sparkles size={13} aria-label="Simulation faite sur le site" className="shrink-0 text-info-texte" /> : null}
              {lead.smsNonLus > 0 ? <span className="shrink-0 rounded-full bg-action px-1.5 text-[10.5px] leading-[17px] font-semibold text-action-texte">{lead.smsNonLus} SMS</span> : null}
              {lead.doublon && !archive ? <span className="shrink-0 rounded-full border-[0.5px] border-attention/40 px-1.5 text-[10.5px] leading-[17px] text-attention-texte">Doublon ?</span> : null}
            </span>
            <span className="block truncate text-[12.5px] text-texte-3">
              {lead.ville ? `${lead.ville} · ` : ""}
              {rappel || archive ? `${lead.libelleSource}${lead.campagne ? ` · ${lead.campagne}` : ""}` : lead.attendDepuis || lead.rappelLe || lead.dernierAppel ? <Attente lead={lead} maintenant={maintenant} /> : `Arrivé ${heureArrivee(lead.recuLe)}`}
            </span>
            {archive ? (
              <span className="block truncate text-[12.5px] text-texte-3">{`Archivé le ${new Date(lead.archiveLe!).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}${lead.archiveMotif ? ` · ${lead.archiveMotif}` : ""}`}</span>
            ) : lead.situation ? (
              <span className="block truncate text-[12.5px] text-texte-2">📍 {lead.situation}</span>
            ) : null}
          </span>
        </button>
        {rappel && onRappel ? (
          // Hors du bouton de la ligne (un champ ne se niche pas dans un bouton) ; deux lignes au plus à 390 px.
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 pb-1 pl-[22px]">
            <PuceRappel rappelLe={lead.rappelLe} enRetard={lead.enRetard} occupe={rappelEnCours} onChoisir={onRappel} />
            {lead.tentatives > 0 ? <span className="text-[12.5px] whitespace-nowrap text-texte-3">{pluriel(lead.tentatives, "tentative")}</span> : null}
          </div>
        ) : null}
      </div>
      {archive ? null : (
        <BoutonsContact
          variante="ligne"
          nom={lead.nom}
          telephone={lead.telephoneLien ? lead.telephoneLien.replace(/^tel:/, "") : null}
          email={lead.email}
          leadId={lead.id}
          dossierId={lead.dossierId}
          appelPrioritaire={lead.aAppeler || lead.enRetard}
          className="mr-1 shrink-0"
        />
      )}
      <ChevronRight size={16} aria-hidden className="mr-3 hidden shrink-0 text-texte-3 sm:block" />
    </li>
  );
}
