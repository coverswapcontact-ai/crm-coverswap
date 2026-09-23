"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { EtatVide, TitreSection, TRANS } from "@/components/pilotage/ui";
import { FAMILLES_CHRONOLOGIE, LIBELLES_FAMILLE_CHRONOLOGIE, type EntreeChronologie, type FamilleChronologie } from "@/lib/chronologie/familles";
import { cn } from "@/lib/utils";

/**
 * Le fil unique d'un contact (mission 9) : mails, appels, espace client,
 * dossier, notes, propositions validées — une seule liste, filtrable, la même
 * dans la fiche client, le panneau du dossier et ce que lit l'assistant.
 */

const TON_FAMILLE: Record<FamilleChronologie, string> = {
  MAIL: "border-[#60A5FA]/40 bg-[#60A5FA]/10 text-[#93C5FD]",
  APPEL: "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]",
  ESPACE: "border-[#A78BFA]/40 bg-[#A78BFA]/10 text-[#C4B5FD]",
  DOSSIER: "border-[#2A2D34] bg-[#1C1F25] text-[#B4BAC4]",
  DOCUMENT: "border-[#EF9F27]/40 bg-[#EF9F27]/10 text-[#F5B454]",
  PAIEMENT: "border-[#1D9E75]/40 bg-[#112B22] text-[#5DCAA5]",
  NOTE: "border-[#2A2D34] bg-[#1C1F25] text-[#9CA3AF]",
  PROPOSITION: "border-[#F472B6]/40 bg-[#F472B6]/10 text-[#F9A8D4]",
};

const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Chronologie({ cible, titre = "Chronologie", limite = 60, compact = false }: { cible: { client?: string | null; lead?: string | null; dossier?: string | null }; titre?: string; limite?: number; compact?: boolean }) {
  const [entrees, setEntrees] = useState<EntreeChronologie[] | null>(null);
  const [total, setTotal] = useState(0);
  const [familles, setFamilles] = useState<FamilleChronologie[]>([]);
  const [tout, setTout] = useState(false);

  useEffect(() => {
    let actif = true;
    const p = new URLSearchParams();
    if (cible.client) p.set("client", cible.client);
    if (cible.lead) p.set("lead", cible.lead);
    if (cible.dossier) p.set("dossier", cible.dossier);
    if (familles.length) p.set("familles", familles.join(","));
    p.set("limite", String(limite));
    appelApi<{ entrees: EntreeChronologie[]; total: number }>(`/api/chronologie?${p}`)
      .then((r) => {
        if (!actif) return;
        setEntrees(r.entrees);
        setTotal(r.total);
      })
      .catch((erreur) => actif && toast.error("Chronologie indisponible", { description: messageErreur(erreur) }));
    return () => {
      actif = false;
    };
  }, [cible.client, cible.lead, cible.dossier, familles, limite]);

  const visibles = entrees ? (tout || !compact ? entrees : entrees.slice(0, 12)) : [];
  const basculer = (f: FamilleChronologie) => setFamilles((liste) => (liste.includes(f) ? liste.filter((x) => x !== f) : [...liste, f]));

  return (
    <section className={cn(!compact && "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4")}>
      <TitreSection>{`${titre}${entrees ? ` · ${total}` : ""}`}</TitreSection>
      <div className="mb-3 flex flex-wrap gap-1">
        {FAMILLES_CHRONOLOGIE.map((f) => (
          <button key={f} type="button" onClick={() => basculer(f)} aria-pressed={familles.includes(f)} className={cn("rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium", TRANS, familles.length === 0 || familles.includes(f) ? TON_FAMILLE[f] : "border-[#2A2D34] text-[#6B7280] opacity-60")}>
            {LIBELLES_FAMILLE_CHRONOLOGIE[f]}
          </button>
        ))}
      </div>
      {entrees === null ? (
        <p className="text-[12px] text-[#6B7280]">Chargement…</p>
      ) : entrees.length === 0 ? (
        <EtatVide titre="Rien dans la chronologie" texte={familles.length ? "Avec ces filtres." : undefined} />
      ) : (
        <ol className="divide-y-[0.5px] divide-[#2A2D34]">
          {visibles.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2">
              <span className="w-[86px] shrink-0 pt-0.5 text-[11.5px] text-[#6B7280] tabular-nums">{quand(e.le)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#E5E7EB]">
                  <span className={cn("rounded-full border-[0.5px] px-1.5 py-0 text-[10.5px] font-medium", TON_FAMILLE[e.famille])}>{LIBELLES_FAMILLE_CHRONOLOGIE[e.famille]}</span>
                  <span className="min-w-0 truncate">{e.titre}</span>
                  {e.lien ? (
                    <Link href={e.lien} className={cn("inline-flex items-center text-[#5DCAA5] hover:underline", TRANS)} aria-label="Ouvrir">
                      <ArrowUpRight size={13} aria-hidden />
                    </Link>
                  ) : null}
                </p>
                {e.texte ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[#8B919C]">{e.texte}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {compact && entrees && entrees.length > 12 ? (
        <button type="button" onClick={() => setTout((v) => !v)} className="mt-2 text-[12.5px] text-[#5DCAA5] hover:underline">
          {tout ? "Replier" : `Voir les ${entrees.length}`}
        </button>
      ) : null}
    </section>
  );
}
