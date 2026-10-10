import { pluriel } from "@/lib/commun/format";
import type { BaseDonnees } from "@/lib/prisma";
import { definitionSms } from "@/lib/sms/catalogue";
import type { MigrationDonnees } from "./index";

/**
 * Mission 25 (lot 3) — règle d'or 9 : « Lucas de CoverSwap » seulement au premier contact. Les quatorze SMS de l'écran
 * SMS qui se présentaient encore (« c'est Lucas de CoverSwap », « À très vite, Lucas de CoverSwap ») prennent leur
 * nouveau texte de départ (`sms/catalogue.ts`), seulement si la ligne porte encore l'ancien texte mot pour mot : un
 * texte que Lucas a réécrit n'est jamais touché. Les deux accusés de réception (premier contact) ne changent pas.
 * Rejouable : un texte déjà nouveau ne bouge plus.
 */

const NOM = "sms-sans-presentation-25";

/** Les textes de départ d'avant (mission 14), mot pour mot. */
export const ANCIENS_TEXTES_25: Record<string, string> = {
  PAS_DE_REPONSE_SIMULATION: "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre simulation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.",
  PAS_DE_REPONSE: "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.",
  PAS_DE_REPONSE_2: "Bonjour, c'est encore Lucas de CoverSwap. Je n'arrive pas à vous joindre : répondez-moi ici avec un moment qui vous arrange, ou dites-moi simplement si le projet n'est plus d'actualité.",
  A_RAPPELER: "Merci pour votre réponse ! C'est noté, je vous rappelle {quand}. À très vite, Lucas de CoverSwap.",
  LIEN_ESPACE: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. {lien}",
  LIEN_ESPACE_SIMULATION: "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel, avec la suite de votre projet : {lien}",
  INJOIGNABLE_LIEN: "Bonjour {prenom}, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet. Votre espace personnel est prêt, vous pouvez y déposer quelques photos quand vous voulez : {lien}",
  LIEN_ESPACE_RAPPEL: "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : {lien}",
  LIEN_ESPACE_NOUVEAU: "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici le nouveau lien de votre espace, l'ancien ne fonctionne plus : {lien}",
  SIMULATION_PRETE: "Bonjour {prenom}, c'est Lucas de CoverSwap. Votre simulation est en ligne dans votre espace, dites-moi ce que vous en pensez : {lien}",
  RELANCE_DEVIS_1: "Bonjour, c'est Lucas de CoverSwap. Avez-vous pu regarder votre devis ? Il est toujours dans votre espace client. Je reste disponible si vous avez des questions.",
  RELANCE_DEVIS_2: "Bonjour, c'est Lucas de CoverSwap. Je reviens vers vous pour votre devis : s'il vous reste une question ou si le projet n'est plus d'actualité, dites-le-moi simplement.",
  DEMANDE_AVIS: "Bonjour {prenom}, c'est Lucas de CoverSwap. Merci encore pour votre confiance. Si le résultat vous plaît, votre avis nous aide beaucoup : il se donne en un clic depuis votre espace : {lien}",
  REACTIVATION: "Bonjour {prenom}, c'est Lucas de CoverSwap. Où en est votre projet de rénovation ? S'il est toujours d'actualité, répondez-moi ici. STOP pour ne plus en recevoir.",
};

export async function retirerLaPresentation(client: BaseDonnees): Promise<Record<string, number>> {
  let reecrits = 0;
  let gardes = 0;
  for (const [code, ancien] of Object.entries(ANCIENS_TEXTES_25)) {
    const nouveau = definitionSms(code)?.defaut;
    const ligne = await client.modeleSms.findUnique({ where: { code }, select: { id: true, texte: true, archiveLe: true } });
    if (!nouveau || !ligne || ligne.archiveLe || ligne.texte === nouveau) continue;
    if (ligne.texte !== ancien) {
      gardes++;
      continue;
    }
    await client.modeleSms.update({ where: { id: ligne.id }, data: { texte: nouveau } });
    reecrits++;
  }
  console.info(`[migration ${NOM}] ${pluriel(reecrits, "texte réécrit", "textes réécrits")}, ${pluriel(gardes, "texte de Lucas gardé", "textes de Lucas gardés")}`);
  return { reecrits, gardes };
}

export const migrationSmsSansPresentation25: MigrationDonnees = {
  nom: NOM,
  description: "Les SMS de l'écran SMS ne se présentent plus (« Lucas de CoverSwap » au premier contact seulement) ; un texte réécrit par Lucas n'est pas touché",
  executer: (client) => retirerLaPresentation(client),
};

/**
 * Mission 25 (lot 3) — les deux réglages de la messagerie ont une valeur par défaut (Manuel, active) : posées une fois,
 * datées, pour que Paramètres → SMS les montre au lieu de « À renseigner ». Rien ne change dans le fonctionnement ; une
 * valeur déjà saisie n'est jamais réécrite.
 */
const NOM_REGLAGES = "messagerie-reglages-25";
const REGLAGES_PAR_DEFAUT = [
  { cle: "MESSAGERIE_MODE_ENVOI", valeur: "MANUEL" },
  { cle: "MESSAGERIE_PAUSE", valeur: "ACTIVE" },
] as const;

export async function poserReglagesMessagerie(client: BaseDonnees): Promise<Record<string, number>> {
  let poses = 0;
  for (const { cle, valeur } of REGLAGES_PAR_DEFAUT) {
    if (await client.parametre.findFirst({ where: { cle }, select: { id: true } })) continue;
    await client.parametre.create({ data: { cle, valeur: JSON.stringify(valeur), valableDu: new Date("2026-09-25T00:00:00.000Z"), source: "Valeur par défaut de la messagerie (mission 25)" } });
    poses++;
  }
  console.info(`[migration ${NOM_REGLAGES}] ${pluriel(poses, "réglage posé", "réglages posés")}`);
  return { poses };
}

export const migrationReglagesMessagerie25: MigrationDonnees = {
  nom: NOM_REGLAGES,
  description: "Pose les valeurs par défaut de la messagerie (mode d'envoi Manuel, préparation active) si rien n'est saisi",
  executer: (client) => poserReglagesMessagerie(client),
};
