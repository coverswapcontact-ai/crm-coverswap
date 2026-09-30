import { TYPES_SURFACE } from "../types-surface";
import { construireModeleChatGPT } from "./modele-chatgpt";

/**
 * Le contenu de `prompts-defaut.ts`, généré (mission 15, partie 2) : un modèle
 * par type de surface du CRM, texte figé dans le dépôt (lisible dans un diff),
 * note « Moteur studio ». `scripts/generer-prompts-defaut.ts` l'écrit.
 */

export const NOTE_PROMPTS_STUDIO = "Moteur studio (mission 15) : prompt généré par le moteur de prompt du CRM";

export function promptsParDefautGeneres(): Record<string, { texte: string; note: string }> {
  return Object.fromEntries(TYPES_SURFACE.map((type) => [type.id, { texte: construireModeleChatGPT(type), note: `${NOTE_PROMPTS_STUDIO} — ${type.libelle.toLowerCase()}.` }]));
}

export function genererFichierPromptsDefaut(): string {
  const prompts = promptsParDefautGeneres();
  const entrees = Object.entries(prompts).map(([id, p]) => `  ${JSON.stringify(id)}: {\n    note: ${JSON.stringify(p.note)},\n    texte: ${JSON.stringify(p.texte)},\n  },`);
  return `/**
 * FICHIER GÉNÉRÉ — ne pas modifier à la main : \`npm run simulateur:prompts\`
 * (scripts/generer-prompts-defaut.ts → moteur/generer-prompts.ts → moteur/modele-chatgpt.ts).
 *
 * Bibliothèque de prompts ChatGPT (mission 15, partie 2) : la version 1 de
 * chaque prompt est le prompt du moteur en mode \`chatgpt\`, avec les marqueurs
 * de la bibliothèque (\`[zone:…]…[/zone]\`, \`{{teinte}}\`, \`{{etiquette}}\`,
 * \`{{nombre_echantillons}}\`, \`{{format}}\`, \`{{zones_inchangees}}\`,
 * \`{{direction_artistique}}\`) rendus par rendu.ts. Ces textes ne servent qu'à
 * poser la version de départ en base : ensuite, Lucas les modifie dans
 * Simulateur → Prompts, chaque modification étant une nouvelle version.
 */

export const PROMPTS_PAR_DEFAUT: Record<string, { texte: string; note: string }> = {
${entrees.join("\n")}
};
`;
}
