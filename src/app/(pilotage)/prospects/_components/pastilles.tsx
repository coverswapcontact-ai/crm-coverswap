import { Pastille } from "@/components/pilotage/ui";
import type { EntrantResume } from "@/lib/prospects/types";

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
