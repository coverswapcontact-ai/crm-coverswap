import type { Metadata } from "next";
import { etatAgents, listerProspects } from "@/lib/prospects/demarchage";
import { listerEntrants } from "@/lib/prospects/entrants";
import ProspectsPilotage from "./_components/ProspectsPilotage";

export const metadata: Metadata = {
  title: "Prospects — CoverSwap",
  description: "Contacts entrants et démarchage, jusqu'à l'ouverture d'un dossier.",
};

export const dynamic = "force-dynamic";

// ?onglet=entrants|demarchage ; ?lead=<id> ouvre un contact (liens des mails de
// notification, du journal, des dossiers) ; ?prospect=<id> un établissement ;
// ?nouveau=1 la saisie d'un contact.
export default async function ProspectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" ? parametres.lead : null;
  const prospect = typeof parametres.prospect === "string" ? parametres.prospect : null;
  const onglet = parametres.onglet === "demarchage" || (prospect && !lead) ? "demarchage" : "entrants";
  const [entrants, prospects, agents] = await Promise.all([listerEntrants(), listerProspects(), etatAgents()]);
  return (
    <ProspectsPilotage
      ongletInitial={onglet}
      entrantsInitiaux={entrants}
      demarchageInitial={{ ...prospects, ...agents }}
      leadInitialId={lead}
      prospectInitialId={prospect}
      nouveauInitial={parametres.nouveau === "1"}
    />
  );
}
