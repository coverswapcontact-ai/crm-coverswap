import { EventEmitter } from "node:events";

/**
 * Temps réel de la messagerie : un émetteur d'événements dans le processus
 * (une seule instance sur Railway), lu par la route /api/sms/flux en
 * Server-Sent Events. L'écran n'y apprend que « cette conversation a bougé » —
 * il va ensuite chercher ce qui a changé. Si le flux tombe, l'écran se rabat
 * sur une relève toutes les dix secondes : rien ne dépend de lui.
 */
export type EvenementSms = { genre: "MESSAGE" | "STATUT" | "CONVERSATION"; conversationId: string; smsId?: string };

const CLE = "__coverswapFluxSms";
const globalFlux = globalThis as unknown as Record<string, EventEmitter | undefined>;
const emetteur = (globalFlux[CLE] ??= new EventEmitter().setMaxListeners(100));

export function publierEvenementSms(evenement: EvenementSms): void {
  emetteur.emit("sms", evenement);
}

export function ecouterEvenementsSms(ecouteur: (evenement: EvenementSms) => void): () => void {
  emetteur.on("sms", ecouteur);
  return () => emetteur.off("sms", ecouteur);
}
