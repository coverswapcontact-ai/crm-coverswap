"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Phone } from "lucide-react";
import type { CarteUnParUn } from "@/lib/messagerie/vues";
import { cn } from "@/lib/utils";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { noterDebutAppel } from "@/components/pilotage/NotesAppel";
import { TRANS } from "@/components/pilotage/ui";
import { BOUTON_PRINCIPAL, BOUTON_SECONDAIRE_M, CarteMessage } from "./CarteMessage";
import { LignesOuEnEst } from "./OuEnEst";

/**
 * Mission 25 — le mode « Un par un » : une carte à la fois, dans l'ordre (réponses des clients, messages dont l'heure
 * est passée, appels à passer, propositions à valider). Chaque carte : le nom, « Où on en est », l'action, trois
 * boutons au plus. Quand la file est vide, l'écran le dit. Lucas n'a jamais à décider par où commencer.
 */

type File = { cartes: CarteUnParUn[]; compteurs: Record<CarteUnParUn["genre"], number>; pause: boolean };

const TITRES: Record<CarteUnParUn["genre"], string> = { REPONSE: "Réponse à traiter", MESSAGE: "Message à envoyer", APPEL: "Appel à passer", PROPOSITION: "À valider" };

export function UnParUn({ onFermer, onOuvrirConversation }: { onFermer: () => void; onOuvrirConversation: (suiviId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [vues, setVues] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setFile(await appelApi<File>("/api/messagerie/file"));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => void charger(), 0);
    return () => window.clearTimeout(id);
  }, [charger]);

  const restantes = (file?.cartes ?? []).filter((c) => !vues.has(c.cle));
  const carte = restantes[0] ?? null;
  const passer = (cle: string) => setVues((v) => new Set(v).add(cle));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b-[0.5px] border-trait px-3 py-2">
        <button type="button" onClick={onFermer} aria-label="Retour" className={cn("flex h-11 w-11 items-center justify-center rounded-[10px] text-texte-2 hover:text-texte", TRANS)}>
          <ArrowLeft size={20} aria-hidden />
        </button>
        <h2 className="flex-1 text-[18px] font-semibold text-texte">Un par un</h2>
        {file ? <p className="text-[13px] text-texte-3 tabular-nums">{restantes.length} à faire</p> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {erreur ? <p className="text-[14px] text-retard-texte">{erreur}</p> : null}
        {!file && !erreur ? <p className="text-[14px] text-texte-3">Chargement…</p> : null}
        {file?.pause ? <p className="mb-3 rounded-[10px] bg-surface-2 p-3 text-[14px] text-attention-texte">La messagerie est en pause : rien n&apos;est préparé.</p> : null}
        {file && !carte ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-action-fond text-action-clair">
              <Check size={28} aria-hidden />
            </span>
            <p className="text-[18px] font-semibold text-texte">Tout est traité pour aujourd&apos;hui.</p>
            <p className="text-[14px] text-texte-3">Rien d&apos;autre ne t&apos;attend pour l&apos;instant.</p>
            <button type="button" onClick={onFermer} className={BOUTON_SECONDAIRE_M}>
              Revenir à la liste
            </button>
          </div>
        ) : null}
        {carte ? (
          <article key={carte.cle} className="space-y-3 rounded-[16px] border-[0.5px] border-trait bg-surface p-4">
            <p className="text-[12.5px] font-medium text-action-clair">{TITRES[carte.genre]}</p>
            <button type="button" onClick={() => onOuvrirConversation(carte.suiviId)} className="flex w-full items-center gap-1 text-left text-[20px] font-semibold text-texte hover:underline">
              <span className="min-w-0 flex-1 truncate">{carte.nom}</span>
              <ChevronRight size={18} aria-hidden className="shrink-0 text-texte-3" />
            </button>
            <LignesOuEnEst ouEnEst={carte.ouEnEst} compacte />
            {carte.dernierMessageClient ? (
              <blockquote className="rounded-[14px] rounded-bl-[6px] bg-surface-2 px-3 py-2 text-[15px] text-texte">« {carte.dernierMessageClient.texte} »</blockquote>
            ) : null}
            {carte.message ? (
              <CarteMessage
                message={carte.message}
                nom={carte.nom}
                onChange={(relu) => {
                  if (!relu || relu.statut === "PREVU") passer(carte.cle);
                }}
              />
            ) : carte.genre === "APPEL" && carte.telephone ? (
              <>
                <p className="text-[14px] text-texte-2">{carte.raison}</p>
                <a href={`tel:${carte.telephone}`} onClick={() => noterDebutAppel(carte.leadId ?? `dossier:${carte.dossierId}`, { nom: carte.nom, dossierId: carte.dossierId })} className={BOUTON_PRINCIPAL}>
                  <Phone size={18} aria-hidden /> Appeler
                </a>
              </>
            ) : (
              <>
                <p className="text-[14px] text-texte-2">{carte.raison}</p>
                <button type="button" onClick={() => onOuvrirConversation(carte.suiviId)} className={BOUTON_PRINCIPAL}>
                  Ouvrir la conversation
                </button>
              </>
            )}
            <button type="button" onClick={() => passer(carte.cle)} className={cn(BOUTON_SECONDAIRE_M, "w-full")}>
              Passer à la suivante
            </button>
          </article>
        ) : null}
      </div>
    </div>
  );
}
