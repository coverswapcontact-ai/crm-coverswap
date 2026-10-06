"use client";

import { useId } from "react";
import { Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EtapeDossier } from "@/lib/dossiers/constants";
import { useGlisserPourFermer, useRetourFerme } from "./fermeture-mobile";

// Primitives des écrans de pilotage (Prospects, Dossiers, Validation, Clients,
// Finances…) : charte sombre commune.

// Transition unique : 150 ms ease
export const TRANS = "transition-colors duration-150 ease-[ease]";

/**
 * Mission 22 — les jetons de couleur de globals.css (@theme) pour les styles en ligne, les SVG et recharts, partout
 * où une chaîne de couleur est attendue. Les classes Tailwind (bg-surface, text-texte-3…) viennent du même bloc.
 */
export const JETONS = {
  fond: "var(--color-fond)",
  surface: "var(--color-surface)",
  "surface-2": "var(--color-surface-2)",
  trait: "var(--color-trait)",
  "trait-2": "var(--color-trait-2)",
  texte: "var(--color-texte)",
  "texte-2": "var(--color-texte-2)",
  "texte-3": "var(--color-texte-3)",
  "texte-inverse": "var(--color-texte-inverse)",
  action: "var(--color-action)",
  "action-texte": "var(--color-action-texte)",
  "action-clair": "var(--color-action-clair)",
  "action-fond": "var(--color-action-fond)",
  retard: "var(--color-retard)",
  "retard-texte": "var(--color-retard-texte)",
  attention: "var(--color-attention)",
  "attention-texte": "var(--color-attention-texte)",
  info: "var(--color-info)",
  "info-texte": "var(--color-info-texte)",
} as const;

/** Une couleur (jeton ou `var()`) posée à `pourcent` % sur du transparent : fonds et traits des pastilles. */
export function teinte(couleur: string, pourcent: number): string {
  return `color-mix(in srgb, ${couleur} ${pourcent}%, transparent)`;
}

/* ── Boutons ─────────────────────────────────────────────────────── */

const VARIANTES = {
  primaire: "bg-action text-action-texte hover:bg-action-clair",
  secondaire:
    "border-[0.5px] border-trait bg-surface text-texte hover:border-trait-2 hover:bg-surface-2",
  fantome: "text-texte-3 hover:bg-surface-2 hover:text-texte",
  // Le rouge est réservé à l'argent en retard et au perdu : le bouton « danger » et les erreurs sont en ambre.
  danger: "border-[0.5px] border-attention/30 bg-attention/10 text-attention-texte hover:bg-attention/20",
} as const;

const TAILLES = {
  // Mission 13 (lot 5) : 44 px au doigt sur téléphone, compact sur ordinateur.
  sm: "h-11 px-3 text-[13px] sm:h-7 sm:px-2.5 sm:text-[12px]",
  md: "h-11 px-3.5 text-[13px] sm:h-8",
  icone: "h-11 w-11 sm:h-8 sm:w-8",
} as const;

export function Bouton({
  variante = "secondaire",
  taille = "md",
  icone,
  chargement = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: keyof typeof VARIANTES;
  taille?: keyof typeof TAILLES;
  icone?: React.ReactNode;
  chargement?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || chargement}
      aria-busy={chargement || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap",
        "focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        TRANS,
        TAILLES[taille],
        VARIANTES[variante],
        className
      )}
      {...props}
    >
      {chargement ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : icone}
      {children}
    </button>
  );
}

/* ── Champs ──────────────────────────────────────────────────────── */

// 16 px sur mobile : en dessous, Safari iOS zoome sur le champ au focus.
export const CLASSE_SAISIE = cn(
  "w-full rounded-[8px] border-[0.5px] border-trait bg-fond px-3 text-[16px] text-texte sm:text-[13px]",
  "placeholder:text-texte-3 hover:border-trait-2 focus:border-action/60 focus:ring-2 focus:ring-action/20 focus:outline-none",
  "disabled:opacity-60 aria-invalid:border-attention/60 [color-scheme:dark]",
  TRANS
);

function Libelle({ htmlFor, libelle, obligatoire }: { htmlFor: string; libelle: string; obligatoire?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-texte-3">
      {libelle}
      {obligatoire ? <span className="text-action-clair"> *</span> : null}
    </label>
  );
}

function Aide({ erreur, aide }: { erreur?: string | null; aide?: string }) {
  if (erreur) return <p className="mt-1 text-[12px] text-attention-texte">{erreur}</p>;
  if (aide) return <p className="mt-1 text-[12px] text-texte-3">{aide}</p>;
  return null;
}

type ProprietesChamp = {
  libelle: string;
  erreur?: string | null;
  aide?: string;
  obligatoire?: boolean;
  classeConteneur?: string;
};

