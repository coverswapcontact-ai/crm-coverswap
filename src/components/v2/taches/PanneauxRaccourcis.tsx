"use client";

import { useCallback, useMemo } from "react";
import { RelectureMail } from "@/components/pilotage/relances/FeuilleRelances";
import { PanneauEntrant } from "@/app/(pilotage)/leads/_components/PanneauEntrant";
import { PanneauMail } from "@/app/(pilotage)/mail/_components/PanneauMail";
import { FeuilleDateChantier } from "@/app/(pilotage)/taches/_components/FeuilleDateChantier";
import { FeuilleReponse } from "@/app/(pilotage)/taches/_components/FeuilleReponse";
import { PanneauDossierV2 } from "../dossier/PanneauDossierV2";
import type { GestesTaches } from "./useGestesTaches";

/**
 * Mission 22 (A2) — les panneaux et feuilles que les gestes ouvrent, montés une fois sous l'écran (comme en v1) :
 * le dossier (à la bonne rubrique), le mail (réponse ouverte), le contact entrant, la relecture d'un mail de relance,
 * la date du chantier, et la feuille des trois réponses (Fait, Plus tard, Pas à faire). Rien n'est réécrit : ce sont
 * les composants de la v1, branchés sur `useGestesTaches`.
 * Mission 22 (A3) — le panneau de dossier est celui de la v2 (`PanneauDossierV2`, monté seulement dans la coque v2) ;
 * `FeuillesRaccourcis` = tout sauf lui, pour le panneau de dossier lui-même (ses tâches ouvrent le mail, le contact,
 * la relecture, la date, la feuille de réponse, jamais un second panneau de dossier).
 */
export function FeuillesRaccourcis({ gestes, maintenant, relireApres }: { gestes: GestesTaches; maintenant: number; relireApres: () => void }) {
  const { ouvert, reponse, occupees, fermerRaccourci } = gestes;
  return (
    <>
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

export function PanneauxRaccourcis({ gestes, maintenant, relireApres }: { gestes: GestesTaches; maintenant: number; relireApres: () => void }) {
  const { ouvert, fermerRaccourci } = gestes;
  const rien = useCallback(() => undefined, []);
  const dateMaintenant = useMemo(() => new Date(maintenant), [maintenant]);
  return (
    <>
      <PanneauDossierV2 dossierId={ouvert?.vue === "DOSSIER" ? ouvert.dossierId : null} maintenant={dateMaintenant} onFermer={fermerRaccourci} onMisAJour={rien} demande={ouvert?.vue === "DOSSIER" ? ouvert.demande : null} />
      <FeuillesRaccourcis gestes={gestes} maintenant={maintenant} relireApres={relireApres} />
    </>
  );
}
