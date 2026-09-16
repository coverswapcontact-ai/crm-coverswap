"use client";

import { useId } from "react";
import { Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EtapeDossier } from "@/lib/dossiers/constants";

// Primitives du module Dossiers, sur la charte sombre de /prospection.

// Transition unique du module : 150 ms ease (cf. /prospection)
export const TRANS = "transition-colors duration-150 ease-[ease]";

// Couleur de chaque étape, la même dans le kanban, la liste et le panneau.
// Du froid au chaud à mesure qu'on approche de l'encaissement, l'objectif ;
// perdu et en pause sortent de la gamme, en gris neutre. Le rouge reste
// réservé au retard.
export const GRIS_HORS_PARCOURS = "#8B919C";

export const COULEURS_ETAPE: Record<EtapeDossier, string> = {
  QUALIFICATION: "#818CF8",
  SIMULATION: "#60A5FA",
  DEVIS_ENVOYE: "#22D3EE",
  RELANCE: "#2DD4BF",
  SIGNE: "#4ADE80",
  PLANIFIE: "#A3E635",
  CHANTIER: "#FDE047",
  FACTURE: "#FBBF24",
  ENCAISSE: "#F97316",
  PERDU: GRIS_HORS_PARCOURS,
  EN_PAUSE: GRIS_HORS_PARCOURS,
};

/* ── Boutons ─────────────────────────────────────────────────────── */

const VARIANTES = {
  primaire: "bg-[#1D9E75] text-[#0B1612] hover:bg-[#5DCAA5]",
  secondaire:
    "border-[0.5px] border-[#2A2D34] bg-[#1C1F25] text-[#F2F3F5] hover:border-[#3A3E47] hover:bg-[#22262D]",
  fantome: "text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]",
  danger: "border-[0.5px] border-[#EF4444]/30 bg-[#EF4444]/10 text-[#F87171] hover:bg-[#EF4444]/20",
} as const;

const TAILLES = {
  sm: "h-8 px-2.5 text-[12px] sm:h-7",
  md: "h-10 px-3.5 text-[13px] sm:h-8",
  icone: "h-10 w-10 sm:h-8 sm:w-8",
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
        "focus-visible:ring-2 focus-visible:ring-[#1D9E75]/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        TRANS,
        TAILLES[taille],
        VARIANTES[variante],
        className
      )}
      {...props}
    >
      {chargement ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
}

/* ── Champs ──────────────────────────────────────────────────────── */

// 16 px sur mobile : en dessous, Safari iOS zoome sur le champ au focus.
export const CLASSE_SAISIE = cn(
  "w-full rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 text-[16px] text-[#F2F3F5] sm:text-[13px]",
  "placeholder:text-[#6B7280] hover:border-[#3A3E47] focus:border-[#1D9E75]/60 focus:ring-2 focus:ring-[#1D9E75]/20 focus:outline-none",
  "disabled:opacity-60 aria-invalid:border-[#EF4444]/60 [color-scheme:dark]",
  TRANS
);

function Libelle({ htmlFor, libelle, obligatoire }: { htmlFor: string; libelle: string; obligatoire?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
      {libelle}
      {obligatoire ? <span className="text-[#5DCAA5]"> *</span> : null}
    </label>
  );
}

function Aide({ erreur, aide }: { erreur?: string | null; aide?: string }) {
  if (erreur) return <p className="mt-1 text-[12px] text-[#F87171]">{erreur}</p>;
  if (aide) return <p className="mt-1 text-[12px] text-[#6B7280]">{aide}</p>;
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
        className={cn(CLASSE_SAISIE, "h-10 sm:h-9", className)}
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
        className={cn(CLASSE_SAISIE, "h-10 pr-8 sm:h-9", className)}
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
        "flex cursor-pointer items-start gap-3 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 py-2.5 hover:border-[#3A3E47]",
        checked && "border-[#1D9E75]/40 bg-[#112B22]/60",
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
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#1D9E75]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-[#F2F3F5]">{libelle}</span>
        {description ? <span className="mt-0.5 block text-[12px] text-[#6B7280]">{description}</span> : null}
      </span>
    </label>
  );
}

/* ── Affichage ───────────────────────────────────────────────────── */

export function PastilleEtape({ etape, libelle }: { etape: EtapeDossier; libelle: string }) {
  const couleur = COULEURS_ETAPE[etape];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      // Suffixes hexadécimaux d'opacité : 1A ≈ 10 %, 4D ≈ 30 %.
      style={{ color: couleur, backgroundColor: `${couleur}1A`, borderColor: `${couleur}4D` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: couleur }} />
      {libelle}
    </span>
  );
}

export function TitreSection({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function EtatVide({ icone, titre, texte }: { icone?: React.ReactNode; titre: string; texte?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-[#2A2D34] px-6 py-10 text-center">
      {icone}
      <p className="mt-1 text-[13px] text-[#F2F3F5]">{titre}</p>
      {texte ? <p className="max-w-sm text-[12px] text-[#6B7280]">{texte}</p> : null}
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
  return (
    <Dialog open={ouverte} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-clip bg-[#1C1F25] p-0 text-[#F2F3F5] ring-[#2A2D34]",
          "max-sm:h-[100dvh] max-sm:max-w-full max-sm:rounded-none sm:max-h-[90vh] sm:rounded-[14px]",
          LARGEURS_MODALE[largeur]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b-[0.5px] border-[#2A2D34] px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] leading-snug font-medium text-[#F2F3F5]">{titre}</DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 text-[12px] text-[#9CA3AF]">{description}</DialogDescription>
            ) : null}
          </div>
          <Bouton variante="fantome" taille="icone" onClick={onFermer} aria-label="Fermer" className="-mt-1 -mr-2">
            <X size={16} />
          </Bouton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pied ? <div className="border-t-[0.5px] border-[#2A2D34] bg-[#16181D]/60 px-5 py-3">{pied}</div> : null}
      </DialogContent>
    </Dialog>
  );
}