export function Champ({
  libelle,
  erreur,
  aide,
  obligatoire,
  classeConteneur,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & ProprietesChamp) {
  const idAuto = useId();
  const idChamp = id ?? idAuto;
  return (
    <div className={classeConteneur}>
      <Libelle htmlFor={idChamp} libelle={libelle} obligatoire={obligatoire} />
      <input
        id={idChamp}
        aria-invalid={erreur ? true : undefined}
        className={cn(CLASSE_SAISIE, "h-11 sm:h-9", className)}
        {...props}
      />
      <Aide erreur={erreur} aide={aide} />
    </div>
  );
}

export function ZoneTexte({
  libelle,
  erreur,
  aide,
  obligatoire,
  classeConteneur,
  className,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & ProprietesChamp) {
  const idAuto = useId();
  const idChamp = id ?? idAuto;
  return (
    <div className={classeConteneur}>
      <Libelle htmlFor={idChamp} libelle={libelle} obligatoire={obligatoire} />
      <textarea
        id={idChamp}
        aria-invalid={erreur ? true : undefined}
        className={cn(CLASSE_SAISIE, "min-h-[76px] resize-y py-2 leading-relaxed", className)}
        {...props}
      />
      <Aide erreur={erreur} aide={aide} />
    </div>
  );
}

export function ListeDeroulante({
  libelle,
  erreur,
  aide,
  obligatoire,
  classeConteneur,
  className,
  id,
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> &
  ProprietesChamp & { options: readonly { valeur: string; libelle: string }[] }) {
  const idAuto = useId();
  const idChamp = id ?? idAuto;
  return (
    <div className={classeConteneur}>
      <Libelle htmlFor={idChamp} libelle={libelle} obligatoire={obligatoire} />
      <select
        id={idChamp}
        aria-invalid={erreur ? true : undefined}
        className={cn(CLASSE_SAISIE, "h-11 pr-8 sm:h-9", className)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.valeur} value={option.valeur}>
            {option.libelle}
          </option>
        ))}
      </select>
      <Aide erreur={erreur} aide={aide} />
    </div>
  );
}

export function CaseACocher({
  libelle,
  description,
  checked,
  onChange,
  disabled,
}: {
  libelle: string;
  description?: string;
  checked: boolean;
  onChange: (valeur: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[8px] border-[0.5px] border-trait bg-fond px-3 py-2.5 hover:border-trait-2",
        checked && "border-action/40 bg-action-fond/60",
        disabled && "pointer-events-none opacity-60",
        TRANS
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(evenement) => onChange(evenement.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-action"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-texte">{libelle}</span>
        {description ? <span className="mt-0.5 block text-[12px] text-texte-3">{description}</span> : null}
      </span>
    </label>
  );
}

/* ── Affichage ───────────────────────────────────────────────────── */

export function TitreSection({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[12px] font-medium tracking-wide text-texte-3 uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function EtatVide({ icone, titre, texte }: { icone?: React.ReactNode; titre: string; texte?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-trait px-6 py-10 text-center">
      {icone}
      <p className="mt-1 text-[13px] text-texte">{titre}</p>
      {texte ? <p className="max-w-sm text-[12px] text-texte-3">{texte}</p> : null}
    </div>
  );
}

/* ── Fenêtre modale ──────────────────────────────────────────────── */

const LARGEURS_MODALE = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-4xl",
} as const;

/** Fenêtre modale sombre ; plein écran sur mobile. */
export function Modale({
  ouverte,
  onFermer,
  titre,
  description,
  largeur = "md",
  pied,
  children,
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre: React.ReactNode;
  description?: React.ReactNode;
  largeur?: keyof typeof LARGEURS_MODALE;
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Sur téléphone, plein écran : fermer au pouce (geste retour, glisser la barre de titre vers le bas).
  useRetourFerme(ouverte, onFermer);
  const glisser = useGlisserPourFermer(onFermer, "bas");
  return (
    <Dialog open={ouverte} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <DialogContent
        showCloseButton={false}
        style={glisser.style}
        className={cn(
          "flex flex-col gap-0 overflow-clip bg-surface p-0 text-texte ring-trait",
          "max-sm:h-[100dvh] max-sm:max-w-full max-sm:rounded-none max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)] sm:max-h-[90vh] sm:rounded-[14px]",
          LARGEURS_MODALE[largeur]
        )}
      >
        <div {...glisser.gestionnaires} className="flex touch-pan-x items-start justify-between gap-4 border-b-[0.5px] border-trait px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] leading-snug font-medium text-texte">{titre}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 text-[12px] text-texte-3">{description}</DialogDescription>
            ) : null}
          </div>
          <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer" className="-mt-1 -mr-2">
            <X size={16} />
          </Bouton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pied ? <div className="border-t-[0.5px] border-trait bg-fond/60 px-5 py-3">{pied}</div> : null}
      </DialogContent>
    </Dialog>
  );
}

/* ── Choix rapides ───────────────────────────────────────────────── */

/**
 * Puces à choix unique : un motif de rejet, une catégorie de dépense… Plus
 * rapide qu'une liste déroulante au doigt, et chaque option reste lisible.
 */
export function Puces<V extends string>({
  libelle,
  options,
  valeur,
  onChange,
  obligatoire,
  erreur,
}: {
  libelle: string;
  options: readonly { valeur: V; libelle: string }[];
  valeur: V | null;
  onChange: (valeur: V) => void;
  obligatoire?: boolean;
  erreur?: string | null;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id} aria-invalid={erreur ? true : undefined}>
      <p id={id} className="mb-1.5 block text-[12px] font-medium text-texte-3">
        {libelle}
        {obligatoire ? <span className="text-action-clair"> *</span> : null}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const choisie = option.valeur === valeur;
          return (
            <button
              key={option.valeur}
              type="button"
              role="radio"
              aria-checked={choisie}
              onClick={() => onChange(option.valeur)}
              className={cn(
                "min-h-11 rounded-full border-[0.5px] px-3 text-[13px] sm:min-h-7 sm:text-[12px]",
                choisie
                  ? "border-action/60 bg-action-fond text-action-clair"
                  : "border-trait bg-fond text-texte-2 hover:border-trait-2 hover:text-texte",
                TRANS
              )}
            >
              {option.libelle}
            </button>
          );
        })}
      </div>
      {erreur ? <p className="mt-1 text-[12px] text-attention-texte">{erreur}</p> : null}
    </div>
  );
}

