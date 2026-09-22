import type { Metadata } from "next";
import { listerClientsEspaces } from "@/lib/espace/suivi";
import EcranEspaces from "./_components/EcranEspaces";

export const metadata: Metadata = {
  title: "Espaces clients — CoverSwap",
  description: "Un client, son espace, ses projets : où il en est dans chacun, ce qu'il a fait, dernière visite, et qui a la main.",
};

export const dynamic = "force-dynamic";

export default async function EspacesPage() {
  return <EcranEspaces initial={await listerClientsEspaces()} />;
}
