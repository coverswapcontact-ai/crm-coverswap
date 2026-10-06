"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Paperclip } from "lucide-react";
import { appelApi } from "@/components/pilotage/client";
import { LecteurMessage } from "@/components/pilotage/messages/LecteurMessage";
import { EtatVide, TRANS, TitreSection } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import type { MessageResume } from "@/lib/messages/constantes";
import { cn } from "@/lib/utils";

/** Mails échangés avec le client, rangés par l'agent ou à la main. */
export function MessagesClient({ clientId }: { clientId: string }) {
  const [messages, setMessages] = useState<MessageResume[] | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let actif = true;
    appelApi<{ messages: MessageResume[] }>(`/api/messages?clientId=${clientId}&statut=TOUS&limite=30`)
      .then(({ messages: lus }) => actif && setMessages(lus))
      .catch(() => actif && setMessages([]));
    return () => {
      actif = false;
    };
  }, [clientId, version]);

  return (
    <section className="rounded-[11px] border-[0.5px] border-trait bg-surface p-4">
      <TitreSection>{`Mails${messages ? ` · ${messages.length}` : ""}`}</TitreSection>
      {messages === null ? (
        <p className="text-[12px] text-texte-3">Chargement…</p>
      ) : messages.length === 0 ? (
        <EtatVide titre="Aucun mail rangé sur cette fiche" />
      ) : (
        <ul className="-mx-2">
          {messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => setOuvert(message.id)}
                className={cn("flex min-h-11 sm:min-h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] hover:bg-surface-2", TRANS)}
              >
                {message.sens === "SORTANT" ? <ArrowUpRight size={13} aria-hidden className="shrink-0 text-info-texte" /> : null}
                <span className="min-w-0 flex-1 truncate text-texte-2">{message.objet ?? "(sans objet)"}</span>
                {message.pieces.length > 0 ? <Paperclip size={12} aria-hidden className="shrink-0 text-texte-3" /> : null}
                {message.dossier ? <span className="hidden max-w-40 shrink-0 truncate text-[12px] text-texte-3 sm:inline">{message.dossier.objet}</span> : null}
                <span className="shrink-0 text-[12px] text-texte-3">{formatDateCourte(message.recuLe)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ouvert ? <LecteurMessage key={ouvert} messageId={ouvert} onFermer={() => setOuvert(null)} onModifie={() => setVersion((valeur) => valeur + 1)} /> : null}
    </section>
  );
}
