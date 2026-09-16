"use client";

import type { EtapeDossier } from "@/lib/dossiers/constants";

// Primitives communes : src/components/pilotage/ui.tsx. Ici, ce qui est propre
// aux étapes des dossiers.
export {
  Bouton,
  CaseACocher,
  Champ,
  CLASSE_SAISIE,
  EtatVide,
  ListeDeroulante,
  Modale,
  TitreSection,
  TRANS,
  ZoneTexte,
} from "@/components/pilotage/ui";

// Couleur de chaque étape, la même dans le kanban, la liste et le panneau.
// Du froid au chaud à mesure qu'on approche de l'encaissement, l'objectif ;
// perdu et en pause sortent de la gamme, en gris neutre. Le rouge reste
// réservé au retard.
export const GRIS_HORS_PARCOURS = "#8B919C";

export const COULEURS_ETAPE: Record<EtapeDossier, string> = {
  QUALIFICATION: "#818CF8",
  SIMULATION: "#60A5FA",
  DEVIS_ENVOYE: "#22D3EE",
  RELANCE: "#2DD4BF",
  SIGNE: "#4ADE80",
  PLANIFIE: "#A3E635",
  CHANTIER: "#FDE047",
  FACTURE: "#FBBF24",
  ENCAISSE: "#F97316",
  PERDU: GRIS_HORS_PARCOURS,
  EN_PAUSE: GRIS_HORS_PARCOURS,
};

/* ── Affichage ───────────────────────────────────────────────────── */

export function PastilleEtape({ etape, libelle }: { etape: EtapeDossier; libelle: string }) {
  const couleur = COULEURS_ETAPE[etape];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      // Suffixes hexadécimaux d'opacité : 1A ≈ 10 %, 4D ≈ 30 %.
      style={{ color: couleur, backgroundColor: `${couleur}1A`, borderColor: `${couleur}4D` }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: couleur }} />
      {libelle}
    </span>
  );
}
