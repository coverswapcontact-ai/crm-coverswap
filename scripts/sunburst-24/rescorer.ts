// Mission 24 — recalcule le score de chaque rendu du journal (masques corrigés, score modifié) : gratuit.
import fs from "node:fs";
import path from "node:path";
import type { Reference } from "../../src/lib/simulateur/catalogue";
import { CADRE, JOURNAL, RACINE, RENDUS } from "./commun";
import { lireMasques, masqueBinaire, masqueTroue } from "./masques";
import { lireJournal } from "./rendre";
import { scorer } from "./score";

async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8")) as Reference[];
  const masques = lireMasques();
  const j = lireJournal();
  for (const e of j) {
    if (!e.fichier) continue;
    const { binaire: data, largeur, hauteur } = await masqueTroue(e.photo, masques[e.photo]);
    const zone = (await masqueBinaire(e.photo, masques[e.photo])).data;
    e.score = await scorer(path.join(CADRE, `${e.photo}.png`), path.join(RENDUS, e.fichier), data, largeur, hauteur, cat.find((r) => r.id === e.ref)!, zone);
    const s = e.score;
    console.log(`n°${e.n} ${e.photo} ${e.ref} ${e.variante} : ${s.total} | ΔE ${s.couleur.deltaE} (chrom ${s.couleur.chromatique}) ${s.couleur.mesure} L${s.couleur.derive.L} a${s.couleur.derive.a} b${s.couleur.derive.b} C${s.couleur.derive.C} | contours ${s.fidelite.contoursHors} dérive ${s.fidelite.deriveHors} | structure −${s.structure.perte}% | tex ${s.finition.texture} refl ${s.finition.reflets}%`);
  }
  fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
}
void main();
