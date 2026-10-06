import { estRubriqueDossier } from "@/lib/dossiers/constants";
import { pageDossiers } from "@/lib/dossiers/dossiers";
import { clientPourDossier, leadPourDossier, prospectPourDossier } from "@/lib/dossiers/leads";
import { estEtapeEspace } from "@/lib/espace/etapes";
import { estFiltreEspace } from "@/lib/espace/suivi-types";
import { interfaceCourante } from "@/lib/interface/choix";
import DossiersPilotage from "./_components/DossiersPilotage";

export const dynamic = "force-dynamic";

// ?dossier=<id> ouvre directement le panneau d'un dossier ;
// ?lead=<id> ouvre « Ouvrir un dossier » pré-rempli depuis ce contact entrant ;
// ?prospect=<id>, depuis un établissement démarché ; ?client=<id>, depuis une fiche client.
// Mission 18 (A1) : ?espace=TOUS|MOI|CLIENT|SIGNAUX|DESACTIVES (&etapeEspace=…) ouvre le filtre « Espaces » (l'ancien
// onglet Espaces clients, /espaces y redirige) ; ?archives=1 ouvre les dossiers archivés (lien de l'assistant).
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
  const espace = estFiltreEspace(parametres.espace) ? parametres.espace : null;
  const etapeEspace = espace && estEtapeEspace(parametres.etapeEspace) ? parametres.etapeEspace : null;
  // Mission 22 (A3) : en v2 (`interfaceCourante()`), l'écran monte le panneau de dossier v2 ; la liste reste celle de la v1 (lot A4).
  const [dossiers, leadInitial, version] = await Promise.all([
    pageDossiers({ page: 1, ...(espace ? { espace, etapeEspace: etapeEspace ?? undefined } : {}) }),
    client ? clientPourDossier(client) : lead ? leadPourDossier(lead) : prospect ? prospectPourDossier(prospect) : null,
    interfaceCourante(),
  ]);

  return (
    <DossiersPilotage
      interface={version}
      initial={dossiers}
      leadInitial={leadInitial}
      dossierInitialId={dossier}
      demandeInitiale={dossier && rubrique ? { rubrique, cle: 1 } : null}
      espaceInitial={espace ? { filtre: espace, etape: etapeEspace } : null}
      archivesInitiales={parametres.archives === "1"}
    />
  );
}
