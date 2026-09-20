/**
 * Ce que le CRM attend d'un fournisseur de SMS, et rien de plus : envoyer,
 * relever ce qui est arrivé, dire où en est un envoi. Le reste (conversations,
 * STOP, validation, événements du dossier) ne dépend d'aucun fournisseur.
 */
export type DemandeEnvoi = {
  /** Destinataire au format international : +33612345678. */
  numero: string;
  texte: string;
  /** Identifiant du SMS côté CRM, transmis au fournisseur quand il sait le garder (étiquette). */
  reference: string;
};

export type AccuseEnvoi = {
  /** Identifiant du message chez le fournisseur : sert au suivi de remise. */
  identifiant: string;
  segments?: number;
  credits?: number;
};

export type SmsEntrant = {
  /** Identifiant du message chez le fournisseur : c'est lui qui rend la relève idempotente. */
  identifiant: string;
  /** Expéditeur, tel que donné par le fournisseur (normalisé ensuite). */
  numero: string;
  texte: string;
  recuLe: Date;
};

export type EtatDistant = { statut: "ENVOYE" | "DELIVRE" | "ECHEC"; detail?: string; le?: Date };

export interface FournisseurSms {
  readonly nom: "ovh" | "brevo" | "simulateur";
  /** Vrai : le client peut répondre au même numéro, et ses réponses reviennent au CRM. */
  readonly bidirectionnel: boolean;
  /** Numéro ou nom affiché chez le destinataire. */
  expediteur(): string;
  envoyer(demande: DemandeEnvoi): Promise<AccuseEnvoi>;
  /** Messages reçus depuis une date (fournisseurs sans webhook : la relève périodique). */
  releverEntrants?(depuis: Date): Promise<SmsEntrant[]>;
  /** État de remise d'un envoi ; null = pas encore connu. */
  etat?(identifiant: string): Promise<EtatDistant | null>;
}

/** Erreur du fournisseur qui ne sert à rien de réessayer (numéro invalide, crédit épuisé, clé refusée). */
export class EchecDefinitifSms extends Error {}
