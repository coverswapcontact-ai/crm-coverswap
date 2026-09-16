import type { Metadata } from "next";
import { lireRegistre } from "@/lib/dossiers/registre";
import RegistreNumeros from "./_components/RegistreNumeros";

export const metadata: Metadata = {
  title: "Registre des numéros — CoverSwap",
  description: "Numéros de devis, factures et avoirs déjà émis : jamais réattribués.",
};

export const dynamic = "force-dynamic";

export default async function NumerosPage() {
  return <RegistreNumeros initiales={await lireRegistre()} />;
}
