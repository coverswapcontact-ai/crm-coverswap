"use client";

import { useRouter } from "next/navigation";
import type { ActionsLigne } from "@/app/(pilotage)/taches/_components/LigneTache";
import { COULEURS_ETAPE } from "@/components/pilotage/ui";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import type { GestePrincipal } from "@/lib/dossiers/geste-principal";
import type { DossierResume } from "@/lib/dossiers/types";
import { dateExacte } from "@/lib/v2/dates";
import { couleurBarre, demandePourGeste, gesteDeLaLigne, telephoneComposable, type CouleurBarre, type DemandeOuvertureV2 } from "@/lib/v2/dossiers";
import { situationDe } from "@/lib/v2/situation";
import { cn } from "@/lib/utils";
import { BoutonGesteDossier } from "../taches/BoutonGeste";
import { LIGNE_V2 } from "../liste/Troncature";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A4) — une ligne de la liste Dossiers v2 : la barre de couleur à gauche (vert = chez moi, gris = chez le
 * client, rouge = argent en retard ou perdu), les trois lignes de situation au même format que l'en-tête du panneau
 * (`lib/v2/situation.ts` : qui / quoi · où en est-on depuis quand · prochaine action), et le bouton du geste principal
 * (`lib/dossiers/geste-principal.ts`, en contour : le vert reste au panneau). Toucher la ligne ouvre le panneau.
 * « Appeler » compose directement (le début d'appel est noté), « Préparer la simulation » va au simulateur ; les autres
 * gestes ouvrent le panneau avec la demande qui les lance (`demandePourGeste`). Deux tailles de texte ; aucun badge.
 */
const BARRE: Record<CouleurBarre, string> = { MOI: "bg-action-clair", CLIENT: "bg-texte-3", ROUGE: "bg-retard" };
const LEGENDE: Record<CouleurBarre, string> = { MOI: "chez moi", CLIENT: "chez le client", ROUGE: "argent en retard ou dossier perdu" };

/** Aucune tâche n'est connue sur une ligne : le bouton n'a jamais à répondre à une tâche. */
const SANS_TACHE: Pick<ActionsLigne, "onPrincipal" | "onAppel" | "onFait"> = { onPrincipal: () => undefined, onAppel: () => undefined, onFait: () => undefined };

export function LigneDossierV2({ dossier, maintenant, onOuvrir }: { dossier: DossierResume; maintenant: Date; onOuvrir: (id: string, demande?: Omit<DemandeOuvertureV2, "cle"> | null) => void }) {
  const routeur = useRouter();
  const lignes = situationDe(dossier, dossier.espace, maintenant);
  const barre = couleurBarre(dossier, maintenant);
  const geste = gesteDeLaLigne(dossier, maintenant);
  const telephone = telephoneComposable(dossier.clientTelephone);

  function executer(g: GestePrincipal) {
    if (g.genre === "SIMULATEUR") return routeur.push(`/simulateur?dossier=${encodeURIComponent(dossier.id)}`);
    onOuvrir(dossier.id, demandePourGeste(g));
  }

  return (
    <li data-dossier={dossier.id} className={cn(LIGNE_V2, "flex items-stretch")}>
      <span aria-hidden className={cn("w-1 shrink-0", BARRE[barre])} title={LEGENDE[barre]} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-2 pr-3 sm:flex-row sm:items-center">
        <button type="button" onClick={() => onOuvrir(dossier.id)} aria-label={`Ouvrir le dossier : ${lignes.quiQuoi}`} className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[8px] px-3 py-1 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", TRANS_V2)}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-corps-tel font-medium text-texte md:text-corps">{lignes.quiQuoi}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-petit text-texte-3">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: COULEURS_ETAPE[dossier.etape] }} />
              {lignes.etape}
            </span>
          </span>
          <span title={dossier.mainLe ? dateExacte(dossier.mainLe) : undefined} className="line-clamp-2 text-corps-tel leading-snug break-words text-texte-2 md:text-corps">
            {lignes.situation}
          </span>
          <span title={dossier.prochaineActionDate ? dateExacte(dossier.prochaineActionDate) : undefined} className="truncate text-petit text-texte-3">
            {lignes.prochaineAction}
          </span>
        </button>
        <div className="flex shrink-0 justify-end pl-3 sm:pl-0">
          <BoutonGesteDossier geste={geste} actions={SANS_TACHE} onGeste={executer} telephone={telephone} onAppel={() => noterDebutAppel(`dossier:${dossier.id}`, { nom: dossier.clientNom, dossierId: dossier.id })} forme="ligne" />
        </div>
      </div>
    </li>
  );
}
