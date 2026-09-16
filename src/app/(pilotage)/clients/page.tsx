import type { Metadata } from "next";
import { listerClients, statistiquesAcquisition } from "@/lib/clients/fiches";
import ListeClients from "./_components/ListeClients";

export const metadata: Metadata = {
  title: "Clients — CoverSwap",
  description: "Clients pérennes : historique, provenance, recommandations.",
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [clients, acquisition] = await Promise.all([listerClients(), statistiquesAcquisition()]);
  return <ListeClients initiaux={clients} acquisition={acquisition} />;
}
