import type { Metadata } from "next";
import { pageClients, statistiquesAcquisition } from "@/lib/clients/fiches";
import ListeClients from "./_components/ListeClients";

export const metadata: Metadata = {
  title: "Clients — CoverSwap",
  description: "Clients pérennes : historique, provenance, recommandations.",
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const [clients, acquisition] = await Promise.all([pageClients({ page: 1 }), statistiquesAcquisition()]);
  return <ListeClients initial={clients} acquisition={acquisition} />;
}
