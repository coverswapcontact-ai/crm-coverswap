// ─────────────────────────────────────────────────────────────────
// Envoi d'un devis ou d'une facture au client — STUB, non implémenté en V1.
//
// En V1, Lucas télécharge le PDF et l'envoie lui-même (mail, WhatsApp).
// Contrat prévu pour l'envoi automatique, à brancher plus tard :
//
// 1. Proposition : un agent (ou un bouton) prépare l'envoi — destinataire,
//    objet, message. Rien ne part sans validation humaine : la proposition
//    passe par la file de validation de /prospection (brouillon → validé /
//    édité / rejeté → envoyé, cf. StatutEmailDraft), pas par un second système.
// 2. Envoi validé : le document passe au statut ENVOYE et un événement est
//    écrit sur le dossier — DEVIS_ENVOYE (ou MAIL_ENVOYE / WHATSAPP_ENVOYE
//    pour le message qui l'accompagne), direction SORTANT, metadata
//    { documentId, canal, destinataire, messageId }.
// 3. Réponse du client : un événement MAIL_RECU / WHATSAPP_RECU, direction
//    ENTRANT, que l'agent lit pour proposer la suite (REGLES_ETAPES).
// ─────────────────────────────────────────────────────────────────

export type CanalEnvoi = "EMAIL" | "WHATSAPP";

export type DemandeEnvoi = {
  documentId: string;
  canal: CanalEnvoi;
  destinataire: string;
  objet?: string;
  message?: string;
};

export type ResultatEnvoi =
  | { ok: true; envoyeLe: Date; identifiantMessage: string }
  | { ok: false; raison: string };

export async function envoyerDocument(demande: DemandeEnvoi): Promise<ResultatEnvoi> {
  void demande;
  return {
    ok: false,
    raison: "Envoi automatique non disponible : télécharge le PDF et envoie-le au client.",
  };
}
