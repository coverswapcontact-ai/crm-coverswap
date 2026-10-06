"use client";

import { useState } from "react";
import { ArrowLeft, Ban, Check, Clock, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import { LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import type { EntreeReponse } from "@/lib/a-faire/reponses";
import { ligneGrise, marcheASuivre } from "@/lib/a-faire/affichage";
import {
  LIBELLES_QUAND,
  LIBELLES_RAISON_PAS_A_FAIRE,
  LIBELLES_RAISON_PLUS_TARD,
  QUAND_PLUS_TARD,
  RAISONS_PLUS_TARD,
  raisonsPasAFaire,
  type RaisonPasAFaire,
  type RaisonPlusTard,
  type TacheVue,
} from "@/lib/a-faire/types";
import { cn } from "@/lib/utils";
import { estSensible } from "./LigneTache";

/**
 * Mission 17 (partie A) — les trois réponses, rien d'autre : Fait ; Plus tard (le moment, et une raison facultative
 * en un geste, dont « J'attends le client ») ; Pas à faire (la raison en un geste, adaptée au type : « Client perdu »
 * demande le motif de perte, « Autre » un texte). Une feuille en bas de l'écran ; le geste retour la ferme.
 *
 * Mission 17 (partie A, relecture) : la raison en entier (et la marche à suivre d'une tâche système) en tête du choix ;
 * « Client perdu » seulement quand la tâche a un client (`aClient`) ; une proposition sensible n'a pas « Fait » mais
 * « Relire et valider » (son aperçu).
 */

export type EtapeReponse = "choix" | "plusTard" | "pasAFaire";
type Etape = EtapeReponse | "perte" | "autre" | "date";

const CLASSE_CHOIX = cn("flex min-h-12 w-full items-center gap-3 rounded-[12px] border-[0.5px] border-trait bg-fond px-4 text-left text-[15px] text-texte hover:border-trait-2 hover:bg-surface disabled:opacity-50 pointer-fine:min-h-11 sm:text-[14px]", TRANS);
const CLASSE_PUCE = (choisie: boolean) =>
  cn("min-h-11 rounded-full border-[0.5px] px-3.5 text-[13.5px] pointer-fine:min-h-8 sm:text-[12.5px]", choisie ? "border-action/60 bg-action-fond text-action-clair" : "border-trait text-texte-2 hover:border-trait-2", TRANS);

/** Demain, heure de Paris, en AAAA-MM-JJ : la date la plus proche proposée par « Une date ». */
function demainParis(): string {
  return new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

function Contenu({ tache, etapeInitiale, maintenant, occupe, onRepondre, onApercu }: { tache: TacheVue; etapeInitiale: EtapeReponse; maintenant: number; occupe: boolean; onRepondre: (entree: EntreeReponse) => void; onApercu: () => void }) {
  const [etape, setEtape] = useState<Etape>(etapeInitiale);
  const [raisonPlusTard, setRaisonPlusTard] = useState<RaisonPlusTard | null>(null);
  const [date, setDate] = useState("");
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState<MotifPerte | null>(null);
  const raisons = raisonsPasAFaire(tache.type, { aClient: tache.aClient });
  const sensible = estSensible(tache);
  const marche = marcheASuivre(tache);
  const retour = etape === "choix" ? null : etape === "perte" || etape === "autre" ? "pasAFaire" : etape === "date" ? "plusTard" : etapeInitiale === "choix" ? "choix" : null;

  const titreEtape: Record<Etape, string> = {
    choix: "Que faire de cette tâche ?",
    plusTard: "Plus tard : quand revient-elle ?",
    date: "Plus tard : à quelle date ?",
    pasAFaire: "Pas à faire : pourquoi ?",
    perte: "Client perdu : pour quelle raison ?",
    autre: "Pas à faire : en quelques mots",
  };

  return (
    <div className="flex max-h-[85dvh] flex-col">
      <div className="flex items-start gap-2 border-b-[0.5px] border-trait px-4 pt-4 pb-3">
        {retour ? (
          <button type="button" onClick={() => setEtape(retour as Etape)} aria-label="Retour" className={cn("-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-texte-3 hover:bg-surface-2 pointer-fine:h-8 pointer-fine:w-8", TRANS)}>
            <ArrowLeft size={17} aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-[15.5px] leading-snug font-medium break-words text-texte">{tache.titre}</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12.5px] text-texte-3">{titreEtape[etape]}</SheetDescription>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {etape === "choix" ? (
          <div className="grid gap-2">
            <div className="mb-1 space-y-2">
              <p className="text-[13.5px] leading-snug break-words text-texte-2">{ligneGrise(tache, new Date(maintenant))}</p>
              {marche ? (
                <div className="rounded-[12px] border-[0.5px] border-trait bg-fond px-3.5 py-2.5">
                  <p className="text-[11.5px] font-medium tracking-wide text-texte-3 uppercase">Marche à suivre</p>
                  <p className="mt-1 text-[14px] leading-relaxed break-words text-texte-2">{marche}</p>
                </div>
              ) : null}
            </div>
            {sensible ? (
              <button type="button" disabled={occupe} onClick={onApercu} className={cn(CLASSE_CHOIX, "border-action/50 bg-action-fond text-action-clair hover:bg-action-fond")}>
                <ShieldCheck size={18} aria-hidden /> Relire et valider
              </button>
            ) : (
              <button type="button" disabled={occupe} onClick={() => onRepondre({ reponse: "FAIT" })} className={cn(CLASSE_CHOIX, "border-action/50 bg-action-fond text-action-clair hover:bg-action-fond")}>
                <Check size={18} aria-hidden /> Fait
              </button>
            )}
            <button type="button" disabled={occupe} onClick={() => setEtape("plusTard")} className={CLASSE_CHOIX}>
              <Clock size={18} aria-hidden className="text-attention-texte" /> Plus tard
            </button>
            <button type="button" disabled={occupe} onClick={() => setEtape("pasAFaire")} className={CLASSE_CHOIX}>
              <Ban size={18} aria-hidden className="text-texte-3" /> Pas à faire
            </button>
          </div>
        ) : null}

        {etape === "plusTard" ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[12px] text-texte-3">Pourquoi ? (facultatif)</p>
              <div className="flex flex-wrap gap-1.5">
                {RAISONS_PLUS_TARD.map((r) => (
                  <button key={r} type="button" aria-pressed={raisonPlusTard === r} onClick={() => setRaisonPlusTard((actuelle) => (actuelle === r ? null : r))} className={CLASSE_PUCE(raisonPlusTard === r)}>
                    {LIBELLES_RAISON_PLUS_TARD[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUAND_PLUS_TARD.map((quand) => (
                <button key={quand} type="button" disabled={occupe} onClick={() => onRepondre({ reponse: "PLUS_TARD", quand, ...(raisonPlusTard ? { raison: raisonPlusTard } : {}) })} className={cn(CLASSE_CHOIX, "justify-center")}>
                  {LIBELLES_QUAND[quand]}
                </button>
              ))}
              <button type="button" disabled={occupe} onClick={() => setEtape("date")} className={cn(CLASSE_CHOIX, "col-span-2 justify-center")}>
                Une date…
              </button>
            </div>
          </div>
        ) : null}

        {etape === "date" ? (
          <form
            className="space-y-3"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              if (date) onRepondre({ reponse: "PLUS_TARD", date, ...(raisonPlusTard ? { raison: raisonPlusTard } : {}) });
            }}
          >
            <label className="block text-[12px] text-texte-3" htmlFor="date-plus-tard">
              Elle revient ce jour-là, à 9 h
            </label>
            <input id="date-plus-tard" type="date" min={demainParis()} value={date} onChange={(e) => setDate(e.target.value)} className={cn(CLASSE_SAISIE, "h-11 pointer-fine:h-9")} />
            <button type="submit" disabled={!date || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-action text-[15px] font-semibold text-action-texte hover:bg-action-clair disabled:bg-surface-2 disabled:text-texte-3 pointer-fine:h-10 sm:text-[14px]", TRANS)}>
              Reporter
            </button>
          </form>
        ) : null}

        {etape === "pasAFaire" ? (
          <div className="grid gap-2">
            {raisons.map((raison: RaisonPasAFaire) => (
              <button
                key={raison}
                type="button"
                disabled={occupe}
                onClick={() => {
                  if (raison === "CLIENT_PERDU") setEtape("perte");
                  else if (raison === "AUTRE") setEtape("autre");
                  else onRepondre({ reponse: "PAS_A_FAIRE", raison });
                }}
                className={CLASSE_CHOIX}
              >
                {LIBELLES_RAISON_PAS_A_FAIRE[raison]}
                {raison === "CLIENT_PERDU" || raison === "AUTRE" ? <span className="ml-auto text-[12px] text-texte-3">…</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {etape === "perte" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {MOTIFS_PERTE.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={occupe}
                  aria-pressed={motif === m}
                  onClick={() => {
                    if (m === "AUTRE") setMotif("AUTRE");
                    else onRepondre({ reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", motifPerte: m });
                  }}
                  className={CLASSE_PUCE(motif === m)}
                >
                  {LIBELLES_MOTIF_PERTE[m]}
                </button>
              ))}
            </div>
            {motif === "AUTRE" ? (
              <form
                className="space-y-2"
                onSubmit={(evenement) => {
                  evenement.preventDefault();
                  if (texte.trim().length >= 3) onRepondre({ reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", motifPerte: "AUTRE", precisionPerte: texte.trim() });
                }}
              >
                <input autoFocus value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={500} placeholder="Le motif, en quelques mots" aria-label="Motif de perte" className={cn(CLASSE_SAISIE, "h-11 pointer-fine:h-9")} />
                <button type="submit" disabled={texte.trim().length < 3 || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-action text-[15px] font-semibold text-action-texte hover:bg-action-clair disabled:bg-surface-2 disabled:text-texte-3 pointer-fine:h-10 sm:text-[14px]", TRANS)}>
                  Client perdu
                </button>
              </form>
            ) : (
              <p className="text-[12px] text-texte-3">{tache.dossierId ? "Le dossier passe « perdu »." : tache.leadId ? "Le contact passe « sans suite »." : ""}</p>
            )}
          </div>
        ) : null}

        {etape === "autre" ? (
          <form
            className="space-y-2"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              if (texte.trim().length >= 3) onRepondre({ reponse: "PAS_A_FAIRE", raison: "AUTRE", texte: texte.trim() });
            }}
          >
            <textarea autoFocus value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} maxLength={500} placeholder="Pourquoi elle n'est pas à faire" aria-label="Raison" className={cn(CLASSE_SAISIE, "resize-none py-2 leading-relaxed")} />
            <button type="submit" disabled={texte.trim().length < 3 || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-action text-[15px] font-semibold text-action-texte hover:bg-action-clair disabled:bg-surface-2 disabled:text-texte-3 pointer-fine:h-10 sm:text-[14px]", TRANS)}>
              Pas à faire
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function FeuilleReponse({
  demande,
  maintenant,
  occupe,
  onFermer,
  onRepondre,
  onApercu,
}: {
  demande: { tache: TacheVue; etape: EtapeReponse; cle: number } | null;
  maintenant: number;
  occupe: boolean;
  onFermer: () => void;
  onRepondre: (tache: TacheVue, entree: EntreeReponse) => void;
  /** Une proposition sensible : son aperçu (à la place de « Fait »). */
  onApercu: (tache: TacheVue) => void;
}) {
  return (
    <Sheet open={demande !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-0 rounded-t-[16px] border-trait bg-surface p-0 text-texte sm:mx-auto sm:max-w-md">
        {demande ? <Contenu key={`${demande.tache.id}:${demande.cle}`} tache={demande.tache} etapeInitiale={demande.etape} maintenant={maintenant} occupe={occupe} onRepondre={(entree) => onRepondre(demande.tache, entree)} onApercu={() => onApercu(demande.tache)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
