import type { Metadata } from "next";
import { etatBanc } from "@/lib/simulateur/banc/banc";
import EcranBanc from "./_components/EcranBanc";

export const metadata: Metadata = {
  title: "Banc de comparaison — CoverSwap",
  description: "Six photos de dossiers × trois variantes du moteur (V1 échantillons, V2 planche, V2 échantillons) : score, coût réel, durée, prompt de chaque rendu.",
};

export const dynamic = "force-dynamic";

// Mission 15 (partie 3) : rien ne part sans le clic de Lucas ; le coût de la campagne est affiché avant.
export default async function BancPage() {
  return <EcranBanc initial={await etatBanc()} />;
}
