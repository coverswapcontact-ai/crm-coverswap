"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { CLASSE_SAISIE, TRANS } from "@/components/pilotage/ui";
import { mesurerSms } from "@/lib/sms/texte";
import { cn } from "@/lib/utils";

/**
 * Les SMS que le CRM propose (relance photos, devis sans réponse, « j'ai essayé
 * de vous joindre »…) se relisent ICI, dans la conversation concernée : l'écran
 * « À valider » n'est plus dans le menu. Rien ne part sans le geste de Lucas ;
 * le texte proposé et le texte envoyé sont gardés tous les deux.
 */
export type SmsPropose = { id: string; titre: string; resume: string | null; conversationId: string; texte: string; motifsRejet: { code: string; libelle: string }[] };

type PropositionBrute = { id: string; titre: string; resume: string | null; contenu: { conversationId?: string; texte?: string }; motifsRejet: { code: string; libelle: string }[] };

export async function chargerSmsProposes(): Promise<SmsPropose[]> {
  const { propositions } = await appelApi<{ propositions: PropositionBrute[] }>("/api/validation?type=ENVOI_SMS&statut=EN_ATTENTE");
  return propositions
    .filter((p) => typeof p.contenu.conversationId === "string" && typeof p.contenu.texte === "string")
    .map((p) => ({ id: p.id, titre: p.titre, resume: p.resume, conversationId: p.contenu.conversationId as string, texte: p.contenu.texte as string, motifsRejet: p.motifsRejet }));
}

function Carte({ proposition, onFait }: { proposition: SmsPropose; onFait: () => void }) {
  const [texte, setTexte] = useState(proposition.texte);
  const [edition, setEdition] = useState(false);
  const [rejet, setRejet] = useState(false);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const mesure = mesurerSms(texte);

  async function agir(cle: string, action: () => Promise<unknown>, message: string) {
    setEnvoi(cle);
    try {
      await action();
      toast.success(message);
      onFait();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEnvoi(null);
    }
  }

  const modifie = texte.trim() !== proposition.texte.trim();
  return (
    <div className="rounded-[12px] border-[0.5px] border-[#1D9E75]/40 bg-[#1D9E75]/[0.07] p-3">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#5DCAA5]">
        <Sparkles size={13} aria-hidden /> Message proposé — {proposition.titre}
      </p>
      {proposition.resume ? <p className="mt-1 text-[12px] leading-snug text-[#8B919C]">{proposition.resume}</p> : null}
      {edition ? (
        <>
          <textarea value={texte} onChange={(evenement) => setTexte(evenement.target.value)} rows={4} aria-label="Message proposé" className={cn(CLASSE_SAISIE, "mt-2 min-h-[96px] resize-y py-2 text-[15px] leading-relaxed sm:text-[13.5px]")} />
          <p className={cn("mt-1 text-[11.5px]", mesure.segments > 2 || !mesure.gsm ? "text-[#F5B454]" : "text-[#6B7280]")}>
            {mesure.longueur} caractères · {mesure.segments} SMS{!mesure.gsm ? ` · Unicode (${mesure.horsGsm.slice(0, 4).join(" ")})` : ""}
          </p>
        </>
      ) : (
        <p className="mt-2 rounded-[10px] bg-[#16181D] px-3 py-2 text-[14px] leading-relaxed whitespace-pre-wrap text-[#E5E7EB]">{texte}</p>
      )}
      {rejet ? (
        <div className="mt-2.5 grid gap-1.5">
          {proposition.motifsRejet.map((motif) => (
            <button key={motif.code} type="button" disabled={envoi !== null} onClick={() => void agir(motif.code, () => envoyerJson(`/api/validation/${proposition.id}/rejeter`, "POST", { motif: motif.code }), "Message écarté")} className={cn("h-11 rounded-[10px] border-[0.5px] border-[#2A2D34] px-3 text-left text-[13.5px] text-[#D1D5DB] hover:border-[#3A3E47] disabled:opacity-50", TRANS)}>
              {motif.libelle}
            </button>
          ))}
          <button type="button" onClick={() => setRejet(false)} className="h-9 text-[12.5px] text-[#8B919C] hover:text-[#F2F3F5]">
            Annuler
          </button>
        </div>
      ) : (
        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <button
            type="button"
            disabled={envoi !== null || texte.trim().length === 0}
            onClick={() => void agir("envoi", () => envoyerJson(`/api/validation/${proposition.id}/valider`, "POST", modifie ? { corrections: { texte: texte.trim() } } : {}), "SMS envoyé")}
            className={cn("flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[#1D9E75] text-[14.5px] font-semibold text-[#06140F] hover:bg-[#5DCAA5] disabled:opacity-50", TRANS)}
          >
            <Send size={15} aria-hidden /> {envoi === "envoi" ? "Envoi…" : modifie ? "Envoyer ma version" : "Envoyer"}
          </button>
          <button type="button" onClick={() => setEdition((ouverte) => !ouverte)} className={cn("h-11 rounded-[10px] border-[0.5px] border-[#2A2D34] px-3.5 text-[13.5px] text-[#D1D5DB] hover:border-[#3A3E47]", TRANS)}>
            {edition ? "Aperçu" : "Modifier"}
          </button>
          <button type="button" onClick={() => setRejet(true)} className={cn("h-11 rounded-[10px] border-[0.5px] border-[#2A2D34] px-3.5 text-[13.5px] text-[#9CA3AF] hover:border-[#3A3E47]", TRANS)}>
            Écarter
          </button>
        </div>
      )}
    </div>
  );
}

/** Dans le fil : les messages proposés pour CETTE conversation, juste au-dessus de la saisie. */
export function RelancesProposees({ conversationId, version, onFait }: { conversationId: string; version: number; onFait: () => void }) {
  const [propositions, setPropositions] = useState<SmsPropose[]>([]);

  const charger = useCallback(() => {
    chargerSmsProposes()
      .then((toutes) => setPropositions(toutes.filter((p) => p.conversationId === conversationId)))
      .catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    const minuterie = window.setTimeout(charger, 0);
    return () => window.clearTimeout(minuterie);
  }, [charger, version]);

  if (propositions.length === 0) return null;
  return (
    <div className="space-y-2 border-t-[0.5px] border-[#2A2D34] bg-[#16181D] px-3 pt-2.5">
      {propositions.map((proposition) => (
        <Carte
          key={proposition.id}
          proposition={proposition}
          onFait={() => {
            charger();
            onFait();
          }}
        />
      ))}
    </div>
  );
}
