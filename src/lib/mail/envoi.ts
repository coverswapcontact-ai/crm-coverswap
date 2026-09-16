import { Resend } from "resend";

/**
 * Envoi d'un mail vers un client. Aucun appelant ne décide seul d'envoyer :
 * seule l'exécution d'une proposition validée par une personne arrive ici
 * (src/lib/mail/propositions.ts).
 *
 * L'envoyeur est choisi à l'envoi : celui des essais s'il est posé, sinon
 * Resend si RESEND_API_KEY et EMAIL_FROM sont configurées. (La boîte Gmail
 * s'ajoutera ici quand elle sera connectée.) Sans envoyeur, rien ne part et la
 * tâche échoue en le disant.
 */

export type PieceJointe = { nom: string; type: string; contenu: Buffer };

export type MessageSortant = {
  a: string;
  objet: string;
  texte: string;
  repondreA?: string;
  pieces?: PieceJointe[];
};

export type EnvoyeurMail = {
  nom: string;
  envoyer(message: MessageSortant): Promise<{ identifiant: string | null }>;
};

const CLE = "__coverswapEnvoyeurMailEssai";
const globalEssai = globalThis as unknown as Record<string, EnvoyeurMail | null | undefined>;

/** Essais seulement : remplace l'envoyeur (null pour revenir au réel). */
export function definirEnvoyeurMailEssai(envoyeur: EnvoyeurMail | null): void {
  globalEssai[CLE] = envoyeur;
}

function envoyeurResend(): EnvoyeurMail | null {
  const cle = process.env.RESEND_API_KEY;
  const expediteur = process.env.EMAIL_FROM;
  if (!cle || !expediteur) return null;
  return {
    nom: "Resend",
    async envoyer(message) {
      const { data, error } = await new Resend(cle).emails.send({
        from: expediteur,
        to: message.a,
        subject: message.objet,
        text: message.texte,
        replyTo: message.repondreA,
        attachments: message.pieces?.map((piece) => ({ filename: piece.nom, content: piece.contenu, contentType: piece.type })),
      });
      if (error) throw new Error(`Envoi refusé par Resend : ${error.message}`);
      return { identifiant: data?.id ?? null };
    },
  };
}

export function envoyeurMail(): EnvoyeurMail | null {
  if (globalEssai[CLE] !== undefined) return globalEssai[CLE] ?? null;
  return envoyeurResend();
}
