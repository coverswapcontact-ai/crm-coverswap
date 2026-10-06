import type { Metadata } from "next";
import { EnTeteEcran } from "@/components/v2/EnTeteEcran";
import { interfaceCourante } from "@/lib/interface/choix";
import { etatBanc } from "@/lib/simulateur/banc/banc";
import EcranBanc from "./_components/EcranBanc";

export const metadata: Metadata = {
  title: "Banc de comparaison — CoverSwap",
  description: "Six photos de dossiers × trois variantes du moteur (V1 échantillons, V2 planche, V2 échantillons) : score, coût réel, durée, prompt de chaque rendu.",
};

export const dynamic = "force-dynamic";

// Mission 15 (partie 3) : rien ne part sans le clic de Lucas ; le coût de la campagne est affiché avant.
// Mission 22 (A5) : en v2 (`interfaceCourante()`), le même écran v1 sous l'en-tête v2 ; en v1 rien ne change.
export default async function BancPage() {
  const v = await interfaceCourante();
  const ecran = <EcranBanc initial={await etatBanc()} />;
  if (v === "v2") return <EnTeteEcran titre="Banc du simulateur" cadre="large-4">{ecran}</EnTeteEcran>;
  return ecran;
}
