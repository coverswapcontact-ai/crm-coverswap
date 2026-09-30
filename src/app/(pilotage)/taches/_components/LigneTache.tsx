"use client";

import { useRef, useState, type TouchEvent } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock,
  Euro,
  FileText,
  FolderOpen,
  Mail,
  MailCheck,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Phone,
  UserRound,
  WandSparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { GenreRaccourci, TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, ligneGrise, ligneFaite } from "@/lib/a-faire/affichage";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 17 (partie A) — une ligne de l'écran Tâches, au style des listes compactes (Leads) : en gras « verbe · nom »,
 * en gris la raison ; à droite le temps estimé, le bouton principal (44 px, l'icône dit l'action) et « … » (les trois
 * réponses). Sur téléphone : balayer à droite = Fait, à gauche = Plus tard. Le geste ne part qu'à l'horizontale (le
 * défilement vertical reste au navigateur : `touch-action: pan-y`), et pas du bord gauche de l'écran (geste retour).
 */

export const ICONES_RACCOURCI: Record<GenreRaccourci, LucideIcon> = {
  APPEL: Phone,
  SMS: MessageSquare,
  MAIL: Mail,
  ESPACE: MessagesSquare,
  SIMULATEUR: WandSparkles,
  DEVIS: FileText,
  RELANCE_MAIL: MailCheck,
  PLANIFIER: CalendarDays,
  ENCAISSER: Euro,
  VALIDER: Check,
  DOSSIER: FolderOpen,
  LEAD: UserRound,
  COHERENCE: Wrench,
  PAGE: ArrowUpRight,
};

/** Le numéro composable d'un raccourci d'appel (« tel: »), ou null. */
export function numeroDe(tache: TacheVue): string | null {
  const brut = tache.raccourci.telephone?.replace(/[^\d+]/g, "") ?? "";
  return brut.length >= 6 ? brut : null;
}

/** Une tâche sans rien à ouvrir (tâche à moi sans cible) : le bouton principal la dit faite. */
export function sansRaccourci(tache: TacheVue): boolean {
  const r = tache.raccourci;
  return r.genre === "PAGE" && !r.href;
}

const SEUIL_BALAYAGE = 90;
const BORD_RETOUR = 24;

export const CLASSE_BOUTON_PRINCIPAL = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-50";
const CLASSE_BOUTON_GRIS = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]";

export type ActionsLigne = {
  /** Le raccourci (sauf l'appel, qui est un lien tel:). */
  onPrincipal: (tache: TacheVue) => void;
  /** Le lien tel: vient d'être touché. */
  onAppel: (tache: TacheVue) => void;
  /** La ligne touchée : la fiche (dossier, contact, mail). */
  onOuvrir: (tache: TacheVue) => void;
  onMenu: (tache: TacheVue) => void;
  onFait: (tache: TacheVue) => void;
  onPlusTard: (tache: TacheVue) => void;
  onIgnorer: (tache: TacheVue) => void;
};

/** Le bouton principal : l'action prête (un lien pour l'appel et une page externe). */
export function BoutonPrincipal({ tache, actions, grand = false }: { tache: TacheVue; actions: Pick<ActionsLigne, "onPrincipal" | "onAppel" | "onFait">; grand?: boolean }) {
  const r = tache.raccourci;
  const vide = sansRaccourci(tache);
  const Icone = vide ? Check : ICONES_RACCOURCI[r.genre] ?? ArrowUpRight;
  const libelle = vide ? "Fait" : r.libelle;
  const classe = grand
    ? cn("flex h-16 w-full items-center justify-center gap-3 rounded-[16px] bg-[#1D9E75] px-4 text-[18px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] active:bg-[#5DCAA5]", TRANS)
    : cn(CLASSE_BOUTON_PRINCIPAL, TRANS);
  const contenu = grand ? (
    <>
      <Icone size={21} aria-hidden className="shrink-0" />
      <span className="truncate">{libelle}</span>
    </>
  ) : (
    <Icone size={18} aria-hidden />
  );
  const numero = r.genre === "APPEL" ? numeroDe(tache) : null;
  if (numero) {
    return (
      <a href={`tel:${numero}`} onClick={() => actions.onAppel(tache)} aria-label={`${libelle} (${r.telephone})`} title={r.telephone ?? undefined} className={classe}>
        {contenu}
      </a>
    );
  }
  if (r.genre === "PAGE" && r.href && r.externe) {
    return (
      <a href={r.href} target="_blank" rel="noopener noreferrer" onClick={() => actions.onPrincipal(tache)} aria-label={`${libelle} (nouvel onglet)`} title={libelle} className={classe}>
        {contenu}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => (vide ? actions.onFait(tache) : actions.onPrincipal(tache))} aria-label={libelle} title={libelle} className={classe}>
      {contenu}
    </button>
  );
}

