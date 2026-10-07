// Mission 24 — écart entre le hex du catalogue (la cible du score) et la couleur de l'échantillon que le modèle voit
// (médiane de l'image d'échantillon, et analyse de couleur enregistrée du CRM) : gratuit.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { RACINE } from "./commun";
import { FAMILLES } from "./variantes";
import { deltaE2000, hexVersRgb, rgbVersLab, type Rgb } from "../../src/lib/simulations/teintes";

async function main() {
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8"));
  const analyses = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/analyses-couleur.json"), "utf8"));
  for (const [famille, refs] of Object.entries(FAMILLES)) for (const id of refs) {
    const r = cat.find((x: { id: string }) => x.id === id);
    const { data } = await sharp(path.join(RACINE, "uploads/simulateur/echantillons", `${id}.jpg`)).resize(200, 200, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const canaux = [0, 1, 2].map((c) => { const v: number[] = []; for (let i = c; i < data.length; i += 3) v.push(data[i]); v.sort((a, b) => a - b); return v[v.length >> 1]; }) as Rgb;
    const lh = rgbVersLab(hexVersRgb(r.hex)), le = rgbVersLab(canaux);
    const hexE = `#${canaux.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    console.log(`${famille.padEnd(9)} ${id.padEnd(5)} catalogue ${r.hex} | échantillon ${hexE} (analyse ${analyses[id]?.hex ?? "—"}) ΔE ${deltaE2000(le, lh).toFixed(1)} dL ${(le[0] - lh[0]).toFixed(1)} da ${(le[1] - lh[1]).toFixed(1)} db ${(le[2] - lh[2]).toFixed(1)}`);
  }
}
void main();
