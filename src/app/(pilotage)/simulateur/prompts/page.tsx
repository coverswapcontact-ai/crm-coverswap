import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import { listerPrompts } from "@/lib/simulateur/bibliotheque";
import EcranPrompts from "./_components/EcranPrompts";

export const metadata: Metadata = {
  title: "Prompts ChatGPT — CoverSwap",
  description: "La bibliothèque des prompts du simulateur : un par type de surface, versionnés, avec retour en arrière.",
};

export const dynamic = "force-dynamic";

// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 ; en v1 rien ne change.
export default async function PromptsPage() {
  const v = await interfaceCourante();
  const ecran = <EcranPrompts initial={await listerPrompts()} />;
  if (v === "v2") return <EnTeteEcran titre="Prompts du simulateur" cadre="large-4">{ecran}</EnTeteEcran>;
  return ecran;
}