export function LigneTache({ tache, maintenant, surbrillance, occupe, actions }: { tache: TacheVue; maintenant: number; surbrillance: boolean; occupe: boolean; actions: ActionsLigne }) {
  const depart = useRef<{ x: number; y: number; sens: "?" | "h" | "v" } | null>(null);
  const aGlisse = useRef(false);
  const [decalage, setDecalage] = useState(0);
  const valider = tache.raccourci.genre === "VALIDER";

  const gestes = {
    onTouchStart: (evenement: TouchEvent<HTMLDivElement>) => {
      const t = evenement.touches[0];
      aGlisse.current = false;
      // Le bord gauche de l'écran appartient au geste retour du téléphone.
      depart.current = t.clientX <= BORD_RETOUR ? null : { x: t.clientX, y: t.clientY, sens: "?" };
    },
    onTouchMove: (evenement: TouchEvent<HTMLDivElement>) => {
      const d = depart.current;
      if (!d) return;
      const t = evenement.touches[0];
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      if (d.sens === "?") {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) d.sens = "h";
        else if (Math.abs(dy) > 10) d.sens = "v";
      }
      if (d.sens === "h") {
        aGlisse.current = true;
        setDecalage(Math.max(-140, Math.min(140, dx)));
      }
    },
    onTouchEnd: () => {
      const d = depart.current;
      depart.current = null;
      if (d?.sens === "h" && !occupe) {
        if (decalage >= SEUIL_BALAYAGE) actions.onFait(tache);
        else if (decalage <= -SEUIL_BALAYAGE) actions.onPlusTard(tache);
      }
      setDecalage(0);
    },
    onTouchCancel: () => {
      depart.current = null;
      setDecalage(0);
    },
  };

  return (
    <li className={cn("relative overflow-hidden border-t-[0.5px] border-[#2A2D34] first:border-t-0", occupe && "opacity-60")} data-tache={tache.id}>
      {decalage !== 0 ? (
        <div aria-hidden className={cn("absolute inset-0 flex items-center px-5 text-[13px] font-semibold", decalage > 0 ? "justify-start bg-[#1D9E75] text-[#06140F]" : "justify-end bg-[#EF9F27] text-[#1A1206]")}>
          {decalage > 0 ? (
            <span className="flex items-center gap-1.5">
              <Check size={16} /> Fait
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Plus tard <Clock size={16} />
            </span>
          )}
        </div>
      ) : null}
      <div
        {...gestes}
        onClickCapture={(evenement) => {
          // Un balayage n'est pas un toucher : rien ne s'ouvre.
          if (aGlisse.current) {
            evenement.preventDefault();
            evenement.stopPropagation();
            aGlisse.current = false;
          }
        }}
        style={{ touchAction: "pan-y", ...(decalage ? { transform: `translateX(${decalage}px)` } : {}) }}
        className={cn("relative flex items-center gap-1 bg-[#1C1F25] pr-1.5", surbrillance && "bg-[#15251F] shadow-[inset_3px_0_0_#1D9E75]")}
      >
        <button type="button" onClick={() => actions.onOuvrir(tache)} className={cn("flex min-h-[60px] min-w-0 flex-1 flex-col justify-center py-2 pl-3.5 text-left hover:bg-[#20232A] focus-visible:bg-[#20232A] focus-visible:outline-none sm:min-h-[52px]", TRANS)}>
          <span className="block w-full truncate text-[14.5px] font-medium text-[#F2F3F5]">{tache.titre}</span>
          <span className="block w-full truncate text-[12.5px] text-[#8B919C]">{ligneGrise(tache, new Date(maintenant))}</span>
        </button>
        <span className={cn("shrink-0 px-1 text-[12px] text-[#8B919C] tabular-nums", valider && "hidden sm:inline")}>{dureeLisible(tache.dureeMin)}</span>
        {valider ? (
          <>
            <button type="button" disabled={occupe} onClick={() => actions.onFait(tache)} aria-label="Valider" title="Valider" className={cn(CLASSE_BOUTON_PRINCIPAL, "sm:w-auto sm:rounded-[10px] sm:px-3 sm:text-[13px] sm:font-medium", TRANS)}>
              <Check size={18} aria-hidden className="sm:hidden" />
              <span className="hidden sm:inline">Valider</span>
            </button>
            <button type="button" disabled={occupe} onClick={() => actions.onIgnorer(tache)} aria-label="Ignorer" title="Ignorer" className={cn(CLASSE_BOUTON_GRIS, "border-[0.5px] border-[#2A2D34] sm:w-auto sm:rounded-[10px] sm:px-3 sm:text-[13px]", TRANS)}>
              <X size={17} aria-hidden className="sm:hidden" />
              <span className="hidden sm:inline">Ignorer</span>
            </button>
          </>
        ) : (
          <BoutonPrincipal tache={tache} actions={actions} />
        )}
        <button type="button" onClick={() => actions.onMenu(tache)} aria-label={`Répondre : ${tache.titre}`} title="Fait, Plus tard, Pas à faire" className={cn(CLASSE_BOUTON_GRIS, TRANS)}>
          <MoreHorizontal size={18} aria-hidden />
        </button>
      </div>
    </li>
  );
}

/** Une ligne de « Fait aujourd'hui » : la coche, le titre, et pourquoi (la preuve lue par le CRM, ou qui a répondu). */
export function LigneFaite({ tache }: { tache: TacheVue }) {
  const pasAFaire = tache.statut === "PAS_A_FAIRE";
  return (
    <li className="flex min-h-[52px] items-center gap-3 border-t-[0.5px] border-[#2A2D34] px-3.5 py-2 first:border-t-0">
      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", pasAFaire ? "bg-[#22262D] text-[#8B919C]" : "bg-[#1D9E75]/20 text-[#5DCAA5]")}>
        {pasAFaire ? <X size={12} aria-hidden /> : <Check size={12} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14px]", pasAFaire ? "text-[#9CA3AF]" : "text-[#D1D5DB]")}>{tache.titre}</span>
        <span className="block truncate text-[12.5px] text-[#8B919C]">{ligneFaite(tache)}</span>
      </span>
    </li>
  );
}
