"use client";

import { ChevronDown, Search } from "lucide-react";
import { libelleVoirAutres } from "@/lib/v2/aujourdhui";
import { phrasePage } from "@/lib/v2/dossiers";
import { cn } from "@/lib/utils";
import { BOUTON_SECONDAIRE } from "../journal/GroupeParPersonne";
import { TRANS_V2 } from "../transitions";

/**
 * Mission 22 (A4) — ce que les trois listes (Dossiers, Personnes, Argent) partagent : « Voir les N autres » après cinq
 * lignes (règle 2), les pages du serveur en phrase (« Page 2 sur 4 »), le champ de recherche (16 / 17 px, 44 px), le
 * titre d'un bloc, le repli d'un bloc fermé, l'état vide en phrase. Jetons seulement ; `TRANS_V2` comme seul mouvement.
 */
export const TITRE_BLOC_V2 = "text-titre font-semibold text-texte";
export const REPLI_V2 = cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-[8px] px-1 text-left hover:bg-surface focus-visible:ring-2 focus-visible:ring-action/50 focus-visible:outline-none", TRANS_V2);
export const CHAMP_V2 = cn("h-11 w-full min-w-0 rounded-[10px] border border-trait bg-fond px-4 text-corps-tel text-texte outline-none placeholder:text-texte-3 focus:border-action md:text-corps", TRANS_V2);
export const LISTE_V2 = "overflow-hidden rounded-[11px] border border-trait bg-surface";
export const LIGNE_V2 = "border-t border-trait first:border-t-0";

export function BoutonVoirAutres({ reste, onClick }: { reste: number; onClick: () => void }) {
  if (reste <= 0) return null;
  return (
    <button type="button" onClick={onClick} className={cn(BOUTON_SECONDAIRE, "self-start")}>
      {libelleVoirAutres(reste)}
    </button>
  );
}

/** Les pages du serveur (50 par page) : une phrase et deux boutons en contour ; rien quand tout tient sur une page. */
export function PagesV2({ total, page, parPage, onPage }: { total: number; page: number; parPage: number; onPage: (page: number) => void }) {
  const phrase = phrasePage(page, parPage, total);
  if (!phrase) return null;
  const derniere = Math.max(1, Math.ceil(total / parPage));
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-corps text-texte-3">{phrase}</p>
      <span className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BOUTON_SECONDAIRE}>
          Page précédente
        </button>
        <button type="button" disabled={page >= derniere} onClick={() => onPage(page + 1)} className={BOUTON_SECONDAIRE}>
          Page suivante
        </button>
      </span>
    </nav>
  );
}

/** Le champ de recherche d'une liste : une loupe, 44 px, 16 / 17 px ; `type="search"` pour la croix du navigateur. */
export function ChampRecherche({ valeur, onChange, placeholder, libelle, autoFocus = false }: { valeur: string; onChange: (valeur: string) => void; placeholder: string; libelle: string; autoFocus?: boolean }) {
  return (
    <label className="relative block w-full">
      <span className="sr-only">{libelle}</span>
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-texte-3" />
      <input type="search" value={valeur} onChange={(evenement) => onChange(evenement.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} autoFocus={autoFocus} className={cn(CHAMP_V2, "pl-11")} />
    </label>
  );
}

/** Un bloc replié : son titre, « Voir » / « Replier ». Aucun nombre dans un titre (correctifs du 07/10, d3). */
export function TitreRepliable({ id, titre, ouvert, onBasculer }: { id: string; titre: string; ouvert: boolean; onBasculer: () => void }) {
  return (
    <button type="button" aria-expanded={ouvert} aria-controls={`${id}-contenu`} onClick={onBasculer} className={REPLI_V2}>
      <span id={`${id}-titre`} className={TITRE_BLOC_V2}>
        {titre}
      </span>
      <span className="flex items-center gap-1 text-corps text-texte-3">
        {ouvert ? "Replier" : "Voir"}
        <ChevronDown size={18} aria-hidden className={cn(ouvert && "rotate-180")} />
      </span>
    </button>
  );
}

/** Un état vide en phrase, dans le cadre de la liste. */
export function Vide({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[11px] border border-dashed border-trait px-4 py-6 text-corps-tel text-texte-3 md:text-corps">{children}</p>;
}
