import { Sparkles } from "lucide-react";
import { Pastille } from "@/components/pilotage/ui";
import type { EntrantResume } from "@/lib/prospects/types";
import { LIBELLES_PRIORITE, type Priorite } from "@/lib/prospects/priorite";

/** Ce que le contact a demandé : le devis passe avant la simulation, qui passe avant le simple contact. */
export function PastilleIntention({ intention }: { intention: EntrantResume["intention"] }) {
  if (intention === "DEVIS") return <Pastille ton="rouge">Devis demandé</Pastille>;
  if (intention === "SIMULATION") return <Pastille ton="ambre">Simulation</Pastille>;
  return <Pastille>Contact</Pastille>;
}

/** Score d'usure sur 100 : à partir de 45 (et un signal), l'établissement est à contacter. */
export function PastilleScore({ score }: { score: number }) {
  return <Pastille ton={score >= 60 ? "vert" : score >= 45 ? "ambre" : "neutre"}>{score}/100</Pastille>;
}

/** Classe de rappel : l'ordre dans lequel Lucas rappelle. Rien tant que le contact n'est pas classé. */
export function PastillePriorite({ priorite, motif }: { priorite: string | null; motif?: string | null }) {
  if (!priorite || !(priorite in LIBELLES_PRIORITE)) return null;
  const classe = priorite as Priorite;
  const ton = classe === "PRIORITAIRE" ? "rouge" : classe === "STANDARD" ? "vert" : classe === "SECONDAIRE" ? "neutre" : "ambre";
  return (
    <Pastille ton={ton} titre={motif ?? undefined}>
      {LIBELLES_PRIORITE[classe]}
    </Pastille>
  );
}

/** Il a fait une simulation sur le site : il a déjà vu un rendu de sa cuisine. */
export function PastilleSimulation({ nombre }: { nombre?: number }) {
  return (
    <Pastille ton="bleu" titre="A fait une simulation sur le site : il a déjà vu un rendu de sa cuisine">
      <Sparkles size={11} aria-hidden /> Simulation{nombre && nombre > 1 ? ` ×${nombre}` : ""}
    </Pastille>
  );
}
