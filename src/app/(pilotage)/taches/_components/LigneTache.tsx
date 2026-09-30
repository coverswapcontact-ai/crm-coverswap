"use client";

import { useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from "react";
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
  ShieldCheck,
  UserRound,
  WandSparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { GenreRaccourci, Raccourci, TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, ligneGrise, ligneFaite } from "@/lib/a-faire/affichage";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 17 (partie A) — une ligne de l'écran Tâches, au style des listes compactes (Leads) : en gras « verbe · nom »,
 * en gris la raison ; à droite le temps estimé, le bouton principal (l'icône dit l'action) et « … » (les trois
 * réponses). Sur téléphone : balayer à droite = Fait, à gauche = Plus tard. Le geste ne part qu'à l'horizontale (le
 * défilement vertical reste au navigateur : `touch-action: pan-y`), et pas du bord gauche de l'écran (geste retour).
 *
 * Mission 17 (partie A, relecture) :
 * - téléphone (390 px) : le temps estimé passe en tête de la ligne grise ; le verbe n'est jamais coupé (le nom se
 *   tronque, ou passe à la ligne s'il ne lui reste presque rien) ; la raison tient sur deux lignes ;
 * - boutons de 44 px au doigt à toutes les largeurs, compacts seulement pour un pointeur fin (souris) ;
 * - proposition sensible (argent ou client) : jamais « Valider » dans la ligne ni au balayage ; le bouton principal
 *   « Relire et valider » ouvre son aperçu, et le balayage à droite aussi.
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

/** L'identifiant de la proposition d'une tâche (raccourci, sinon données du détecteur), ou null. */
export function propositionDe(tache: TacheVue): string | null {
  const id = tache.raccourci.propositionId ?? tache.donnees.propositionId;
  return typeof id === "string" && id ? id : null;
}

/** Une proposition sensible (argent ou client) : elle ne se valide qu'avec son aperçu, jamais d'un geste dans la liste. */
export function estSensible(tache: TacheVue): boolean {
  return tache.donnees.sensible === true && propositionDe(tache) !== null;
}

/** Validée d'un geste dans la ligne (Valider / Ignorer) : une proposition qui n'est pas sensible. */
export function valideDansLaLigne(tache: TacheVue): boolean {
  return tache.raccourci.genre === "VALIDER" && !estSensible(tache);
}

/**
 * Le raccourci à montrer. Une proposition sensible encore décrite « Valider » (liste lue avant le passage qui la
 * corrige) devient « Relire et valider » : son aperçu dans « À valider ».
 */
export function raccourciDe(tache: TacheVue): Raccourci {
  const r = tache.raccourci;
  const propositionId = propositionDe(tache);
  if (r.genre === "VALIDER" && estSensible(tache) && propositionId) {
    return { ...r, genre: "PAGE", libelle: "Relire et valider", href: `/validation?proposition=${encodeURIComponent(propositionId)}`, propositionId, externe: false };
  }
  return r;
}

const SEUIL_BALAYAGE = 90;
const BORD_RETOUR = 24;

/** 44 px au doigt, à toutes les largeurs ; 32 px seulement pour un pointeur fin (souris, pavé). */
export const CLASSE_BOUTON_PRINCIPAL = "flex h-11 w-11 pointer-fine:h-8 pointer-fine:w-8 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-50";
const CLASSE_BOUTON_GRIS = "flex h-11 w-11 pointer-fine:h-8 pointer-fine:w-8 shrink-0 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]";

/**
 * Balayer à l'horizontale (ligne, mode Commencer) : à droite, à gauche. Ne part qu'à l'horizontale, jamais du bord
 * gauche de l'écran (geste retour du téléphone) ; `glisse` dit qu'un balayage vient d'avoir lieu (le toucher qui suit
 * n'ouvre rien).
 */
export function useBalayage({ onDroite, onGauche, bloque = false }: { onDroite: () => void; onGauche: () => void; bloque?: boolean }) {
  const depart = useRef<{ x: number; y: number; sens: "?" | "h" | "v" } | null>(null);
  const glisse = useRef(false);
  const [decalage, setDecalage] = useState(0);
  const gestionnaires = {
    onTouchStart: (evenement: TouchEvent<HTMLElement>) => {
      const t = evenement.touches[0];
      glisse.current = false;
      depart.current = t.clientX <= BORD_RETOUR ? null : { x: t.clientX, y: t.clientY, sens: "?" };
    },
    onTouchMove: (evenement: TouchEvent<HTMLElement>) => {
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
        glisse.current = true;
        setDecalage(Math.max(-140, Math.min(140, dx)));
      }
    },
    onTouchEnd: () => {
      const d = depart.current;
      depart.current = null;
      if (d?.sens === "h" && !bloque) {
        if (decalage >= SEUIL_BALAYAGE) onDroite();
        else if (decalage <= -SEUIL_BALAYAGE) onGauche();
      }
      setDecalage(0);
    },
    onTouchCancel: () => {
      depart.current = null;
      setDecalage(0);
    },
    onClickCapture: (evenement: MouseEvent<HTMLElement>) => {
      // Un balayage n'est pas un toucher : rien ne s'ouvre.
      if (glisse.current) {
        evenement.preventDefault();
        evenement.stopPropagation();
        glisse.current = false;
      }
    },
  };
  const style: CSSProperties = { touchAction: "pan-y", ...(decalage ? { transform: `translateX(${decalage}px)` } : {}) };
  return { decalage, gestionnaires, style };
}

