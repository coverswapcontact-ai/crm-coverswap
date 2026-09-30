import type { Metadata } from "next";
import { compterLeadsEnRetard, listerLeads, type VueLeads } from "@/lib/prospects/leads";
import { simulationsSiteRecentes } from "@/lib/simulations/site";
import { travauxSiteRecents } from "@/lib/simulations/travaux-lecture";
import { entonnoirSite } from "@/lib/site/evenements";
import EcranLeads from "./_components/EcranLeads";

export const metadata: Metadata = {
  title: "Leads — CoverSwap",
  description: "Les leads sans dossier, en deux listes : à appeler (jamais appelés) et à rappeler (date de rappel modifiable d'un geste). Appels à la suite, ouverture du dossier en un bouton.",
};

export const dynamic = "force-dynamic";

// ?lead=<id> ouvre la fiche de ce contact (lien des notifications) ; ?appels=1 reprend les appels à la suite ;
// ?liste=appeler|rappeler force la liste (mission 14). Sans elle : « À rappeler » s'il y a des retards, sinon « À appeler ».
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.lead) ? parametres.lead : null;
  const demandee: VueLeads | null = parametres.liste === "appeler" ? "A_APPELER" : parametres.liste === "rappeler" ? "A_RAPPELER" : null;
  const vue: VueLeads = demandee ?? ((await compterLeadsEnRetard()) > 0 ? "A_RAPPELER" : "A_APPELER");
  // Mission 13 (B19) : les simulations faites sur le site cette semaine, visibles ici et non plus seulement par l'assistant.
  // Mission 15 (partie 1) : et les générations encore en cours ou en échec, avec la raison.
  // Mission 15 (partie 4) : et l'entonnoir du simulateur (pièce → photo → génération → résultat vu → coordonnées), avec les abandons.
  const [initial, site, travaux, entonnoir] = await Promise.all([listerLeads({ vue, page: 1 }), simulationsSiteRecentes(7), travauxSiteRecents(7), entonnoirSite(7)]);
  return <EcranLeads initial={initial} vueInitiale={vue} siteInitial={site} travauxInitial={travaux} entonnoirInitial={entonnoir} leadInitial={lead} appelsInitial={parametres.appels === "1"} />;
}
