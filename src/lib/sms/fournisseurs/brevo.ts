import { EchecDefinitifSms, type AccuseEnvoi, type DemandeEnvoi, type FournisseurSms } from "./types";

/**
 * Brevo — SMS transactionnel, ENVOI SEUL.
 *
 * En France, Brevo ne permet pas au destinataire de répondre (documentation
 * Brevo : « For France, your contacts cannot reply »). Ce fournisseur convient
 * donc à l'accusé de réception et aux messages qui n'attendent pas de réponse ;
 * pour une vraie conversation il faut un numéro en 09 (voir ovh.ts).
 *
 * Variables : BREVO_API_KEY, BREVO_SMS_EXPEDITEUR (11 caractères au plus,
 * « CoverSwap » par défaut). BREVO_API_URL ne sert qu'aux essais.
 */
export const fournisseurBrevo: FournisseurSms = {
  nom: "brevo",
  bidirectionnel: false,
  expediteur: () => (process.env.BREVO_SMS_EXPEDITEUR?.trim() || "CoverSwap").slice(0, 11),

  async envoyer(demande: DemandeEnvoi): Promise<AccuseEnvoi> {
    const cle = process.env.BREVO_API_KEY?.trim();
    if (!cle) throw new EchecDefinitifSms("Brevo non configuré : BREVO_API_KEY absente.");
    const base = (process.env.BREVO_API_URL || "https://api.brevo.com/v3").replace(/\/$/, "");
    const reponse = await fetch(`${base}/transactionalSMS/send`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": cle },
      body: JSON.stringify({
        sender: this.expediteur(),
        recipient: demande.numero.replace(/^\+/, ""),
        content: demande.texte,
        type: "transactional",
        tag: demande.reference.slice(0, 50),
        unicodeEnabled: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const retour = await reponse.text();
    if (!reponse.ok) {
      const message = `Brevo : HTTP ${reponse.status} ${retour.slice(0, 300)}`;
      if ([400, 401, 402, 403].includes(reponse.status)) throw new EchecDefinitifSms(message);
      throw new Error(message);
    }
    const corps = JSON.parse(retour) as { messageId?: number | string; smsCount?: number; usedCredits?: number };
    if (corps.messageId === undefined) throw new Error(`Brevo : réponse sans identifiant de message (${retour.slice(0, 200)})`);
    return { identifiant: String(corps.messageId), segments: corps.smsCount, credits: corps.usedCredits };
  },
};
