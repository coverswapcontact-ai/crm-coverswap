"use client";

import { useState } from "react";
import { ArrowRightLeft, Ban, Euro, FileText, Landmark, Mail, MessageSquare, Phone, StickyNote, Undo2 } from "lucide-react";
import { LecteurMessage } from "@/components/pilotage/messages/LecteurMessage";
import { LIBELLES_TYPE_EVENEMENT, type TypeEvenement } from "@/lib/dossiers/constants";
import { formatDateCourte, formatHorodatage } from "@/lib/dossiers/dates";
import type { EvenementVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { Bouton, TRANS } from "@/components/pilotage/ui";

/* ── Historique ──────────────────────────────────────────────────── */

const ICONES_EVENEMENT: Partial<Record<TypeEvenement, typeof FileText>> = {
  CHANGEMENT_ETAPE: ArrowRightLeft,
  DEVIS_GENERE: FileText,
  FACTURE_GENEREE: FileText,
  AVOIR_GENERE: FileText,
  DEVIS_ENVOYE: FileText,
  ENCAISSEMENT_ENREGISTRE: Euro,
  ENCAISSEMENT_CREDITE: Landmark,
  ENCAISSEMENT_REJETE: Ban,
  ENCAISSEMENT_ANNULE: Undo2,
  NOTE_AJOUTEE: StickyNote,
  APPEL: Phone,
  MAIL_RECU: Mail,
  MAIL_ENVOYE: Mail,
};

/** Mission 13 (lot 7) — l'historique du dossier, replié à vingt lignes ; extrait de PanneauDossier. */

export function HistoriqueEvenements({ evenements, onRecharger }: { evenements: EvenementVue[]; onRecharger: () => Promise<void> }) {
  const [tout, setTout] = useState(false);
  const [mail, setMail] = useState<string | null>(null);
  const liste = tout ? evenements : evenements.slice(0, 20);

  return (
    <div>
      {evenements.length === 0 ? <p className="mt-2 text-[12.5px] text-[#6B7280]">Rien encore.</p> : null}
      {evenements.length > 0 ? (
        <ol className="mt-3 space-y-3">
          {liste.map((evenement) => {
            const Icone = ICONES_EVENEMENT[evenement.type] ?? MessageSquare;
            return (
              <li key={evenement.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
                  <Icone size={12} className="text-[#9CA3AF]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] break-words text-[#D1D5DB]">{evenement.contenu}</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280]">
                    {LIBELLES_TYPE_EVENEMENT[evenement.type] ?? "Événement"} ·{" "}
                    {evenement.saisiLe ? `${formatDateCourte(evenement.date)} (saisi le ${formatDateCourte(evenement.saisiLe)})` : formatHorodatage(evenement.date)}
                    {evenement.messageId ? (
                      <>
                        {" · "}
                        <button type="button" onClick={() => setMail(evenement.messageId)} className={cn("text-[#9CA3AF] underline-offset-2 hover:text-[#F2F3F5] hover:underline", TRANS)}>
                          Lire le mail
                        </button>
                      </>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
          {!tout && evenements.length > liste.length ? (
            <li>
              <Bouton variante="fantome" taille="sm" onClick={() => setTout(true)}>
                Voir les {evenements.length - liste.length} plus anciens
              </Bouton>
            </li>
          ) : null}
        </ol>
      ) : null}
      {mail ? <LecteurMessage key={mail} messageId={mail} onFermer={() => setMail(null)} onModifie={() => void onRecharger()} /> : null}
    </div>
  );
}
