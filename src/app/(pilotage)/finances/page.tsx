import type { Metadata } from "next";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { SECTION_DEPENSES } from "@/lib/depenses/constantes";
import { listerDepenses, suggestionsSaisie } from "@/lib/depenses/service";
import { anneeDemandee } from "@/lib/finances/annee";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import TableauFinances from "./_components/TableauFinances";

export const metadata: Metadata = {
  title: "Finances — CoverSwap",
  description: "Factures à encaisser et paiements, chèques à créditer, points à corriger, dépenses par chantier, livre des recettes et son export.",
};

export const dynamic = "force-dynamic";

// Mission 18 (A3) : l'écran Dépenses est une section de cet écran (même année) ; l'ancienne adresse /depenses redirige
// vers `?section=depenses` (next.config.ts), qui y descend. La saisie reste sur `/depenses/nouvelle`.
export default async function FinancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { annee: brute, section } = await searchParams;
  const parametres = new URLSearchParams(typeof brute === "string" ? { annee: brute } : {});
  let annee: number;
  try {
    annee = anneeDemandee(parametres);
  } catch (erreur) {
    if (!(erreur instanceof ErreurMetier)) throw erreur;
    annee = anneeDemandee(new URLSearchParams());
  }
  const [tableau, depenses, { chantiers }] = await Promise.all([chargerTableauFinances(annee), listerDepenses(annee), suggestionsSaisie()]);
  return (
    <TableauFinances
      key={annee}
      initial={tableau}
      depenses={{ liste: depenses, chantiers }}
      section={section === SECTION_DEPENSES ? SECTION_DEPENSES : null}
    />
  );
}
