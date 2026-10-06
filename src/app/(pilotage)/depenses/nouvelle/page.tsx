import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { suggestionsSaisie } from "@/lib/depenses/service";
import { interfaceCourante } from "@/lib/interface/choix";
import SaisieDepense from "../_components/SaisieDepense";

export const metadata: Metadata = {
  title: "Nouvelle dépense — CoverSwap",
  description: "Photo du ticket, montant, chantier : la dépense en quelques gestes.",
};

export const dynamic = "force-dynamic";

// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 « Nouvelle dépense » ; en v1 rien ne change.
export default async function NouvelleDepensePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dossier } = await searchParams;
  // Depuis un dossier : son chantier est proposé en premier et pré-choisi, quelle que soit son étape.
  const [{ chantiers, propose, fournisseurs }, v] = await Promise.all([suggestionsSaisie(typeof dossier === "string" ? dossier : null), interfaceCourante()]);
  const ecran = <SaisieDepense chantiers={chantiers} propose={propose} fournisseurs={fournisseurs} />;
  if (v === "v2") {
    return (
      <EnTeteEcran titre="Nouvelle dépense" aide="Le ticket en photo, le montant, le chantier : trois gestes." cadre="etroit">
        {ecran}
      </EnTeteEcran>
    );
  }
  return ecran;
}
