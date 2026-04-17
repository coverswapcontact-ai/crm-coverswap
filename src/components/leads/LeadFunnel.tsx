"use client";

import { cn } from "@/lib/utils";

/**
 * Schema visuel du tunnel de vente — 6 etapes.
 * Remplace le score bar dans le mode avance + utilise en vue clients.
 *
 * Etapes:
 *  1. Nouveau          — lead entre dans le CRM
 *  2. Contacte         — premier contact effectue
 *  3. Devis envoye     — devis transmis au client
 *  4. Signe            — devis signe
 *  5. Chantier         — chantier planifie / en cours / termine
 *  6. Paye             — facture finale soldee (solde recu)
 */
export const FUNNEL_STEPS = [
  { key: "NOUVEAU",     label: "Nouveau"  },
  { key: "CONTACTE",    label: "Contacte" },
  { key: "DEVIS",       label: "Devis"    },
  { key: "SIGNE",       label: "Signe"    },
  { key: "CHANTIER",    label: "Chantier" },
  { key: "FACTURE",     label: "Paye"     },
] as const;

export function funnelProgress(statut: string, soldeRecu = false): number {
  if (soldeRecu) return 6;
  switch (statut) {
    case "NOUVEAU":           return 1;
    case "CONTACTE":          return 2;
    case "DEVIS_ENVOYE":      return 3;
    case "SIGNE":             return 4;
    case "CHANTIER_PLANIFIE": return 5;
    case "TERMINE":           return 5;
    default:                  return 1;
  }
}

interface Props {
  statut: string;
  soldeRecu?: boolean;
  perdu?: boolean;
  /** sm = mini barre compacte (table), md = segmentee avec labels */
  size?: "sm" | "md";
  className?: string;
}

export default function LeadFunnel({ statut, soldeRecu = false, perdu = false, size = "sm", className }: Props) {
  if (perdu || statut === "PERDU") {
    return (
      <span className={cn("text-[10px] font-medium text-gray-400 italic", className)}>
        Perdu
      </span>
    );
  }

  const reached = funnelProgress(statut, soldeRecu);

  if (size === "sm") {
    return (
      <div className={cn("flex items-center gap-0.5", className)} title={`Etape ${reached}/6`}>
        {FUNNEL_STEPS.map((step, i) => {
          const done = i < reached;
          const current = i === reached - 1;
          return (
            <div
              key={step.key}
              title={step.label}
              className={cn(
                "h-1.5 w-4 rounded-[2px] transition-colors",
                done ? "bg-[#CC0000]" : "bg-gray-200",
                current && "ring-2 ring-[#CC0000]/20",
              )}
            />
          );
        })}
      </div>
    );
  }

  // size === "md" : segments avec labels
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1">
        {FUNNEL_STEPS.map((step, i) => {
          const done = i < reached;
          const current = i === reached - 1;
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={cn(
                  "h-2 w-full rounded-sm transition-colors",
                  done ? "bg-[#CC0000]" : "bg-gray-200",
                  current && "ring-2 ring-[#CC0000]/25 ring-offset-1",
                )}
              />
              <span className={cn(
                "text-[10px] font-medium text-center leading-tight",
                done ? "text-gray-700" : "text-gray-300",
                current && "text-[#CC0000] font-semibold",
              )}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
