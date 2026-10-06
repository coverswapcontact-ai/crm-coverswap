"use client";

import { Ban, Check, Clock, ShieldCheck, SkipForward, X } from "lucide-react";
import type { TacheVue } from "@/lib/a-faire/types";
import { dureeLisible, ligneGrise, marcheASuivre } from "@/lib/a-faire/affichage";
import { useRetourFerme } from "@/components/pilotage/fermeture-mobile";
import { Bouton, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import { BoutonPrincipal, FondBalayage, estSensible, useBalayage, valideDansLaLigne, type ActionsLigne } from "./LigneTache";

/**
 * Mission 17 (partie A) — « Commencer » : les tâches une par une, en plein écran, comme « Appels à la suite » (Leads).
 * Le titre, la raison, le bouton principal (l'action prête), puis Fait / Plus tard / Pas à faire / Passer. Une tâche
 * répondue, passée ou cochée par le CRM entre-temps sort de la série ; la suivante arrive.
 *
 * Mission 17 (partie A, relecture) : les gestes de la ligne — balayer la tâche à droite = Fait, à gauche = Plus tard
 * (une proposition sensible : à droite ouvre son aperçu) ; on quitte par « Quitter » ou le geste retour. La marche à
 * suivre d'une tâche système s'affiche ici en entier.
 */
export function ModeTaches({
  titre,
  serie,
  restantes,
  maintenant,
  occupe,
  actions,
  onPasser,
  onPasAFaire,
  onQuitter,
}: {
  titre: string;
  /** Toute la série, telle que lancée (pour « 3 sur 7 »). */
  serie: TacheVue[];
  /** Ce qui reste, dans l'ordre : la première est à l'écran. */
  restantes: TacheVue[];
  maintenant: number;
  occupe: boolean;
  actions: ActionsLigne;
  onPasser: (tache: TacheVue) => void;
  onPasAFaire: (tache: TacheVue) => void;
  onQuitter: () => void;
}) {
  const tache = restantes[0] ?? null;
  useRetourFerme(true, onQuitter);
  const rang = serie.length - restantes.length + 1;
  const valider = tache ? valideDansLaLigne(tache) : false;
  const sensible = tache ? estSensible(tache) : false;
  const marche = tache ? marcheASuivre(tache) : null;
  const balayage = useBalayage({ onDroite: () => tache && actions.onFait(tache), onGauche: () => tache && actions.onPlusTard(tache), bloque: occupe || !tache });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-fond" role="dialog" aria-label={titre}>
      <header className="flex items-center justify-between gap-3 border-b-[0.5px] border-trait px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="text-[15px] font-medium text-texte">{titre}</p>
          <p className="text-[12px] text-texte-3 tabular-nums">{tache ? `${rang} sur ${serie.length}` : "Terminé"}</p>
        </div>
        <Bouton variante="fantome" className="sm:h-11 pointer-fine:h-8" icone={<X size={16} aria-hidden />} onClick={onQuitter}>
          Quitter
        </Bouton>
      </header>

      {!tache ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[17px] font-medium text-texte">Série terminée</p>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-texte-3">Chaque tâche a reçu sa réponse ou a été passée. Ce qui a été passé reste dans la liste.</p>
          <Bouton variante="primaire" className="sm:h-11 pointer-fine:h-8" onClick={onQuitter}>
            Revenir à la liste
          </Bouton>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <FondBalayage decalage={balayage.decalage} droite={sensible ? "Relire" : valider ? "Valider" : "Fait"} />
            <div key={tache.id} {...balayage.gestionnaires} style={balayage.style} className="relative min-h-full bg-fond px-4 py-6">
              <div className="mx-auto w-full max-w-xl">
                <p className="text-[12.5px] text-texte-3 tabular-nums">environ {dureeLisible(tache.dureeMin)}</p>
                <h2 className="mt-1.5 text-[24px] leading-tight font-semibold tracking-tight break-words text-texte">{tache.titre}</h2>
                <p className="mt-1.5 text-[14.5px] leading-snug text-texte-3">{ligneGrise(tache, new Date(maintenant))}</p>
                {marche ? (
                  <div className="mt-4 rounded-[12px] border-[0.5px] border-trait bg-surface px-3.5 py-3">
                    <p className="text-[12px] font-medium tracking-wide text-texte-3 uppercase">Marche à suivre</p>
                    <p className="mt-1 text-[14.5px] leading-relaxed break-words text-texte-2">{marche}</p>
                  </div>
                ) : null}
                <div className="mt-6">
                  {valider ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={occupe} onClick={() => actions.onFait(tache)} className={cn("flex h-16 items-center justify-center gap-2 rounded-[16px] bg-action text-[18px] font-semibold text-action-texte hover:bg-action-clair disabled:opacity-50", TRANS)}>
                        <Check size={20} aria-hidden /> Valider
                      </button>
                      <button type="button" disabled={occupe} onClick={() => actions.onIgnorer(tache)} className={cn("flex h-16 items-center justify-center gap-2 rounded-[16px] border-[0.5px] border-trait text-[17px] text-texte-2 hover:border-trait-2 disabled:opacity-50", TRANS)}>
                        <X size={19} aria-hidden /> Ignorer
                      </button>
                    </div>
                  ) : (
                    <BoutonPrincipal tache={tache} actions={actions} grand />
                  )}
                </div>
                <p className="mt-5 text-center text-[12px] text-texte-3 pointer-fine:hidden">Balayer à droite : {sensible ? "relire" : "fait"} · à gauche : plus tard</p>
              </div>
            </div>
          </div>
          <footer className="border-t-[0.5px] border-trait px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto grid w-full max-w-xl grid-cols-4 gap-2">
              <button type="button" disabled={occupe} onClick={() => actions.onFait(tache)} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-[14px] border-[0.5px] border-action/50 bg-action/10 text-[13px] font-medium text-action-clair hover:bg-action/20 disabled:opacity-50", TRANS)}>
                {sensible ? (
                  <>
                    <ShieldCheck size={17} aria-hidden /> Relire
                  </>
                ) : (
                  <>
                    <Check size={17} aria-hidden /> Fait
                  </>
                )}
              </button>
              <button type="button" disabled={occupe} onClick={() => actions.onPlusTard(tache)} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-[14px] border-[0.5px] border-trait text-[13px] text-texte-2 hover:border-trait-2 disabled:opacity-50", TRANS)}>
                <Clock size={17} aria-hidden /> Plus tard
              </button>
              <button type="button" disabled={occupe} onClick={() => onPasAFaire(tache)} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-[14px] border-[0.5px] border-trait text-[13px] whitespace-nowrap text-texte-2 hover:border-trait-2 disabled:opacity-50", TRANS)}>
                <Ban size={17} aria-hidden /> Pas à faire
              </button>
              <button type="button" onClick={() => onPasser(tache)} className={cn("flex h-14 flex-col items-center justify-center gap-0.5 rounded-[14px] border-[0.5px] border-trait text-[13px] text-texte-3 hover:border-trait-2", TRANS)}>
                <SkipForward size={17} aria-hidden /> Passer
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
