import type { Metadata } from "next";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { anneeDemandee } from "@/lib/finances/annee";
import { chargerTableauFinances } from "@/lib/finances/tableau";
import TableauFinances from "./_components/TableauFinances";

export const metadata: Metadata = {
  title: "Finances — CoverSwap",
  description: "Encaissements, URSSAF, seuils, factures à encaisser et livre des recettes.",
};

export const dynamic = "force-dynamic";

export default async function FinancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brute = (await searchParams).annee;
  const parametres = new URLSearchParams(typeof brute === "string" ? { annee: brute } : {});
  let annee: number;
  try {
    annee = anneeDemandee(parametres);
  } catch (erreur) {
    if (!(erreur instanceof ErreurMetier)) throw erreur;
    annee = anneeDemandee(new URLSearchParams());
  }
  const tableau = await chargerTableauFinances(annee);
  return <TableauFinances key={annee} initial={tableau} />;
}
