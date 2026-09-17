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
  // Depuis un dossier : son chantier est proposé en premier et pré-choisi, quelle que soit son étape.
  const { chantiers, propose, fournisseurs } = await suggestionsSaisie(typeof dossier === "string" ? dossier : null);
  return <SaisieDepense chantiers={chantiers} propose={propose} fournisseurs={fournisseurs} />;
}
