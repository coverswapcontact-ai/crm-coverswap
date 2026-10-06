import { CARTE, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/** Mission 13 (lot 7) — les classes partagées par le panneau du contact et ses morceaux. */
export const CARTE_REMPLIE = `${CARTE} p-3.5`;
export const LIEN_ACTION = cn(
  "inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-trait px-3 text-[13px] text-texte-2 hover:border-trait-2 hover:text-texte sm:h-8",
  TRANS,
);
