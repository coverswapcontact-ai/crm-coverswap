"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import type { FicheSuivi } from "@/lib/messagerie/fiche";
import type { OuEnEst } from "@/lib/messagerie/types";
import { appelApi } from "@/components/pilotage/client";
import { CarteMessage } from "@/components/messagerie/CarteMessage";
import { LignesOuEnEst, horodatage, type LigneJournalVue } from "@/components/messagerie/OuEnEst";
import { TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/**
 * Mission 25 (lot 6) — la messagerie dans la fiche dossier : « Où on en est » en tête, les messages prêts dans la
 * section Conversation, les dix dernières lignes du journal dans « Journal et historique ». Lu par
 * `GET /api/messagerie/suivi?dossierId=` (le suivi est créé s'il manque), relu quand le dossier bouge.
 */

export type SuiviDuDossier = { suiviId: string | null; ouEnEst: OuEnEst | null; journal: LigneJournalVue[]; prochaineAction: string | null; fiche: FicheSuivi | null };

/** Le suivi du dossier, relu quand `cle` change (le panneau se relit toutes les 30 s : la clé suit le dossier). */
export function useSuiviDuDossier(dossierId: string, cle: string): { suivi: SuiviDuDossier | null; recharger: () => void } {
  const [suivi, setSuivi] = useState<SuiviDuDossier | null>(null);
  const [tour, setTour] = useState(0);
  useEffect(() => {
    let actif = true;
    appelApi<SuiviDuDossier>(`/api/messagerie/suivi?dossierId=${encodeURIComponent(dossierId)}`)
      .then((lu) => {
        if (actif) setSuivi(lu);
      })
      .catch(() => {
        // la fiche reste lisible sans la messagerie ; le prochain passage réessaiera
      });
    return () => {
      actif = false;
    };
  }, [dossierId, cle, tour]);
  const recharger = useCallback(() => setTour((t) => t + 1), []);
  return { suivi, recharger };
}

export function OuEnEstFiche({ suivi }: { suivi: SuiviDuDossier | null }) {
  if (!suivi) return <div className="h-[60px] animate-pulse rounded-[10px] bg-surface-2" aria-label="Lecture de « Où on en est »" />;
  return <LignesOuEnEst ouEnEst={suivi.ouEnEst} compacte />;
}

const extrait = (texte: string, n = 60) => (texte.length > n ? `${texte.slice(0, n - 1)}…` : texte);

/** L'en-tête d'une ligne de la section Conversation : non lu, dernier message, message prêt. */
export function resumeConversation(suivi: SuiviDuDossier | null): string {
  const fiche = suivi?.fiche;
  if (!fiche) return "";
  const morceaux = [
    fiche.conversation.nonLue ? "non lu" : null,
    fiche.conversation.dernier ? `${fiche.conversation.dernier.sens === "CLIENT" ? "client" : "toi"} : « ${extrait(fiche.conversation.dernier.texte, 40)} »` : "aucun échange",
    fiche.conversation.prets.length ? `${fiche.conversation.prets.length} prêt${fiche.conversation.prets.length > 1 ? "s" : ""} à envoyer` : null,
  ];
  return morceaux.filter(Boolean).join(" · ");
}

export function ConversationFiche({ suivi, nom, onChange }: { suivi: SuiviDuDossier | null; nom: string; onChange: () => void }) {
  if (!suivi) return <p className="text-[13px] text-texte-3">Lecture de la conversation…</p>;
  const prets = suivi.fiche?.conversation.prets ?? [];
  return (
    <div className="space-y-3">
      {prets.length ? (
        prets.map((m) => <CarteMessage key={m.id} message={m} nom={nom} compacte onChange={() => onChange()} />)
      ) : (
        <p className="text-[13px] text-texte-3">Aucun message prêt à envoyer.</p>
      )}
      {suivi.suiviId ? (
        <Link href={`/messagerie?suivi=${suivi.suiviId}`} className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border-[0.5px] border-trait px-3 text-[14px] text-texte-2 hover:border-trait-2 hover:text-texte", TRANS)}>
          <MessagesSquare size={16} aria-hidden /> Ouvrir la conversation
        </Link>
      ) : null}
    </div>
  );
}

export function JournalFiche({ suivi }: { suivi: SuiviDuDossier | null }) {
  if (!suivi) return null;
  if (!suivi.journal.length) return <p className="text-[13px] text-texte-3">Le journal commence au prochain événement.</p>;
  return (
    <ol className="space-y-1.5">
      {suivi.journal.map((l, i) => (
        <li key={`${l.le}-${i}`} className="flex gap-2 text-[13px] leading-snug">
          <span className="w-[86px] shrink-0 text-texte-3 tabular-nums">{horodatage(l.le)}</span>
          <span className="min-w-0 text-texte-2">
            <span className="text-texte-3">{l.acteur === "CLIENT" ? "Client" : l.acteur === "TOI" ? "Toi" : l.acteur} · </span>
            {l.texte}
          </span>
        </li>
      ))}
    </ol>
  );
}
