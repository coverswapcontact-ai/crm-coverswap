"use client";

import { TitreSection } from "@/components/pilotage/ui";

/** Mission 13 (lot 7) : ce que partagent la fiche client et ses rubriques — la carte, la ligne libellé/valeur, le libellé d'un acteur du journal. */

export function Carte({ titre, action, children }: { titre: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
      <TitreSection action={action}>{titre}</TitreSection>
      {children}
    </section>
  );
}

export function Ligne({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 text-[13px]">
      <span className="text-[#9CA3AF]">{libelle}</span>
      <span className="min-w-0 text-right text-[#F2F3F5]">{children}</span>
    </div>
  );
}

export function libelleActeur(acteur: string): string {
  const [type, ...reste] = acteur.split(":");
  const nom = reste.join(":");
  if (type === "HUMAIN") return nom === "poste-local" ? "moi (poste local)" : nom;
  if (type === "AGENT") return `agent ${nom}`;
  if (type === "MIGRATION") return "reprise des données";
  if (type === "EXTERNE") return "formulaire ou webhook";
  return type.toLowerCase();
}
