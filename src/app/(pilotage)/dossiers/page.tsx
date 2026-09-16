import { listerDossiers } from "@/lib/dossiers/dossiers";
import { leadPourDossier } from "@/lib/dossiers/leads";
import DossiersPilotage from "./_components/DossiersPilotage";

export const dynamic = "force-dynamic";

// ?dossier=<id> ouvre directement le panneau d'un dossier ;
// ?lead=<id> ouvre « Ouvrir un dossier » pré-rempli depuis ce lead (fiche lead).
export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ [cle: string]: string | string[] | undefined }>;
}) {
  const parametres = await searchParams;
  const lead = typeof parametres.lead === "string" ? parametres.lead : null;
  const dossier = typeof parametres.dossier === "string" ? parametres.dossier : null;
  const [dossiers, leadInitial] = await Promise.all([listerDossiers(), lead ? leadPourDossier(lead) : null]);

  return (
    <DossiersPilotage
      dossiersInitiaux={dossiers}
      leadInitial={leadInitial}
      dossierInitialId={dossier}
    />
  );
}
