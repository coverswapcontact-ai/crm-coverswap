"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { appelApi } from "@/components/pilotage/client";
import { Chronologie } from "@/components/pilotage/Chronologie";
import type { EntreeChronologie } from "@/lib/chronologie/familles";
import { dateExacte, dateRelative } from "@/lib/v2/dates";
import { libelleVoirAutres } from "@/lib/v2/aujourdhui";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { TRANS_V2 } from "../transitions";

/** Cinq lignes, puis « Voir les N autres ». */
export const PASSE_VISIBLES = 5;

/**
 * Mission 22 (A3) — « Ce qui s'est passé ici » : la chronologie du contact (`GET /api/chronologie`, la même source que
 * `Chronologie.tsx`), en cinq lignes de phrases (date relative, la date exacte au survol), puis « Voir les N autres »
 * qui déplie la `Chronologie` existante en compact (filtres par famille, tout le fil). Relue quand `cle` change (le
 * dossier a bougé).
 */
export function CeQuiSestPasseIci({ cible, cle, maintenant }: { cible: { dossier: string; client: string | null }; cle: string; maintenant: number }) {
  const [lu, setLu] = useState<{ entrees: EntreeChronologie[]; total: number } | null>(null);
  const [tout, setTout] = useState(false);

  useEffect(() => {
    let actif = true;
    const p = new URLSearchParams({ dossier: cible.dossier, limite: String(PASSE_VISIBLES) });
    if (cible.client) p.set("client", cible.client);
    appelApi<{ entrees: EntreeChronologie[]; total: number }>(`/api/chronologie?${p}`)
      .then((r) => actif && setLu(r))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [cible.dossier, cible.client, cle]);

  if (lu && lu.total === 0) return null;
  return (
    <section aria-labelledby="passe-ici-titre" className="flex flex-col gap-2">
      <h2 id="passe-ici-titre" className="px-1 text-titre font-semibold text-texte">
        Ce qui s&apos;est passé ici{lu ? <span className="text-texte-3"> · {lu.total}</span> : null}
      </h2>
      {tout ? (
        <div className="rounded-[11px] border border-trait bg-surface p-4">
          <Chronologie cible={cible} titre="Chronologie du client" compact />
        </div>
      ) : !lu ? (
        <p className="px-1 text-corps-tel text-texte-3 md:text-corps">Lecture…</p>
      ) : (
        <>
          <ol className="overflow-hidden rounded-[11px] border border-trait bg-surface">
            {lu.entrees.slice(0, PASSE_VISIBLES).map((e) => (
              <li key={e.id} className="flex min-h-11 items-center gap-3 border-t border-trait px-4 py-2 first:border-t-0">
                <span title={dateExacte(e.le)} className="w-24 shrink-0 text-petit text-texte-3">
                  {dateRelative(e.le, new Date(maintenant))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-corps-tel text-texte md:text-corps">{e.titre}</span>
                  {e.texte ? <span className="block line-clamp-2 text-petit leading-snug text-texte-3">{e.texte}</span> : null}
                </span>
                {e.lien ? (
                  <Link href={e.lien} aria-label={`Ouvrir : ${e.titre}`} className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-action-clair hover:bg-surface-2", TRANS_V2)}>
                    <ArrowUpRight size={18} aria-hidden />
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
          {lu.total > PASSE_VISIBLES ? (
            <button type="button" onClick={() => setTout(true)} className={cn(BOUTON_SECONDAIRE, "self-start")}>
              {libelleVoirAutres(lu.total - PASSE_VISIBLES)}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
