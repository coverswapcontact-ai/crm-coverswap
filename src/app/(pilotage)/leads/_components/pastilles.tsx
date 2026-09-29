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

/** Il a fait une simulation sur le site : il a déjà vu un rendu de sa pièce. */
export function PastilleSimulation({ nombre }: { nombre?: number }) {
  return (
    <Pastille ton="bleu" titre="A fait une simulation sur le site : il a déjà vu un rendu de sa pièce">
      <Sparkles size={11} aria-hidden /> Simulation{nombre && nombre > 1 ? ` ×${nombre}` : ""}
    </Pastille>
  );
}
