import type { Metadata } from "next";
import { pilotageCommercial } from "@/lib/commercial/pilotage";
import EcranCommercial from "./_components/EcranCommercial";

export const metadata: Metadata = {
  title: "Commercial — CoverSwap",
  description: "Pilotage commercial : qui rappeler, quelles simulations et quels devis préparer, ce qui attend les clients.",
};

export const dynamic = "force-dynamic";

export default async function PageCommercial() {
  return <EcranCommercial initial={await pilotageCommercial()} />;
}
