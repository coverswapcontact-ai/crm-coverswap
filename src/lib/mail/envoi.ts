import { Resend } from "resend";
import { PORTEES_GOOGLE, connexionActive } from "@/lib/google/connexion";

/**
 * Envoi d'un mail vers un client. Aucun appelant ne décide seul d'envoyer :
 * seule l'exécution d'une proposition validée par une personne arrive ici
 * (src/lib/mail/propositions.ts).
 *
 * L'envoyeur est choisi à l'envoi : celui des essais s'il est posé ; sinon la
 * boîte Gmail de l'entreprise si elle est connectée avec l'accès d'envoi (le
 * mail figure alors dans ses « Messages envoyés » et une réponse reste dans sa
 * conversation) ; sinon Resend si RESEND_API_KEY et EMAIL_FROM sont
 * configurées. Sans envoyeur, rien ne part et la tâche échoue en le disant.
 */

export type PieceJointe = { nom: string; type: string; contenu: Buffer };

export type MessageSortant = {
  a: string;
  objet: string;
  texte: string;
  repondreA?: string;
  pieces?: PieceJointe[];
  /** Réponse à un mail reçu : la conversation est conservée. */
  enReponseA?: { fil: string | null; messageIdEntete: string | null; references: string | null } | null;
};

export type EnvoiRealise = {
  identifiant: string | null;
  /** Fil de la conversation chez le fournisseur (boîte Gmail). */
  fil?: string | null;
  /** Boîte d'où le mail est parti, quand il y figure (il n'est alors pas relevé une seconde fois). */
  compte?: string | null;
};

export type EnvoyeurMail = {
  nom: string;
  envoyer(message: MessageSortant): Promise<EnvoiRealise>;
};

const CLE = "__coverswapEnvoyeurMailEssai";
const globalEssai = globalThis as unknown as Record<string, EnvoyeurMail | null | undefined>;

/** Essais seulement : remplace l'envoyeur (null : aucun envoyeur). */
export function definirEnvoyeurMailEssai(envoyeur: EnvoyeurMail | null): void {
  globalEssai[CLE] = envoyeur;
}

/** Essais seulement : revient au choix réel de l'envoyeur. */
export function oublierEnvoyeurMailEssai(): void {
  delete globalEssai[CLE];
}

function envoyeurResend(): EnvoyeurMail | null {
  const cle = process.env.RESEND_API_KEY;
  const expediteur = process.env.EMAIL_FROM;
  if (!cle || !expediteur) return null;
  return {
    nom: "Resend",
    async envoyer(message) {
      const entetes: Record<string, string> = {};
      if (message.enReponseA?.messageIdEntete) {
        entetes["In-Reply-To"] = message.enReponseA.messageIdEntete;
        entetes.References = [message.enReponseA.references, message.enReponseA.messageIdEntete].filter(Boolean).join(" ");
      }
      const { data, error } = await new Resend(cle).emails.send({
        from: expediteur,
        to: message.a,
        subject: message.objet,
        text: message.texte,
        replyTo: message.repondreA,
        headers: Object.keys(entetes).length ? entetes : undefined,
        attachments: message.pieces?.map((piece) => ({ filename: piece.nom, content: piece.contenu, contentType: piece.type })),
      });
      if (error) throw new Error(`Envoi refusé par Resend : ${error.message}`);
      return { identifiant: data?.id ?? null };
    },
  };
}

function envoyeurGmail(compte: string): EnvoyeurMail {
  return {
    nom: "Gmail",
    async envoyer(message) {
      // Import à la demande : le client Gmail ne se charge que pour un envoi.
      const [{ construireMime }, { envoyerMessageGmail }] = await Promise.all([import("@/lib/messages/mime"), import("@/lib/messages/gmail")]);
      const mime = construireMime({
        de: compte,
        deNom: "CoverSwap",
        a: message.a,
        objet: message.objet,
        texte: message.texte,
        repondreA: message.repondreA,
        enReponseA: message.enReponseA?.messageIdEntete ?? null,
        references: message.enReponseA?.references ?? null,
        pieces: message.pieces,
      });
      const envoye = await envoyerMessageGmail(mime, message.enReponseA?.fil ?? null);
      return { identifiant: envoye.id, fil: envoye.threadId, compte };
    },
  };
}

export async function envoyeurMail(): Promise<EnvoyeurMail | null> {
  if (globalEssai[CLE] !== undefined) return globalEssai[CLE] ?? null;
  const gmail = await connexionActive(PORTEES_GOOGLE.GMAIL_ENVOYER);
  if (gmail) return envoyeurGmail(gmail.compte);
  return envoyeurResend();
}
