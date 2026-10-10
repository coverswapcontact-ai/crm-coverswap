"use client";

import { useState } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { OuEnEst } from "@/lib/messagerie/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";
import { TRANS } from "@/components/pilotage/ui";

/**
 * Mission 25 — « Où on en est » : trois lignes (📍 situation, 👤 client, ➡️ suite), lisibles en deux secondes, en tête
 * de la conversation, de la fiche dossier et des cartes « Un par un ». Une ligne se corrige à la main : la correction
 * reste jusqu'au prochain fait nouveau. Sous les trois lignes, les dix dernières lignes du journal (repliées).
 */

export type LigneJournalVue = { le: string; acteur: string; texte: string };

const ACTEURS: Record<string, string> = { CLIENT: "Client", TOI: "Toi", IA: "IA", CRM: "CRM" };

export const horodatage = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}`;
};

export function LignesOuEnEst({ ouEnEst, compacte = false }: { ouEnEst: OuEnEst | null; compacte?: boolean }) {
  if (!ouEnEst) return <p className="text-[14px] text-texte-3">Pas encore lu par la messagerie.</p>;
  const lignes = [
    { icone: "📍", texte: ouEnEst.situation, etiquette: "Situation" },
    { icone: "👤", texte: ouEnEst.client, etiquette: "Client" },
    { icone: "➡️", texte: ouEnEst.suite, etiquette: "Suite" },
  ].filter((l) => l.texte);
  return (
    <ul className={cn("space-y-1", compacte ? "text-[14px]" : "text-[15px]")} aria-label="Où on en est">
      {lignes.map((l) => (
        <li key={l.etiquette} className="flex gap-2 leading-snug">
          <span aria-hidden className="shrink-0">
            {l.icone}
          </span>
          <span className="sr-only">{l.etiquette} : </span>
          <span className={cn(l.etiquette === "Suite" ? "font-medium text-texte" : "text-texte-2")}>{l.texte}</span>
        </li>
      ))}
    </ul>
  );
}

export function OuEnEstEtJournal({
  suiviId,
  ouEnEst,
  journal,
  lienHistorique,
  onCorrige,
}: {
  suiviId: string;
  ouEnEst: OuEnEst | null;
  journal: LigneJournalVue[];
  lienHistorique?: string | null;
  onCorrige?: (ouEnEst: OuEnEst) => void;
}) {
  const [journalOuvert, setJournalOuvert] = useState(false);
  const [edition, setEdition] = useState(false);
  const [lignes, setLignes] = useState({ situation: ouEnEst?.situation ?? "", client: ouEnEst?.client ?? "", suite: ouEnEst?.suite ?? "" });
  const [occupe, setOccupe] = useState(false);

  async function enregistrer() {
    setOccupe(true);
    try {
      const { ouEnEst: corrige } = await envoyerJson<{ ouEnEst: OuEnEst }>(`/api/messagerie/conversations/${suiviId}`, "POST", { action: "ou-en-est", ...lignes });
      toast.success("Corrigé : gardé jusqu'au prochain fait nouveau");
      setEdition(false);
      onCorrige?.(corrige);
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className="rounded-[12px] border-[0.5px] border-trait bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[13px] font-medium text-texte-3">Où on en est</h2>
        {!edition ? (
          <button type="button" onClick={() => setEdition(true)} aria-label="Corriger « Où on en est »" className={cn("-mt-2 -mr-2 flex h-11 w-11 items-center justify-center rounded-[10px] text-texte-3 hover:text-texte", TRANS)}>
            <Pencil size={15} aria-hidden />
          </button>
        ) : null}
      </div>
      {edition ? (
        <div className="mt-1 space-y-2">
          {(["situation", "client", "suite"] as const).map((cle) => (
            <label key={cle} className="block">
              <span className="text-[12px] text-texte-3">{cle === "situation" ? "📍 Situation" : cle === "client" ? "👤 Client" : "➡️ Suite"}</span>
              <input
                value={lignes[cle]}
                maxLength={120}
                onChange={(e) => setLignes((l) => ({ ...l, [cle]: e.target.value }))}
                className="mt-0.5 w-full rounded-[10px] border-[0.5px] border-trait bg-fond px-3 py-2.5 text-[16px] text-texte focus:border-action focus:outline-none"
              />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEdition(false)} className={cn("min-h-[44px] rounded-[10px] border-[0.5px] border-trait text-[14px] text-texte-2", TRANS)}>
              Annuler
            </button>
            <button type="button" disabled={occupe} onClick={enregistrer} className={cn("min-h-[44px] rounded-[10px] bg-action text-[14px] font-semibold text-action-texte hover:bg-action-clair", TRANS)}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <LignesOuEnEst ouEnEst={ouEnEst} />
      )}
      {journal.length ? (
        <div className="mt-2 border-t-[0.5px] border-trait pt-1">
          <button type="button" onClick={() => setJournalOuvert((o) => !o)} aria-expanded={journalOuvert} className={cn("flex min-h-[44px] w-full items-center justify-between text-[13px] text-texte-3 hover:text-texte", TRANS)}>
            Journal ({journal.length} {journal.length > 1 ? "dernières lignes" : "ligne"})
            <ChevronDown size={16} aria-hidden className={cn("transition-transform duration-150", journalOuvert && "rotate-180")} />
          </button>
          {journalOuvert ? (
            <ol className="space-y-1 pb-1">
              {journal.map((l, i) => (
                <li key={`${l.le}-${i}`} className="text-[13px] leading-snug text-texte-2">
                  <span className="text-texte-3 tabular-nums">{horodatage(l.le)}</span> · <span className="text-texte-3">{ACTEURS[l.acteur] ?? l.acteur}</span> · {l.texte}
                </li>
              ))}
              {lienHistorique ? (
                <li>
                  <a href={lienHistorique} className="inline-flex min-h-[44px] items-center text-[13px] text-action-clair hover:underline">
                    Voir tout l&apos;historique
                  </a>
                </li>
              ) : null}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
