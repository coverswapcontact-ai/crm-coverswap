import type { Metadata } from "next";
import { listerEspaces } from "@/lib/espace/suivi";
import EcranEspaces from "./_components/EcranEspaces";

export const metadata: Metadata = {
  title: "Espaces clients — CoverSwap",
  description: "Ce que chaque client fait dans son espace : étape, photos, choix, devis relu, dernière visite, et qui a la main.",
};

export const dynamic = "force-dynamic";

export default async function EspacesPage() {
  return <EcranEspaces initial={await listerEspaces()} />;
}
