import type { Metadata } from "next";
import { listerLeads } from "@/lib/prospects/leads";
import { simulationsSiteRecentes } from "@/lib/simulations/site";
import EcranLeads from "./_components/EcranLeads";

export const metadata: Metadata = {
  title: "Leads — CoverSwap",
  description: "Tous les leads entrants sans dossier : priorité, attente d'appel, appels à la suite, ouverture du dossier en un bouton.",
};

export const dynamic = "force-dynamic";

// ?lead=<id> ouvre la fiche de ce contact (lien des notifications) ; ?appels=1 reprend les appels à la suite.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.lead) ? parametres.lead : null;
  // Mission 13 (B19) : les simulations faites sur le site cette semaine, visibles ici et non plus seulement par l'assistant.
  const [initial, site] = await Promise.all([listerLeads(), simulationsSiteRecentes(7)]);
  return <EcranLeads initial={initial} siteInitial={site} leadInitial={lead} appelsInitial={parametres.appels === "1"} />;
}
