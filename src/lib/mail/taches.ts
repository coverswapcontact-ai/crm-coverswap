import { agentMailActif } from "@/lib/messages/consultation";
import { AttenteExterne, enregistrerTraitement, enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { ACTEUR_TRI, NOM_SYNCHRO_BOITE, TYPE_TACHE_ETAT_GMAIL, appliquerEtatGmail, synchroniserBoite } from "./boite";
import { TYPE_TACHE_ENVOI_MAIL, executerEnvoi, noterEchecEnvoi } from "./envoi-crm";
import { enregistrerTachesRattachement } from "./rattachement";
import { avancerSequences, sequencesActives } from "./sequences";

/**
 * Ce qui tourne en arrière-plan pour l'onglet Mail (mission 7) : la boîte
 * relue toutes les minutes par l'historique Gmail, Gmail qui suit les gestes
 * du CRM, les pièces jointes rangées, les envois. Les séquences ne tournent
 * que si Lucas en a activé une (aucune ne l'est à la livraison).
 */

const TENTATIVES_ENVOI = 6;

function idDe(charge: unknown, champ: string): string {
  const valeur = (charge as Record<string, unknown> | null)?.[champ];
  if (typeof valeur !== "string") throw new Error(`Charge invalide : ${champ} manquant`);
  return valeur;
}

export function enregistrerTachesMail(): void {
  enregistrerTravailPeriodique({
    nom: NOM_SYNCHRO_BOITE,
    libelle: "Boîte mail relue (historique Gmail, toutes les minutes) et triée",
    acteur: ACTEUR_TRI,
    intervalleMs: 60_000,
    estActif: async () => (await agentMailActif()) !== null,
    executer: async (signal) => {
      await synchroniserBoite({ signal });
    },
  });
  enregistrerTraitement(TYPE_TACHE_ETAT_GMAIL, {
    libelle: "Gmail suit le CRM (lu, archivé, rangé sous « CoverSwap/Rangé »)",
    acteur: "SYSTEME:boite-mail",
    tentativesMax: 6,
    executer: (charge) => appliquerEtatGmail(idDe(charge, "messageId")),
  });
  enregistrerTraitement(TYPE_TACHE_ENVOI_MAIL, {
    libelle: "Envoi d'un mail depuis la boîte Gmail (réponse validée ou notification de l'espace)",
    acteur: "SYSTEME:envoi-mail",
    delaiMaxMs: 2 * 60_000,
    tentativesMax: TENTATIVES_ENVOI,
    executer: async (charge, contexte) => {
      const envoiId = idDe(charge, "envoiId");
      try {
        return await executerEnvoi(envoiId);
      } catch (erreur) {
        if (!(erreur instanceof AttenteExterne) && contexte.tentative >= TENTATIVES_ENVOI) await noterEchecEnvoi(envoiId, erreur instanceof Error ? erreur.message : String(erreur));
        throw erreur;
      }
    },
  });
  enregistrerTachesRattachement((type, traitement) => enregistrerTraitement(type, traitement));
  enregistrerTravailPeriodique({
    nom: "sequences-mail",
    libelle: "Séquences de mails (seulement celles que Lucas a activées)",
    acteur: "SYSTEME:sequences",
    intervalleMs: 15 * 60_000,
    estActif: sequencesActives,
    executer: async () => {
      await avancerSequences();
    },
  });
}
