// Calibrage Sunburst (consigne du gérant du 07/10, mission 23) — chemins communs. Tout ce qui est image, masque, photo
// ou journal vit HORS dépôt : `~/coverswap-photos/sunburst-23/` pour cette campagne, et les données de la mission 24
// (`~/coverswap-photos/sunburst-24/` : lot, cadrages, masques dessinés, 45 rendus, journal) sont relues sans être
// réécrites. Le dépôt ne garde que le code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RACINE as RACINE_24 } from "../sunburst-24/commun";

export { CADRE as CADRE_24, RENDUS as RENDUS_24, RACINE as RACINE_24 } from "../sunburst-24/commun";
export const RACINE = path.join(os.homedir(), "coverswap-photos", "sunburst-23");
export const LOT = path.join(RACINE, "lot");
export const CADRE = path.join(RACINE, "cadre");
export const MASQUES_AUTO = path.join(RACINE, "masques-auto");
export const RENDUS = path.join(RACINE, "rendus");
export const S0 = path.join(RACINE, "s0");
export const JOURNAL = path.join(RACINE, "journal.json");
export const CATALOGUE = path.join(RACINE_24, "uploads/simulateur/catalogue.json");

for (const d of [LOT, CADRE, MASQUES_AUTO, RENDUS, S0]) fs.mkdirSync(d, { recursive: true });

/** Les rendus de la mission 24 dont la couleur ne se mesure pas : p07 (masque englobant four et chaises, hors statistiques
 *  en mission 24), v01 (capture d'écran minuscule : « cas perdu »). */
export const PHOTOS_HORS_MESURE = ["p07", "v01"];

/** Le cadrage d'une photo : celle de la mission 24 (p01-p12, v01-v04), sinon celle de cette campagne (w01…). */
export const cheminCadre = (photo: string) => {
  const ici = path.join(CADRE, `${photo}.png`);
  return fs.existsSync(ici) ? ici : path.join(RACINE_24, "cadre", `${photo}.png`);
};
