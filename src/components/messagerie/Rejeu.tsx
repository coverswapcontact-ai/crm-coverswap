"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { EvenementRejoue, Rejeu } from "@/lib/messagerie/rejeu";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { TRANS } from "@/components/pilotage/ui";
import { BOUTON_PRINCIPAL, BOUTON_SECONDAIRE_M } from "./CarteMessage";
import { LignesOuEnEst } from "./OuEnEst";

/**
 * Mission 25 (lot 5) — rejouer à blanc les 20 derniers événements réels (réponses des clients, notes) : ce que les
 * règles fixes et l'IA en feraient. Rien n'est écrit dans les dossiers, rien n'est préparé ni envoyé. Avec l'IA, le
 * coût est annoncé avant (prix de Paramètres) ; chaque réponse et chaque ligne de l'IA porte le verdict du contrôleur.
 */

type Estimation = { euros: number; raison: string | null } | null;
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function RejeuMessagerie() {
  const [estimation, setEstimation] = useState<Estimation | undefined>(undefined);
  const [resultat, setResultat] = useState<Rejeu | null>(null);
  const [encours, setEncours] = useState<"REGLES" | "IA" | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      appelApi<{ estimation: Estimation }>("/api/messagerie/rejeu")
        .then((r) => setEstimation(r.estimation))
        .catch(() => setEstimation(null));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  async function lancer(ia: boolean) {
    if (ia && !window.confirm(`Rejouer 20 événements avec l'IA : environ ${euros(estimation?.euros ?? 0)}, pris sur le budget du mois. Continuer ?`)) return;
    setEncours(ia ? "IA" : "REGLES");
    try {
      setResultat(await envoyerJson<Rejeu>("/api/messagerie/rejeu", "POST", { ia }));
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setEncours(null);
    }
  }

  const iaPossible = Boolean(estimation && !estimation.raison);
  const ecartees = resultat?.evenements.filter((e) => e.ia?.ecart).length ?? 0;
  const lignesEcartees = resultat?.evenements.filter((e) => e.ia?.ecartOuEnEst).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 md:px-8">
      <Link href="/messagerie" className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[14px] text-texte-2 hover:text-texte", TRANS)}>
        <ArrowLeft size={16} aria-hidden /> Messagerie
      </Link>
      <h1 className="mt-1 text-[22px] font-semibold text-texte">Rejouer les 20 derniers événements</h1>
      <p className="mt-1 text-[14px] leading-relaxed text-texte-3">
        Les dernières réponses de clients et tes dernières notes, relues comme si elles arrivaient maintenant. À blanc : rien n&apos;est écrit dans les dossiers, rien n&apos;est préparé ni envoyé. Tu vérifies qu&apos;aucun brouillon
        n&apos;est de travers et que « Où on en est » est juste.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => void lancer(false)} disabled={encours !== null} className={cn(BOUTON_SECONDAIRE_M, "sm:flex-1")}>
          {encours === "REGLES" ? "Rejeu en cours…" : "Avec les règles fixes (gratuit)"}
        </button>
        <button type="button" onClick={() => void lancer(true)} disabled={encours !== null || !iaPossible} className={cn(BOUTON_PRINCIPAL, "sm:flex-1")}>
          {encours === "IA" ? "L'IA relit…" : `Avec l'IA${estimation ? ` (≈ ${euros(estimation.euros)})` : ""}`}
        </button>
      </div>
      {estimation === null ? <p className="mt-2 text-[13px] text-texte-3">IA non réglée (modèle et prix dans Paramètres → Assistant) : rejeu par les règles seulement.</p> : null}
      {estimation?.raison ? <p className="mt-2 text-[13px] text-attention-texte">IA indisponible : {estimation.raison}</p> : null}

      {resultat ? (
        <section className="mt-6 space-y-3">
          <p className="text-[14px] text-texte-2">
            {resultat.evenements.length} événement{resultat.evenements.length > 1 ? "s" : ""} rejoué{resultat.evenements.length > 1 ? "s" : ""}
            {resultat.ia ? ` · IA : ${resultat.appels} analyse${resultat.appels > 1 ? "s" : ""}, ${euros(resultat.cout)} · réponses écartées par le contrôleur : ${ecartees} · lignes « Où on en est » écartées : ${lignesEcartees}` : ""}
          </p>
          {resultat.raisonSansIa ? <p className="text-[13px] text-attention-texte">Sans l&apos;IA : {resultat.raisonSansIa}</p> : null}
          {resultat.evenements.length === 0 ? <p className="text-[14px] text-texte-3">Aucun événement à rejouer : aucune conversation n&apos;a encore d&apos;échange.</p> : null}
          {resultat.evenements.map((e, i) => (
            <CarteEvenement key={`${e.suiviId}-${e.le}-${i}`} evenement={e} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Verdict({ ecart }: { ecart: string | null }) {
  return ecart ? (
    <span className="inline-flex items-center gap-1 text-retard-texte">
      <X size={14} aria-hidden /> écarté : {ecart}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-action-clair">
      <Check size={14} aria-hidden /> passe le contrôleur
    </span>
  );
}

function CarteEvenement({ evenement: e }: { evenement: EvenementRejoue }) {
  return (
    <article className="space-y-2.5 rounded-[14px] border-[0.5px] border-trait bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/messagerie?suivi=${e.suiviId}`} className="text-[16px] font-semibold text-texte hover:underline">
          {e.nom}
        </Link>
        <span className="text-[12.5px] text-texte-3">
          {e.genre === "MESSAGE" ? "Message du client" : "Ta note"} · {date(e.le)}
        </span>
      </header>
      <blockquote className="rounded-[12px] bg-surface-2 px-3 py-2 text-[14px] break-words whitespace-pre-wrap text-texte">« {e.texte} »</blockquote>
      <div className="text-[13.5px] leading-relaxed text-texte-2">
        <p>
          <span className="font-medium text-texte">Règles</span> : {e.regles.lecture}
          {e.regles.reponse ? ` → ${e.regles.reponse.code}` : e.genre === "MESSAGE" ? " → pas de réponse" : ""}
        </p>
        {e.regles.reponse?.texte ? <p className="mt-0.5 text-texte-3">« {e.regles.reponse.texte} »</p> : null}
      </div>
      {e.ia ? (
        <div className="text-[13.5px] leading-relaxed text-texte-2">
          <p>
            <span className="font-medium text-texte">IA</span> : {e.ia.lecture}
          </p>
          {e.ia.reponse ? (
            <>
              <p className="mt-0.5 text-texte-3">« {e.ia.reponse} »</p>
              <p className="mt-0.5 text-[12.5px]">
                <Verdict ecart={e.ia.ecart} />
              </p>
            </>
          ) : null}
          {e.ia.ouEnEst ? (
            <p className="mt-1 text-[12.5px] text-texte-3">
              Où on en est (IA) : {e.ia.ouEnEst.situation} · {e.ia.ouEnEst.client} — <Verdict ecart={e.ia.ecartOuEnEst} />
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="border-t-[0.5px] border-trait pt-2">
        <p className="mb-1 text-[12px] font-medium text-texte-3">Où on en est (règles, aujourd&apos;hui)</p>
        <LignesOuEnEst ouEnEst={e.regles.ouEnEst} compacte />
      </div>
    </article>
  );
}
