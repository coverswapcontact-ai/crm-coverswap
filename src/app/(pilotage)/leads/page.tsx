import type { Metadata } from "next";
import { PersonnesV2 } from "@/components/v2/personnes/PersonnesV2";
import { interfaceCourante } from "@/lib/interface/choix";
import { listerLeads, type VueLeads } from "@/lib/prospects/leads";
import { simulationsSiteRecentes } from "@/lib/simulations/site";
import { travauxSiteRecents } from "@/lib/simulations/travaux-lecture";
import { segmentDeLaListe, vueDuSegment } from "@/lib/v2/personnes";
import EcranLeads from "./_components/EcranLeads";

export const metadata: Metadata = {
  title: "Leads — CoverSwap",
  description: "Les leads sans dossier, en deux listes : à appeler (jamais appelés) et à rappeler (date de rappel modifiable d'un geste). Appels à la suite, ouverture du dossier en un bouton.",
};

export const dynamic = "force-dynamic";

// ?lead=<id> ouvre la fiche de ce contact (lien des notifications) ; ?appels=1 reprend les appels à la suite ;
// ?liste=appeler|rappeler force la liste (mission 14). Sans elle : « À appeler », toujours (mission 25, lot 6).
// Mission 22 (A4) : en v2 (`interfaceCourante()`), l'écran Personnes (`components/v2/personnes/PersonnesV2`), ouvert sur
// « À appeler » (ou `?liste=appeler|rappeler|sans-suite|archives`), avec `?q=` (la loupe de la coque) ; la v1 est servie telle quelle.
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" && /^[a-z0-9]{10,40}$/i.test(parametres.lead) ? parametres.lead : null;
  const v = await interfaceCourante();
  if (v === "v2") {
    const segment = segmentDeLaListe(parametres.liste, "A_APPELER");
    const vue = vueDuSegment(segment);
    const q = typeof parametres.q === "string" ? parametres.q.slice(0, 120) : "";
    return <PersonnesV2 segmentInitial={segment} leads={vue ? await listerLeads({ vue, page: 1 }) : null} clients={null} leadInitial={lead} appelsInitial={parametres.appels === "1"} qInitial={q} />;
  }
  // Mission 25 (lot 6) : l'écran s'ouvre toujours sur « À appeler », jamais sur « À rappeler » (sauf ?liste=rappeler).
  const vue: VueLeads = parametres.liste === "rappeler" ? "A_RAPPELER" : "A_APPELER";
  // Mission 13 (B19) : les simulations faites sur le site cette semaine, visibles ici et non plus seulement par l'assistant.
  // Mission 15 (partie 1) : et les générations encore en cours ou en échec, avec la raison.
  // Mission 17 (partie B) : l'entonnoir du simulateur est parti dans l'Analytique (onglet Site, « Entonnoir du simulateur »).
  const [initial, site, travaux] = await Promise.all([listerLeads({ vue, page: 1 }), simulationsSiteRecentes(7), travauxSiteRecents(7)]);
  return <EcranLeads initial={initial} vueInitiale={vue} siteInitial={site} travauxInitial={travaux} leadInitial={lead} appelsInitial={parametres.appels === "1"} />;
}
