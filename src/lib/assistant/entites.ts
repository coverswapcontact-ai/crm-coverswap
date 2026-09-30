import { ENTITES_ARGENT } from "./entites/argent";
import { ENTITES_CONTACTS } from "./entites/contacts";
import { ENTITES_REGLAGES } from "./entites/reglages";
import { ENTITES_SITE } from "./entites/site";
import { ENTITES, type DefinitionEntite, type Entite } from "./entites/socle";

/**
 * Le registre des entités de l'assistant (mission 17, partie C ; docs/MCP-COUVERTURE.md § 4.1 à 4.5). Une entité, un
 * vocabulaire : LEAD, DOSSIER, CLIENT, COORDONNEE, CONSENTEMENT, NOTE, NOTE_APPEL, DOCUMENT, ENCAISSEMENT, DEPENSE,
 * SIMULATION, TARIF, SOUS_PARTIE, PUBLICATION, REGLE_EXPEDITEUR, TACHE, PARAMETRE, COMPTEUR, AUTOMATISME, MODELE_SMS,
 * MODELE_MAIL, GUIDE_STYLE, CONSIGNES, POSITIONNEMENT, PROMPT_SIMULATION, REPRISE.
 *
 * Chacune porte, une seule fois : son résolveur (identifiant, ou cible par nom ; candidats en cas de doute ; archivés
 * lisibles), la fonction de service de l'écran avec le schéma zod de sa route (les champs permis, en snake_case pour
 * Claude, camelCase pour le service), la sensibilité par champ (client, argent, paramètre, irréversible → aperçu, puis
 * jeton), et ce qu'elle sait faire : modifier, créer, archiver, restaurer (ou restaurer une version). Les outils
 * génériques (`outils/generiques.ts`) ne font que lire ce registre.
 */

export * from "./entites/socle";

export const REGISTRE_ENTITES: Readonly<Record<Entite, DefinitionEntite>> = Object.fromEntries([...ENTITES_CONTACTS, ...ENTITES_ARGENT, ...ENTITES_SITE, ...ENTITES_REGLAGES].map((d) => [d.code, d])) as Record<Entite, DefinitionEntite>;

const avec = (f: (d: DefinitionEntite) => unknown) => ENTITES.filter((e) => Boolean(f(REGISTRE_ENTITES[e]))) as unknown as [Entite, ...Entite[]];

/** Ce que chaque outil générique accepte (l'ordre du registre). */
export const ENTITES_MODIFIABLES = avec((d) => d.modifier);
export const ENTITES_CREABLES = avec((d) => d.creer);
export const ENTITES_ARCHIVABLES = avec((d) => d.archiver);
export const ENTITES_RESTAURABLES = avec((d) => d.restaurer || d.restaurerVersion);

export function entite(code: Entite): DefinitionEntite {
  const d = REGISTRE_ENTITES[code];
  if (!d) throw new Error(`Entité inconnue : ${code}`);
  return d;
}
