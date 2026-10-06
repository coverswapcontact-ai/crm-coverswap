"use client";

import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import { ICONES_RACCOURCI } from "@/app/(pilotage)/taches/_components/LigneTache";
import type { TacheVue } from "@/lib/a-faire/types";
import { gestePret } from "@/lib/v2/geste-pret";
import { cn } from "@/lib/utils";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A2) — le bouton du geste prêt, rendu par la règle pure `lib/v2/geste-pret.ts` : un lien `tel:` pour
 * un appel, un lien dans un nouvel onglet pour une page externe, un bouton sinon. Deux formes : `principale` (le seul
 * bouton vert de l'écran, 56 px, plein largeur, dans la carte « Maintenant ») et `ligne` (contour, 44 px, dans une
 * ligne d'« Ensuite » : l'icône, et le libellé dès qu'il y a la place).
 */
export const BOUTON_PRINCIPAL_GRAND = cn("flex h-14 w-full items-center justify-center gap-3 rounded-[11px] bg-action px-4 text-corps-tel font-semibold text-action-texte hover:bg-action-clair focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:text-corps", TRANS_V2);
const BOUTON_LIGNE = cn("inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-trait-2 bg-surface px-3 text-corps font-medium whitespace-nowrap text-texte hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50", TRANS_V2);

export function BoutonGeste({ tache, actions, forme, disabled = false }: { tache: TacheVue; actions: Pick<ActionsLigne, "onPrincipal" | "onAppel" | "onFait">; forme: "principale" | "ligne"; disabled?: boolean }) {
  const geste = gestePret(tache);
  const Icone = geste.forme === "FAIT" ? Check : geste.forme === "RELIRE" ? ShieldCheck : geste.genre ? (ICONES_RACCOURCI[geste.genre] ?? ArrowUpRight) : Check;
  const classe = forme === "principale" ? BOUTON_PRINCIPAL_GRAND : BOUTON_LIGNE;
  const contenu = (
    <>
      <Icone size={forme === "principale" ? 22 : 18} aria-hidden className="shrink-0" />
      <span className={forme === "principale" ? "truncate" : "hidden sm:inline"}>{geste.libelle}</span>
    </>
  );
  if (geste.forme === "APPEL" && geste.href) {
    return (
      <a data-principal={forme === "principale" ? "" : undefined} href={geste.href} onClick={() => actions.onAppel(tache)} aria-label={`${geste.libelle} (${geste.telephone})`} title={geste.telephone ?? undefined} className={classe}>
        {contenu}
      </a>
    );
  }
  if (geste.forme === "LIEN_EXTERNE" && geste.href) {
    return (
      <a data-principal={forme === "principale" ? "" : undefined} href={geste.href} target="_blank" rel="noopener noreferrer" onClick={() => actions.onPrincipal(tache)} aria-label={`${geste.libelle} (nouvel onglet)`} title={geste.libelle} className={classe}>
        {contenu}
      </a>
    );
  }
  return (
    <button data-principal={forme === "principale" ? "" : undefined} type="button" disabled={disabled} onClick={() => (geste.forme === "FAIT" || geste.forme === "VALIDER" ? actions.onFait(tache) : actions.onPrincipal(tache))} aria-label={geste.libelle} title={geste.libelle} className={classe}>
      {contenu}
    </button>
  );
}
