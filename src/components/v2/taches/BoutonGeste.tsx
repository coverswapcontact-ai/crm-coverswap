"use client";

import { ArrowRight, ArrowUpRight, BellRing, CalendarDays, Check, Euro, FileText, Phone, Receipt, RotateCcw, Send, ShieldCheck, Star, WandSparkles, type LucideIcon } from "lucide-react";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import { ICONES_RACCOURCI } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { TacheVue } from "@/lib/a-faire/types";
import type { GenreGestePrincipal, GestePrincipal } from "@/lib/dossiers/geste-principal";
import { gestePret } from "@/lib/v2/geste-pret";
import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A2) — le bouton du geste prêt, rendu par la règle pure `lib/v2/geste-pret.ts` : un lien `tel:` pour
 * un appel, un lien dans un nouvel onglet pour une page externe, un bouton sinon. Deux formes : `principale` (le seul
 * bouton vert de l'écran, 56 px, plein largeur, dans la carte « Maintenant ») et `ligne` (contour, 44 px, dans une
 * ligne d'« Ensuite » : l'icône, et le libellé dès qu'il y a la place).
 * Mission 22 (A3) — `BoutonGesteBrut` (le rendu, sans règle) et `BoutonGesteDossier` (le bouton principal d'un
 * dossier, `lib/dossiers/geste-principal.ts`) : une tâche du dossier passe par `BoutonGeste`, un geste d'étape par le
 * rendu brut avec son icône. Un seul aiguillage des gestes de tâches : `useGestesTaches`.
 */
export const BOUTON_PRINCIPAL_GRAND = cn("flex h-14 w-full items-center justify-center gap-3 rounded-[11px] bg-action px-4 text-corps-tel font-semibold text-action-texte hover:bg-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:text-corps", TRANS_V2);
const BOUTON_LIGNE = cn("inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-trait-2 bg-surface px-3 text-corps font-medium whitespace-nowrap text-texte hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50", TRANS_V2);

export type FormeBouton = "principale" | "ligne";

/** Le rendu d'un geste : un lien `tel:` (`telephone`), un lien externe (`externe`), sinon un bouton. */
export function BoutonGesteBrut({ libelle, Icone, forme, href = null, telephone = null, externe = false, onClick, disabled = false, libelleVisible = true }: { libelle: string; Icone: LucideIcon; forme: FormeBouton; href?: string | null; telephone?: string | null; externe?: boolean; onClick?: () => void; disabled?: boolean; /** En forme ligne : le libellé dès qu'il y a la place (défaut) ou toujours. */ libelleVisible?: boolean }) {
  const classe = forme === "principale" ? BOUTON_PRINCIPAL_GRAND : BOUTON_LIGNE;
  const principal = forme === "principale" ? "" : undefined;
  const contenu = (
    <>
      <Icone size={forme === "principale" ? 22 : 18} aria-hidden className="shrink-0" />
      <span className={forme === "principale" || libelleVisible ? "truncate" : "hidden sm:inline"}>{libelle}</span>
    </>
  );
  if (href && telephone) {
    return (
      <a data-principal={principal} href={href} onClick={onClick} aria-label={`${libelle} (${telephone})`} title={telephone} className={classe}>
        {contenu}
      </a>
    );
  }
  if (href && externe) {
    return (
      <a data-principal={principal} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} aria-label={`${libelle} (nouvel onglet)`} title={libelle} className={classe}>
        {contenu}
      </a>
    );
  }
  return (
    <button data-principal={principal} type="button" disabled={disabled} onClick={onClick} aria-label={libelle} title={libelle} className={classe}>
      {contenu}
    </button>
  );
}

export function BoutonGeste({ tache, actions, forme, disabled = false }: { tache: TacheVue; actions: Pick<ActionsLigne, "onPrincipal" | "onAppel" | "onFait">; forme: FormeBouton; disabled?: boolean }) {
  const geste = gestePret(tache);
  const Icone = geste.forme === "FAIT" ? Check : geste.forme === "RELIRE" ? ShieldCheck : geste.genre ? (ICONES_RACCOURCI[geste.genre] ?? ArrowUpRight) : Check;
  if (geste.forme === "APPEL" && geste.href) return <BoutonGesteBrut libelle={geste.libelle} Icone={Icone} forme={forme} href={geste.href} telephone={geste.telephone} onClick={() => actions.onAppel(tache)} libelleVisible={false} />;
  if (geste.forme === "LIEN_EXTERNE" && geste.href) return <BoutonGesteBrut libelle={geste.libelle} Icone={Icone} forme={forme} href={geste.href} externe onClick={() => actions.onPrincipal(tache)} libelleVisible={false} />;
  return <BoutonGesteBrut libelle={geste.libelle} Icone={Icone} forme={forme} disabled={disabled} onClick={() => (geste.forme === "FAIT" || geste.forme === "VALIDER" ? actions.onFait(tache) : actions.onPrincipal(tache))} libelleVisible={false} />;
}

/** L'icône de chaque geste d'étape d'un dossier. */
export const ICONES_GESTE_DOSSIER: Record<Exclude<GenreGestePrincipal, "TACHE">, LucideIcon> = {
  APPEL: Phone,
  SIMULATEUR: WandSparkles,
  PUBLIER: Send,
  DEVIS: FileText,
  RELANCER: BellRing,
  DATE_CHANTIER: CalendarDays,
  ETAPE: ArrowRight,
  FACTURE: Receipt,
  ENCAISSER: Euro,
  AVIS: Star,
  REPRISE: RotateCcw,
};

/**
 * Le bouton principal d'un dossier : la tâche d'Aujourd'hui du dossier (le même bouton qu'Aujourd'hui, mêmes gestes,
 * même ligne de réponse avec « Annuler »), sinon le geste de l'étape (`onGeste`). `telephone` : pour « Appeler » et
 * « Relancer » par téléphone, le lien `tel:` (le numéro lisible en survol) ; `onAppel` note le début de l'appel.
 */
export function BoutonGesteDossier({ geste, actions, onGeste, telephone = null, onAppel, forme = "principale", disabled = false }: { geste: GestePrincipal; actions: Pick<ActionsLigne, "onPrincipal" | "onAppel" | "onFait">; onGeste: (geste: GestePrincipal) => void; telephone?: { lisible: string; href: string } | null; onAppel?: () => void; forme?: FormeBouton; disabled?: boolean }) {
  if (geste.genre === "TACHE" && geste.tache) return <BoutonGeste tache={geste.tache} actions={actions} forme={forme} disabled={disabled} />;
  if (geste.genre === "TACHE") return null;
  const Icone = ICONES_GESTE_DOSSIER[geste.genre];
  if (geste.genre === "APPEL" && telephone) return <BoutonGesteBrut libelle={geste.libelle} Icone={Icone} forme={forme} href={telephone.href} telephone={telephone.lisible} onClick={onAppel} />;
  return <BoutonGesteBrut libelle={geste.libelle} Icone={Icone} forme={forme} disabled={disabled} onClick={() => onGeste(geste)} />;
}
