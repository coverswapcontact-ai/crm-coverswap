import type { Metadata } from "next";
import { suggestionsSaisie } from "@/lib/depenses/service";
import SaisieDepense from "../_components/SaisieDepense";

export const metadata: Metadata = {
  title: "Nouvelle dépense — CoverSwap",
  description: "Photo du ticket, montant, chantier : la dépense en quelques gestes.",
};

export const dynamic = "force-dynamic";

export default async function NouvelleDepensePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dossier } = await searchParams;
  const { chantiers, propose, fournisseurs } = await suggestionsSaisie();
  // Depuis un dossier : son chantier est pré-choisi.
  const depuisDossier = typeof dossier === "string" && chantiers.some((chantier) => chantier.id === dossier) ? dossier : null;
  return <SaisieDepense chantiers={chantiers} propose={depuisDossier ?? propose} fournisseurs={fournisseurs} />;
}