/** Le fond révélé par un balayage : à droite « Fait » (ou « Relire » pour une proposition sensible), à gauche « Plus tard ». */
export function FondBalayage({ decalage, droite = "Fait", arrondi }: { decalage: number; droite?: string; arrondi?: string }) {
  if (decalage === 0) return null;
  return (
    <div aria-hidden className={cn("absolute inset-0 flex items-center px-5 text-[13px] font-semibold", arrondi, decalage > 0 ? "justify-start bg-[#1D9E75] text-[#06140F]" : "justify-end bg-[#EF9F27] text-[#1A1206]")}>
      {decalage > 0 ? (
        <span className="flex items-center gap-1.5">
          <Check size={16} /> {droite}
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          Plus tard <Clock size={16} />
        </span>
      )}
    </div>
  );
}

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
  const r = raccourciDe(tache);
  const vide = sansRaccourci(tache);
  const Icone = vide ? Check : estSensible(tache) && r.genre === "PAGE" ? ShieldCheck : (ICONES_RACCOURCI[r.genre] ?? ArrowUpRight);
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
    <Icone size={17} aria-hidden />
  );
  const numero = r.genre === "APPEL" ? numeroDe(tache) : null;
  if (numero) {
    return (
      <a data-principal="" href={`tel:${numero}`} onClick={() => actions.onAppel(tache)} aria-label={`${libelle} (${r.telephone})`} title={r.telephone ?? undefined} className={classe}>
        {contenu}
      </a>
    );
  }
  if (r.genre === "PAGE" && r.href && r.externe) {
    return (
      <a data-principal="" href={r.href} target="_blank" rel="noopener noreferrer" onClick={() => actions.onPrincipal(tache)} aria-label={`${libelle} (nouvel onglet)`} title={libelle} className={classe}>
        {contenu}
      </a>
    );
  }
  return (
    <button data-principal="" type="button" onClick={() => (vide ? actions.onFait(tache) : actions.onPrincipal(tache))} aria-label={libelle} title={libelle} className={classe}>
      {contenu}
    </button>
  );
}

/**
 * « verbe · nom » : le verbe n'est jamais coupé (il passe à la ligne entre deux mots s'il est plus large que la ligne) ;
 * le nom se tronque en dernier recours, et passe à la ligne s'il ne lui reste pas au moins 4,5 rem. Un titre sans « · » (tâche à moi)
 * tient sur deux lignes.
 */
function Titre({ titre }: { titre: string }) {
  const coupure = titre.indexOf(" · ");
  const classe = "text-[14.5px] leading-snug font-medium text-[#F2F3F5]";
  if (coupure < 0) return <span className={cn("line-clamp-2 w-full break-words", classe)}>{titre}</span>;
  return (
    <span className={cn("flex w-full min-w-0 flex-wrap", classe)} title={titre}>
      {/* Le « · » reste avec le verbe : si le nom passe à la ligne, il ne commence pas par un point. */}
      <span className="max-w-full">{`${titre.slice(0, coupure)}\u00a0·\u00a0`}</span>
      <span className="min-w-[4.5rem] flex-1 basis-0 truncate">{titre.slice(coupure + 3)}</span>
    </span>
  );
}

export function LigneTache({ tache, maintenant, surbrillance, occupe, actions }: { tache: TacheVue; maintenant: number; surbrillance: boolean; occupe: boolean; actions: ActionsLigne }) {
  const enLigne = valideDansLaLigne(tache);
  const sensible = estSensible(tache);
  // À droite : Fait (Valider pour une proposition qui n'est pas sensible ; l'aperçu pour une sensible : onFait l'ouvre).
  const balayage = useBalayage({ onDroite: () => actions.onFait(tache), onGauche: () => actions.onPlusTard(tache), bloque: occupe });
  const duree = dureeLisible(tache.dureeMin);

  return (
    <li className={cn("relative overflow-hidden border-t-[0.5px] border-[#2A2D34] first:border-t-0", occupe && "opacity-60")} data-tache={tache.id}>
      <FondBalayage decalage={balayage.decalage} droite={sensible ? "Relire" : enLigne ? "Valider" : "Fait"} />
      <div {...balayage.gestionnaires} style={balayage.style} className={cn("relative flex items-center gap-1 bg-[#1C1F25] pr-1.5", surbrillance && "bg-[#15251F] shadow-[inset_3px_0_0_#1D9E75]")}>
        <button type="button" onClick={() => actions.onOuvrir(tache)} className={cn("flex min-h-[60px] min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-3.5 text-left hover:bg-[#20232A] focus-visible:bg-[#20232A] focus-visible:outline-none pointer-fine:min-h-[48px]", TRANS)}>
          <Titre titre={tache.titre} />
          <span className="line-clamp-2 w-full text-[12.5px] leading-snug break-words text-[#8B919C] sm:line-clamp-1">
            <span className="tabular-nums sm:hidden">{duree} · </span>
            {ligneGrise(tache, new Date(maintenant))}
          </span>
        </button>
        <span className="hidden shrink-0 px-1 text-[12px] text-[#8B919C] tabular-nums sm:inline">{duree}</span>
        {enLigne ? (
          <>
            <button type="button" disabled={occupe} onClick={() => actions.onFait(tache)} aria-label="Valider" title="Valider" className={cn("flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-[#1D9E75] text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-50 sm:rounded-[10px] sm:px-3 sm:text-[13px] sm:font-medium pointer-fine:h-8 pointer-fine:min-w-8", TRANS)}>
              <Check size={18} aria-hidden className="sm:hidden" />
              <span className="hidden sm:inline">Valider</span>
            </button>
            <button type="button" disabled={occupe} onClick={() => actions.onIgnorer(tache)} aria-label="Ignorer" title="Ignorer" className={cn("flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border-[0.5px] border-[#2A2D34] text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5] disabled:opacity-50 sm:rounded-[10px] sm:px-3 sm:text-[13px] pointer-fine:h-8 pointer-fine:min-w-8", TRANS)}>
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
