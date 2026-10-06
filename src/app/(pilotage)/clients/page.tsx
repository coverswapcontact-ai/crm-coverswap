import type { Metadata } from "next";
import { PersonnesV2 } from "@/components/v2/personnes/PersonnesV2";
import { pageClients } from "@/lib/clients/fiches";
import { interfaceCourante } from "@/lib/interface/choix";
import ListeClients from "./_components/ListeClients";

export const metadata: Metadata = {
  title: "Clients — CoverSwap",
  description: "Clients pérennes : historique, provenance, recommandations.",
};

export const dynamic = "force-dynamic";

// Mission 22 (A4) : en v2 (`interfaceCourante()`), la même page Personnes que `/leads`, ouverte sur le segment
// « Clients » (`?q=` : la recherche d'abord) ; la v1 est servie telle quelle.
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = await interfaceCourante();
  if (v === "v2") {
    const parametres = await searchParams;
    const q = typeof parametres.q === "string" ? parametres.q.slice(0, 120) : "";
    return <PersonnesV2 segmentInitial="CLIENTS" leads={null} clients={await pageClients({ page: 1 })} qInitial={q} />;
  }
  // Mission 17 (partie B) : « D'où viennent les clients » a rejoint l'Analytique (onglet Argent, bloc du même nom).
  return <ListeClients initial={await pageClients({ page: 1 })} />;
}
