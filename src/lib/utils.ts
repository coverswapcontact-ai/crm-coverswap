import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatEuros(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(date));
}

export function formatDateLong(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(date));
}

export const LEAD_SOURCES = ["META_ADS", "TIKTOK", "INSTAGRAM", "ORGANIQUE", "REFERENCE", "AUTRE"] as const;
export const LEAD_STATUTS = ["NOUVEAU", "CONTACTE", "DEVIS_ENVOYE", "SIGNE", "CHANTIER_PLANIFIE", "TERMINE", "PERDU"] as const;
export const TYPE_PROJETS = ["CUISINE", "SDB", "MEUBLES", "PRO", "AUTRE"] as const;
export const DEVIS_STATUTS = ["BROUILLON", "ENVOYE", "SIGNE", "REFUSE", "EXPIRE"] as const;
export const FACTURE_STATUTS = ["ACOMPTE_EN_ATTENTE", "ACOMPTE_RECU", "SOLDEE", "IMPAYEE", "ANNULEE"] as const;
export const CHANTIER_STATUTS = ["COMMANDE_PASSEE", "MATIERE_RECUE", "EN_COURS", "TERMINE", "FACTURE"] as const;
export const COMMANDE_STATUTS = ["A_COMMANDER", "COMMANDEE", "EN_TRANSIT", "RECUE"] as const;

export function statutColor(statut: string): string {
  const colors: Record<string, string> = {
    NOUVEAU: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    CONTACTE: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    DEVIS_ENVOYE: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    SIGNE: "bg-green-500/20 text-green-400 border-green-500/30",
    CHANTIER_PLANIFIE: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    TERMINE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    PERDU: "bg-red-500/20 text-red-400 border-red-500/30",
    BROUILLON: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    ENVOYE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    REFUSE: "bg-red-500/20 text-red-400 border-red-500/30",
    EXPIRE: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    ACOMPTE_EN_ATTENTE: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    ACOMPTE_RECU: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    SOLDEE: "bg-green-500/20 text-green-400 border-green-500/30",
    IMPAYEE: "bg-red-500/20 text-red-400 border-red-500/30",
    ANNULEE: "bg-gray-500/20 text-gray-400 border-gray-500/30 line-through",
    COMMANDE_PASSEE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    MATIERE_RECUE: "bg-green-500/20 text-green-400 border-green-500/30",
    EN_COURS: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    A_COMMANDER: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    COMMANDEE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    EN_TRANSIT: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    RECUE: "bg-green-500/20 text-green-400 border-green-500/30",
    FACTURE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };
  return colors[statut] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    META_ADS: "Meta Ads",
    TIKTOK: "TikTok",
    INSTAGRAM: "Instagram",
    ORGANIQUE: "Organique",
    REFERENCE: "Référence",
    AUTRE: "Autre",
  };
  return labels[source] || source;
}

export function statutLabel(statut: string): string {
  return statut.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}
