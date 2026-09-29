import { CARTE, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";

/** Mission 13 (lot 7) — les classes partagées par le panneau du contact et ses morceaux. */
export const CARTE_REMPLIE = `${CARTE} p-3.5`;
export const LIEN_ACTION = cn(
  "inline-flex h-11 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-3 text-[13px] text-[#D1D5DB] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-8",
  TRANS,
);
