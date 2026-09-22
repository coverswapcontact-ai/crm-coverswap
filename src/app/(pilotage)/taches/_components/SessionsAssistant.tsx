"use client";

import { useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton, Pastille, TitreSection } from "@/components/pilotage/ui";
import type { SessionVue } from "@/lib/assistant/execution";
import { cn } from "@/lib/utils";

/**
 * Tâches de fond → Sessions de l'assistant (mission 8) : chaque jour où
 * Claude s'est servi du CRM, ses appels (outil, niveau, paramètres résumés,
 * phrase de Lucas, résultat ou refus). Journal en lecture seule.
 */

const TON_STATUT: Record<string, "vert" | "ambre" | "rouge" | "neutre"> = { FAIT: "vert", APERCU: "ambre", REFUSE: "rouge", ERREUR: "rouge" };
const LIBELLE_STATUT: Record<string, string> = { FAIT: "Fait", APERCU: "Aperçu", REFUSE: "Refusé", ERREUR: "Erreur" };
const LIBELLE_NIVEAU: Record<string, string> = { LECTURE: "lecture", REVERSIBLE: "écriture", SENSIBLE: "sensible" };
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export default function SessionsAssistant({ initial }: { initial: SessionVue[] }) {
  const [sessions, setSessions] = useState(initial);
  const [charge, setCharge] = useState(false);
  const [ouverte, setOuverte] = useState<string | null>(initial[0]?.id ?? null);

  async function rafraichir() {
    setCharge(true);
    try {
      setSessions((await appelApi<{ sessions: SessionVue[] }>("/api/assistant/sessions")).sessions);
    } catch (erreur) {
      toast.error("Sessions indisponibles", { description: messageErreur(erreur) });
    } finally {
      setCharge(false);
    }
  }

  return (
    <section className="mb-10">
      <TitreSection
        action={
          <Bouton taille="sm" icone={<RefreshCw size={13} aria-hidden />} chargement={charge} onClick={() => void rafraichir()}>
            Rafraîchir
          </Bouton>
        }
      >
        Sessions de l&apos;assistant Claude
      </TitreSection>
      {sessions.length === 0 ? (
        <p className="rounded-[11px] border-[0.5px] border-dashed border-[#2A2D34] px-4 py-6 text-center text-[12.5px] text-[#6B7280]">Aucune session pour l&apos;instant. Connecte l&apos;application Claude (Paramètres → Assistant Claude) et dis « Fais-moi le point du matin ».</p>
      ) : (
        <ul className="divide-y-[0.5px] divide-[#2A2D34] rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]">
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => setOuverte((o) => (o === s.id ? null : s.id))}>
                <span className="flex min-w-0 items-center gap-2">
                  <Bot size={15} aria-hidden className="shrink-0 text-[#5DCAA5]" />
                  <span className="text-[13.5px] font-medium text-[#F2F3F5]">{new Date(`${s.jour}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
                  <span className="text-[12px] text-[#6B7280]">
                    {s.clientNom ?? "Claude"} · {s.appels} appel{s.appels > 1 ? "s" : ""}, {s.ecritures} écriture{s.ecritures > 1 ? "s" : ""}{s.dernierAppelLe ? ` · dernier à ${heure(s.dernierAppelLe)}` : ""}
                  </span>
                </span>
                <span className="text-[12px] text-[#5DCAA5]">{ouverte === s.id ? "Replier" : "Voir"}</span>
              </button>
              {ouverte === s.id ? (
                <ol className="border-t-[0.5px] border-[#2A2D34] bg-[#16181D] px-4 py-2">
                  {s.derniers.length === 0 ? <li className="py-2 text-[12px] text-[#6B7280]">Aucun appel enregistré.</li> : null}
                  {s.derniers.map((a, i) => (
                    <li key={`${a.le}-${i}`} className={cn("py-2", i > 0 && "border-t-[0.5px] border-[#2A2D34]")}>
                      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className="text-[#6B7280]">{heure(a.le)}</span>
                        <code className="text-[#F2F3F5]">{a.outil}</code>
                        <span className="text-[#6B7280]">{LIBELLE_NIVEAU[a.niveau] ?? a.niveau}</span>
                        <Pastille ton={TON_STATUT[a.statut] ?? "neutre"}>{LIBELLE_STATUT[a.statut] ?? a.statut}</Pastille>
                        <span className="text-[#6B7280]">{a.dureeMs} ms</span>
                      </div>
                      {a.commande ? <p className="mt-0.5 text-[12.5px] text-[#D1D5DB]">« {a.commande} »</p> : null}
                      {a.resume ? <p className="mt-0.5 line-clamp-3 text-[12px] leading-relaxed text-[#9CA3AF]">{a.resume}</p> : null}
                      {a.erreur ? <p className="mt-0.5 text-[12px] text-[#F87171]">{a.erreur}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
