"use client";

import { useState } from "react";
import { ArrowLeft, Ban, Check, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import { LIBELLES_MOTIF_PERTE, MOTIFS_PERTE, type MotifPerte } from "@/lib/dossiers/constants";
import type { EntreeReponse } from "@/lib/a-faire/reponses";
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

/**
 * Mission 17 (partie A) — les trois réponses, rien d'autre : Fait ; Plus tard (le moment, et une raison facultative
 * en un geste, dont « J'attends le client ») ; Pas à faire (la raison en un geste, adaptée au type : « Client perdu »
 * demande le motif de perte, « Autre » un texte). Une feuille en bas de l'écran ; le geste retour la ferme.
 */

export type EtapeReponse = "choix" | "plusTard" | "pasAFaire";
type Etape = EtapeReponse | "perte" | "autre" | "date";

const CLASSE_CHOIX = cn("flex min-h-12 w-full items-center gap-3 rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-4 text-left text-[15px] text-[#F2F3F5] hover:border-[#3A3E47] hover:bg-[#1C1F25] disabled:opacity-50 sm:min-h-11 sm:text-[14px]", TRANS);
const CLASSE_PUCE = (choisie: boolean) =>
  cn("min-h-11 rounded-full border-[0.5px] px-3.5 text-[13.5px] sm:min-h-8 sm:text-[12.5px]", choisie ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS);

/** Demain, heure de Paris, en AAAA-MM-JJ : la date la plus proche proposée par « Une date ». */
function demainParis(): string {
  return new Date(Date.now() + 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}

function Contenu({ tache, etapeInitiale, occupe, onRepondre }: { tache: TacheVue; etapeInitiale: EtapeReponse; occupe: boolean; onRepondre: (entree: EntreeReponse) => void }) {
  const [etape, setEtape] = useState<Etape>(etapeInitiale);
  const [raisonPlusTard, setRaisonPlusTard] = useState<RaisonPlusTard | null>(null);
  const [date, setDate] = useState("");
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState<MotifPerte | null>(null);
  const raisons = raisonsPasAFaire(tache.type);
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
      <div className="flex items-start gap-2 border-b-[0.5px] border-[#2A2D34] px-4 pt-4 pb-3">
        {retour ? (
          <button type="button" onClick={() => setEtape(retour as Etape)} aria-label="Retour" className={cn("-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#9CA3AF] hover:bg-[#22262D] sm:h-8 sm:w-8", TRANS)}>
            <ArrowLeft size={17} aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <SheetTitle className="truncate text-[15.5px] font-medium text-[#F2F3F5]">{tache.titre}</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12.5px] text-[#9CA3AF]">{titreEtape[etape]}</SheetDescription>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {etape === "choix" ? (
          <div className="grid gap-2">
            <button type="button" disabled={occupe} onClick={() => onRepondre({ reponse: "FAIT" })} className={cn(CLASSE_CHOIX, "border-[#1D9E75]/50 bg-[#112B22] text-[#5DCAA5] hover:bg-[#143528]")}>
              <Check size={18} aria-hidden /> Fait
            </button>
            <button type="button" disabled={occupe} onClick={() => setEtape("plusTard")} className={CLASSE_CHOIX}>
              <Clock size={18} aria-hidden className="text-[#F5B454]" /> Plus tard
            </button>
            <button type="button" disabled={occupe} onClick={() => setEtape("pasAFaire")} className={CLASSE_CHOIX}>
              <Ban size={18} aria-hidden className="text-[#9CA3AF]" /> Pas à faire
            </button>
          </div>
        ) : null}

        {etape === "plusTard" ? (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[12px] text-[#9CA3AF]">Pourquoi ? (facultatif)</p>
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
            <label className="block text-[12px] text-[#9CA3AF]" htmlFor="date-plus-tard">
              Elle revient ce jour-là, à 9 h
            </label>
            <input id="date-plus-tard" type="date" min={demainParis()} value={date} onChange={(e) => setDate(e.target.value)} className={cn(CLASSE_SAISIE, "h-11 sm:h-9")} />
            <button type="submit" disabled={!date || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-[#1D9E75] text-[15px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280] sm:h-10 sm:text-[14px]", TRANS)}>
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
                {raison === "CLIENT_PERDU" || raison === "AUTRE" ? <span className="ml-auto text-[12px] text-[#6B7280]">…</span> : null}
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
                <input autoFocus value={texte} onChange={(e) => setTexte(e.target.value)} maxLength={500} placeholder="Le motif, en quelques mots" aria-label="Motif de perte" className={cn(CLASSE_SAISIE, "h-11 sm:h-9")} />
                <button type="submit" disabled={texte.trim().length < 3 || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-[#1D9E75] text-[15px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280] sm:h-10 sm:text-[14px]", TRANS)}>
                  Client perdu
                </button>
              </form>
            ) : (
              <p className="text-[12px] text-[#8B919C]">{tache.dossierId ? "Le dossier passe « perdu »." : tache.leadId ? "Le contact passe « sans suite »." : ""}</p>
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
            <button type="submit" disabled={texte.trim().length < 3 || occupe} className={cn("flex h-12 w-full items-center justify-center rounded-[12px] bg-[#1D9E75] text-[15px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:bg-[#22262D] disabled:text-[#6B7280] sm:h-10 sm:text-[14px]", TRANS)}>
              Pas à faire
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function FeuilleReponse({ demande, occupe, onFermer, onRepondre }: { demande: { tache: TacheVue; etape: EtapeReponse; cle: number } | null; occupe: boolean; onFermer: () => void; onRepondre: (tache: TacheVue, entree: EntreeReponse) => void }) {
  return (
    <Sheet open={demande !== null} onOpenChange={(ouvert) => (ouvert ? undefined : onFermer())}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-0 rounded-t-[16px] border-[#2A2D34] bg-[#1C1F25] p-0 text-[#F2F3F5] sm:mx-auto sm:max-w-md">
        {demande ? <Contenu key={`${demande.tache.id}:${demande.cle}`} tache={demande.tache} etapeInitiale={demande.etape} occupe={occupe} onRepondre={(entree) => onRepondre(demande.tache, entree)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
