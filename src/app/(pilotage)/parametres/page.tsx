import type { Metadata } from "next";
import { parametresPourEcran } from "@/lib/parametres/service";
import EcranParametres from "./_components/EcranParametres";

export const metadata: Metadata = {
  title: "Paramètres — CoverSwap",
  description: "Seuils fiscaux, taux et règles datés.",
};

export const dynamic = "force-dynamic";

export default async function ParametresPage() {
  return <EcranParametres initiaux={await parametresPourEcran()} />;
}
