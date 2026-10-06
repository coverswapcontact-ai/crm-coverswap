"use client";

import { useCallback, useMemo } from "react";
import { RelectureMail } from "@/components/pilotage/relances/FeuilleRelances";
import { PanneauDossier } from "@/app/(pilotage)/dossiers/_components/PanneauDossier";
import { PanneauEntrant } from "@/app/(pilotage)/leads/_components/PanneauEntrant";
import { PanneauMail } from "@/app/(pilotage)/mail/_components/PanneauMail";
import { FeuilleDateChantier } from "@/app/(pilotage)/taches/_components/FeuilleDateChantier";
import { FeuilleReponse } from "@/app/(pilotage)/taches/_components/FeuilleReponse";
import type { GestesTaches } from "./useGestesTaches";

/**
 * Mission 22 (A2) — les panneaux et feuilles que les gestes ouvrent, montés une fois sous l'écran (comme en v1) :
 * le dossier (à la bonne rubrique), le mail (réponse ouverte), le contact entrant, la relecture d'un mail de relance,
 * la date du chantier, et la feuille des trois réponses (Fait, Plus tard, Pas à faire). Rien n'est réécrit : ce sont
 * les composants de la v1, branchés sur `useGestesTaches`.
 */
export function PanneauxRaccourcis({ gestes, maintenant, relireApres }: { gestes: GestesTaches; maintenant: number; relireApres: () => void }) {
  const { ouvert, reponse, occupees, fermerRaccourci } = gestes;
  const rien = useCallback(() => undefined, []);
  const dateMaintenant = useMemo(() => new Date(maintenant), [maintenant]);
  return (
    <>
      <PanneauDossier dossierId={ouvert?.vue === "DOSSIER" ? ouvert.dossierId : null} maintenant={dateMaintenant} onFermer={fermerRaccourci} onMisAJour={rien} demande={ouvert?.vue === "DOSSIER" ? ouvert.demande : null} />
      <PanneauMail messageId={ouvert?.vue === "MAIL" ? ouvert.messageId : null} nouveauPour={null} repondre onFermer={fermerRaccourci} onChange={relireApres} />
      <PanneauEntrant id={ouvert?.vue === "LEAD" ? ouvert.leadId : null} onFermer={fermerRaccourci} onModifie={relireApres} />
      {ouvert?.vue === "RELANCE" ? <RelectureMail propositionId={ouvert.propositionId} dossierId={ouvert.dossierId} onFini={fermerRaccourci} /> : null}
      <FeuilleDateChantier dossierId={ouvert?.vue === "PLANIFIER" ? ouvert.dossierId : null} onFini={fermerRaccourci} />
      <FeuilleReponse
        demande={reponse}
        maintenant={maintenant}
        occupe={reponse ? occupees.has(reponse.tache.id) : false}
        onFermer={() => gestes.setReponse(null)}
        onRepondre={(tache, entree) => void gestes.repondre(tache, entree)}
        onApercu={(tache) => {
          gestes.setReponse(null);
          gestes.lancer(tache);
        }}
      />
    </>
  );
}
