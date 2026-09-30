// Mission 15 (partie 2) : régénère src/lib/simulateur/prompts-defaut.ts (la
// version 1 de chaque prompt ChatGPT) depuis le moteur de prompt
// (`moteur/modele-chatgpt.ts`). Le fichier n'est plus maintenu à la main :
//   npm run simulateur:prompts
// Les versions déjà en base (celles de Lucas) ne sont pas touchées ; la
// migration « prompts-studio-15 » pose une version de plus sur les prompts
// jamais modifiés.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { genererFichierPromptsDefaut } from "../src/lib/simulateur/moteur/generer-prompts";

const fichier = path.resolve(__dirname, "..", "src", "lib", "simulateur", "prompts-defaut.ts");
writeFileSync(fichier, genererFichierPromptsDefaut(), "utf8");
console.log(`[simulateur] prompts par défaut régénérés : ${fichier}`);
