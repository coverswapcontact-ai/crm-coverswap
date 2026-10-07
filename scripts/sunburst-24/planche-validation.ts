// Mission 24 — la page avant / après des rendus de validation : une ligne par rendu (photo cadrée, rendu Sunburst brut,
// rendu corrigé en couleur s'il y a lieu), avec la teinte, le score et le ΔE. Hors dépôt : planche-validation.jpg.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CADRE, RACINE, RENDUS } from "./commun";

const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function main() {
  const v = JSON.parse(fs.readFileSync(path.join(RACINE, "validation.json"), "utf8"));
  const journal = JSON.parse(fs.readFileSync(path.join(RACINE, "journal.json"), "utf8"));
  const cat = JSON.parse(fs.readFileSync(path.join(RACINE, "uploads/simulateur/catalogue.json"), "utf8"));
  const T = 560, H = 380, B = 64;
  const lignes: Buffer[] = [];
  for (const l of v.lignes) {
    const e = journal.find((x: { n: number }) => x.n === l.n);
    const ref = cat.find((r: { id: string }) => r.id === l.ref);
    const tuile = async (f: string | null, texte: string) => {
      const img = f ? await sharp(f).resize(T, H, { fit: "contain", background: "#111" }).toBuffer() : await sharp({ create: { width: T, height: H, channels: 3, background: "#222" } }).png().toBuffer();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${B}"><rect width="100%" height="100%" fill="#111"/>${texte.split("\n").map((t, i) => `<text x="8" y="${24 + i * 24}" font-size="18" font-family="Arial" fill="${i ? "#ddd" : "#ffd75e"}">${echapper(t)}</text>`).join("")}</svg>`;
      return sharp({ create: { width: T, height: H + B, channels: 3, background: "#111" } }).composite([{ input: img, top: 0, left: 0 }, { input: Buffer.from(svg), top: H, left: 0 }]).png().toBuffer();
    };
    const pastille = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="${ref.hex}" stroke="#fff" stroke-width="2"/></svg>`;
    const avant = await tuile(path.join(CADRE, `${l.photo}.png`), `${l.photo} — avant\n${l.ref} ${ref.nom} (${l.famille})`);
    const brut = await tuile(path.join(RENDUS, e.fichier), `Sunburst (prompt C1+C3) — ${e.cout.toFixed(3)} $\nscore ${l.scoreBrut} · ΔE ${l.deltaEBrut} · à clarté égale ${l.chromBrut}`);
    const corr = await tuile(l.fichierCorrige ? path.join(RACINE, "corriges", l.fichierCorrige) : null, l.fichierCorrige ? `Corrigé en couleur (${l.mode})\nscore ${l.scoreCorrige} · ΔE ${l.deltaECorrige} · à clarté égale ${l.chromCorrige}` : `Pas de correction (${l.famille})\n—`);
    const ligne = await sharp({ create: { width: 3 * T + 16, height: H + B, channels: 3, background: "#000" } })
      .composite([{ input: avant, left: 0, top: 0 }, { input: brut, left: T + 8, top: 0 }, { input: corr, left: 2 * T + 16, top: 0 }, { input: Buffer.from(pastille), left: T - 70, top: 10 }])
      .png().toBuffer();
    lignes.push(ligne);
  }
  const titre = `<svg xmlns="http://www.w3.org/2000/svg" width="${3 * T + 16}" height="50"><rect width="100%" height="100%" fill="#000"/><text x="10" y="34" font-size="26" font-family="Arial" fill="#fff">Mission 24 — validation sur 4 photos jamais vues : avant · Sunburst · corrigé (pastille = hex du catalogue)</text></svg>`;
  const haut = 50 + lignes.length * (H + B + 8);
  await sharp({ create: { width: 3 * T + 16, height: haut, channels: 3, background: "#000" } })
    .composite([{ input: Buffer.from(titre), top: 0, left: 0 }, ...lignes.map((l, i) => ({ input: l, top: 50 + i * (H + B + 8), left: 0 }))])
    .jpeg({ quality: 85 }).toFile(path.join(RACINE, "planche-validation.jpg"));
  console.log(path.join(RACINE, "planche-validation.jpg"));
}
void main();
