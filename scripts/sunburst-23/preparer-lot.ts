// Calibrage Sunburst, phase S0 (gratuite) — fige les photos de VALIDATION de S4 : des photos de cuisine du jeu exporté
// le 07/10 jamais utilisées, ni par la mission 24 (p01-p12, v01-v04, ni leurs doublons), ni par le banc de la mission
// 23, copiées hors dépôt sous des identifiants anonymes (w01…) et cadrées comme le pipeline les donne au modèle
// (`cadrerPourGeneration`, mode rogner). Elles ne sont ni rendues ni mesurées avant S4. Copie aussi la vignette du
// catalogue d'AA01 (deuxième bois clair) dans le cache d'échantillons des scripts.
//   node --import tsx scripts/sunburst-23/preparer-lot.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cadrerPourGeneration, tailleSelonRatio } from "../../src/lib/simulations/cadrage";
import { dimensionsImage } from "../../src/lib/simulations/generation";
import { CADRE, LOT, RACINE_24 } from "./commun";

const JEU = path.join(os.homedir(), "coverswap-photos/calibrage/jeu/jeu-essai-simulateur-2026-10-07");

/**
 * Index dans `sunburst-24/photos-distinctes.json` (dédoublonnage par empreinte de la mission 24). Écartés : ceux du lot
 * de la mission 24 (0, 1, 3, 5, 6, 9, 11, 12, 13, 23, 24, 26, 29, 37, 39), ceux du banc de la mission 23 (3, 6, 17, 27,
 * 37) et la photo du même dossier que le cas RM30 (28), les deux vues de la cuisine rouge proche de la capture p02 (2,
 * 35), les salles de bains et ce qui n'est pas une cuisine (4, 10, 22, 32, 36, 40, 41). Choisis pour varier la lumière :
 * w01 jour franc et façades à cadre, w02 contre-jour et façades blanches à cadre, w03 soleil rasant au sol et façades
 * crème, w04 lumière artificielle, façades grises sombres ; w05 et w06 en réserve (une photo inutilisable à l'œil est
 * remplacée par la suivante, et c'est écrit).
 */
const CHOIX: [string, number, string][] = [
  ["w01", 22, "U de jour, façades beiges à cadre bois"],
  ["w02", 18, "contre-jour, façades blanches à cadre"],
  ["w03", 19, "façades crème, soleil rasant au sol"],
  ["w04", 14, "lumière artificielle, façades grises, encombrée"],
  ["w05", 31, "réserve : façades blanches laquées, fenêtre"],
  ["w06", 7, "réserve : façades crème, linéaire"],
];

async function main() {
  const distinctes = JSON.parse(fs.readFileSync(path.join(RACINE_24, "photos-distinctes.json"), "utf8")) as { id: string }[];
  const manifeste = [];
  for (const [id, index, description] of CHOIX) {
    const source = distinctes[index].id;
    const meta = JSON.parse(fs.readFileSync(path.join(JEU, source, "meta.json"), "utf8")) as { fichiers: { avant: string } };
    const octets = fs.readFileSync(path.join(JEU, source, meta.fichiers.avant));
    fs.writeFileSync(path.join(LOT, `${id}.jpg`), octets);
    const dims = dimensionsImage(octets)!;
    const c = await cadrerPourGeneration(octets, tailleSelonRatio(dims.width, dims.height), "rogner");
    fs.writeFileSync(path.join(CADRE, `${id}.png`), c.photo);
    manifeste.push({ id, description, role: "validation-s4", source, taille: c.taille });
    console.log(id, c.taille, description);
  }
  fs.writeFileSync(path.join(LOT, "lot.json"), JSON.stringify(manifeste, null, 1));
  // La vignette d'AA01 (catalogue Cover Styl', pas une photo de client), depuis le cache local du CRM.
  const vignette = path.join(process.cwd(), ".uploads/simulateur/echantillons/AA01.jpg");
  const dest = path.join(RACINE_24, "uploads/simulateur/echantillons/AA01.jpg");
  if (fs.existsSync(vignette) && !fs.existsSync(dest)) fs.copyFileSync(vignette, dest);
  console.log(`vignette AA01 : ${fs.existsSync(dest) ? "présente" : "ABSENTE"}`);
}
void main();
