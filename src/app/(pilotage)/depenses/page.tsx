import type { Metadata } from "next";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { listerDepenses, suggestionsSaisie } from "@/lib/depenses/service";
import { anneeDemandee } from "@/lib/finances/annee";
import ListeDepenses from "./_components/ListeDepenses";

export const metadata: Metadata = {
  title: "Dépenses — CoverSwap",
  description: "Dépenses par chantier et frais généraux, avec leurs justificatifs.",
};

export const dynamic = "force-dynamic";

export default async function DepensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const brute = (await searchParams).annee;
  let annee: number;
  try {
    annee = anneeDemandee(new URLSearchParams(typeof brute === "string" ? { annee: brute } : {}));
  } catch (erreur) {
    if (!(erreur instanceof ErreurMetier)) throw erreur;
    annee = anneeDemandee(new URLSearchParams());
  }
  const [liste, { chantiers }] = await Promise.all([listerDepenses(annee), suggestionsSaisie()]);
  return <ListeDepenses key={annee} initiale={liste} chantiers={chantiers} />;
}