/* ── En-tête de page et pastilles ────────────────────────────────── */

export function EnTetePage({
  titre,
  sousTitre,
  actions,
}: {
  titre: string;
  sousTitre?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-[18px] font-medium tracking-tight text-texte">{titre}</h1>
        {sousTitre ? <p className="mt-1 text-[13px] text-texte-3">{sousTitre}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const TONS_PASTILLE = {
  neutre: "border-trait bg-surface text-texte-3",
  vert: "border-action/40 bg-action-fond text-action-clair",
  ambre: "border-attention/40 bg-attention/10 text-attention-texte",
  rouge: "border-retard/40 bg-retard/10 text-retard-texte",
  bleu: "border-info/40 bg-info/10 text-info-texte",
} as const;

export function Pastille({
  ton = "neutre",
  children,
  className,
  titre,
}: {
  ton?: keyof typeof TONS_PASTILLE;
  children: React.ReactNode;
  className?: string;
  titre?: string;
}) {
  return (
    <span
      title={titre}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONS_PASTILLE[ton],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Mission 13 (lot 6) — une page à la fois (50 par défaut) ; la page se compte à partir de 1. */
export function Pagination({ total, page, parPage = 50, onPage, feminin = false, className }: { total: number; page: number; parPage?: number; onPage: (page: number) => void; feminin?: boolean; className?: string }) {
  if (total <= parPage) return null;
  const derniere = Math.max(1, Math.ceil(total / parPage));
  return (
    <div className={cn("mt-3 flex items-center justify-between gap-2 text-[12.5px] text-texte-3", className)}>
      <span className="tabular-nums">
        {(page - 1) * parPage + 1}–{Math.min(page * parPage, total)} sur {total}
      </span>
      <span className="flex gap-1.5">
        <Bouton taille="sm" variante="fantome" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {feminin ? "Précédentes" : "Précédents"}
        </Bouton>
        <Bouton taille="sm" variante="fantome" disabled={page >= derniere} onClick={() => onPage(page + 1)}>
          {feminin ? "Suivantes" : "Suivants"}
        </Bouton>
      </span>
    </div>
  );
}

/* ── Mission 13 (lot 7) : ce qui vivait dans dossiers/_components/ui.tsx ── */

/** La carte standard des écrans, définie une fois ; `CARTE_SOMBRE` sur fond de page (Site, Publicité). */
export const CARTE = "rounded-[11px] border-[0.5px] border-trait bg-surface";
export const CARTE_SOMBRE = "rounded-[12px] border-[0.5px] border-trait bg-fond";

// Couleur de chaque étape, la même dans le kanban, la liste et le panneau
// (jetons --color-etape-1 … 9 de globals.css). Du froid au chaud à mesure
// qu'on approche de l'encaissement, l'objectif : facturé en ambre, encaissé
// dans le vert de l'action. En pause sort de la gamme, en gris neutre ;
// perdu prend le rouge (mission 22 : le rouge, c'est l'argent en retard et le perdu).
export const GRIS_HORS_PARCOURS = JETONS["texte-3"];

export const COULEURS_ETAPE: Record<EtapeDossier, string> = {
  QUALIFICATION: "var(--color-etape-1)",
  SIMULATION: "var(--color-etape-2)",
  DEVIS_ENVOYE: "var(--color-etape-3)",
  RELANCE: "var(--color-etape-4)",
  SIGNE: "var(--color-etape-5)",
  PLANIFIE: "var(--color-etape-6)",
  CHANTIER: "var(--color-etape-7)",
  FACTURE: "var(--color-etape-8)",
  ENCAISSE: "var(--color-etape-9)",
  PERDU: JETONS["retard-texte"],
  EN_PAUSE: GRIS_HORS_PARCOURS,
};

export function PastilleEtape({ etape, libelle }: { etape: EtapeDossier; libelle: string }) {
  const couleur = COULEURS_ETAPE[etape];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color: couleur, backgroundColor: teinte(couleur, 10), borderColor: teinte(couleur, 30) }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: couleur }} />
      {libelle}
    </span>
  );
}
