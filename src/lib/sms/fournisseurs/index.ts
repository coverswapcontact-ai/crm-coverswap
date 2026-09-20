import { fournisseurBrevo } from "./brevo";
import { fournisseurOvh, variablesOvhManquantes } from "./ovh";
import { fournisseurSimulateur } from "./simulateur";
import type { FournisseurSms } from "./types";

export type { AccuseEnvoi, DemandeEnvoi, EtatDistant, FournisseurSms, SmsEntrant } from "./types";
export { EchecDefinitifSms } from "./types";

export type EtatFournisseur = {
  /** Fournisseur retenu, ou null : aucun SMS ne peut partir. */
  nom: FournisseurSms["nom"] | null;
  bidirectionnel: boolean;
  expediteur: string | null;
  /** Ce qu'il faut poser sur Railway pour qu'un fournisseur existe, ou pour passer au bidirectionnel. */
  aPoser: string[];
  remarque: string | null;
};

/**
 * Le fournisseur en service. `SMS_FOURNISSEUR` l'impose (ovh, brevo, simulateur) ;
 * sinon OVH s'il est entièrement configuré (seul à recevoir les réponses en
 * France), puis Brevo, puis rien. Le simulateur ne se choisit jamais tout seul :
 * un CRM de production ne doit pas « envoyer » des SMS dans le vide.
 */
export function fournisseurSms(env: NodeJS.ProcessEnv = process.env): FournisseurSms | null {
  const impose = env.SMS_FOURNISSEUR?.trim().toLowerCase();
  if (impose === "simulateur") return fournisseurSimulateur;
  if (impose === "ovh") return fournisseurOvh;
  if (impose === "brevo") return fournisseurBrevo;
  if (variablesOvhManquantes(env).length === 0) return fournisseurOvh;
  if (env.BREVO_API_KEY?.trim()) return fournisseurBrevo;
  return null;
}

export function etatFournisseur(env: NodeJS.ProcessEnv = process.env): EtatFournisseur {
  const fournisseur = fournisseurSms(env);
  const ovhManquantes = variablesOvhManquantes(env);
  if (!fournisseur) {
    return { nom: null, bidirectionnel: false, expediteur: null, aPoser: ovhManquantes, remarque: "Aucun fournisseur de SMS configuré : rien ne peut partir, les messages restent en attente." };
  }
  if (fournisseur.nom === "brevo") {
    return {
      nom: "brevo",
      bidirectionnel: false,
      expediteur: fournisseur.expediteur(),
      aPoser: ovhManquantes,
      remarque: "Brevo envoie mais ne reçoit pas : en France, le client ne peut pas répondre à un SMS Brevo. Pour une conversation, configurer le numéro OVH (Time2Chat).",
    };
  }
  return {
    nom: fournisseur.nom,
    bidirectionnel: fournisseur.bidirectionnel,
    expediteur: fournisseur.expediteur(),
    aPoser: fournisseur.nom === "ovh" ? ovhManquantes : [],
    remarque: fournisseur.nom === "simulateur" ? "Simulateur : aucun SMS réel ne part." : null,
  };
}
