import type { Metadata } from "next";
import { pageClients } from "@/lib/clients/fiches";
import ListeClients from "./_components/ListeClients";

export const metadata: Metadata = {
  title: "Clients — CoverSwap",
  description: "Clients pérennes : historique, provenance, recommandations.",
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  // Mission 17 (partie B) : « D'où viennent les clients » a rejoint l'Analytique (onglet Argent, bloc du même nom).
  return <ListeClients initial={await pageClients({ page: 1 })} />;
}
