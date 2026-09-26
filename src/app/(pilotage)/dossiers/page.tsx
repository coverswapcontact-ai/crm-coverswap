import { estRubriqueDossier } from "@/lib/dossiers/constants";
import { listerDossiers } from "@/lib/dossiers/dossiers";
import { clientPourDossier, leadPourDossier, prospectPourDossier } from "@/lib/dossiers/leads";
import DossiersPilotage from "./_components/DossiersPilotage";

export const dynamic = "force-dynamic";

// ?dossier=<id> ouvre directement le panneau d'un dossier ;
// ?lead=<id> ouvre « Ouvrir un dossier » pré-rempli depuis ce contact entrant ;
// ?prospect=<id>, depuis un établissement démarché ; ?client=<id>, depuis une fiche client.
export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ [cle: string]: string | string[] | undefined }>;
}) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" ? parametres.lead : null;
  const client = typeof parametres.client === "string" ? parametres.client : null;
  const prospect = typeof parametres.prospect === "string" ? parametres.prospect : null;
  const dossier = typeof parametres.dossier === "string" ? parametres.dossier : null;
  // Mission 13 (lot 4) : ?rubrique=photos|messages|devis|encaisser|historique|etape ouvre le panneau sur cette rubrique.
  const rubrique = typeof parametres.rubrique === "string" && estRubriqueDossier(parametres.rubrique) ? parametres.rubrique : null;
  const [dossiers, leadInitial] = await Promise.all([
    listerDossiers(),
    client ? clientPourDossier(client) : lead ? leadPourDossier(lead) : prospect ? prospectPourDossier(prospect) : null,
  ]);

  return (
    <DossiersPilotage
      dossiersInitiaux={dossiers}
      leadInitial={leadInitial}
      dossierInitialId={dossier}
      demandeInitiale={dossier && rubrique ? { rubrique, cle: 1 } : null}
    />
  );
}
