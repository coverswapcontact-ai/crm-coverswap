import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * Mission 22 (correctifs du 07/10) — `tailwind-merge` ne connaît pas l'échelle de texte de la v2 (`text-corps`,
 * `text-corps-tel`, `text-petit`, `text-titre`, `text-grand`, bloc `@theme` de globals.css) : il prenait ces classes
 * pour des couleurs et en gardait une seule avec `text-texte`. Déclarées dans le groupe `font-size`, elles se fondent
 * entre elles (la dernière l'emporte, comme `text-base`) et jamais avec une couleur. La v1 ne change pas : ses
 * tailles `text-sm`, `text-base`, `text-[13px]` sont déjà dans ce groupe.
 */
const fusionner = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["corps", "corps-tel", "petit", "titre", "grand"] }] } } })

export function cn(...inputs: ClassValue[]) {
  return fusionner(clsx(inputs))
}

export function formatEuros(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(date));
}
