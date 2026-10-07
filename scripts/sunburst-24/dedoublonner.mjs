import os from "node:os"; import sharp from "sharp"; import fs from "node:fs"; import path from "node:path";
const J = os.homedir() + "/coverswap-photos/calibrage/jeu/jeu-essai-simulateur-2026-10-07";
const OUT = os.homedir() + "/coverswap-photos/sunburst-24";
const ids = fs.readdirSync(J).filter((d) => fs.existsSync(path.join(J, d, "meta.json")));
const vus = [];
for (const id of ids) {
  const m = JSON.parse(fs.readFileSync(path.join(J, id, "meta.json"), "utf8"));
  const f = path.join(J, id, m.fichiers.avant);
  const img = sharp(f).rotate();
  const meta = await img.metadata();
  const { data } = await sharp(f).rotate().resize(16, 16, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const moy = data.reduce((a, b) => a + b, 0) / data.length;
  const bits = [...data].map((v) => (v > moy ? 1 : 0));
  const proche = vus.find((v) => v.bits.reduce((s, b, i) => s + (b !== bits[i]), 0) < 20);
  const z = m.zones.map((z) => `${z.zone}=${z.ref}`).join(",");
  if (proche) { proche.sims.push({ id, z, creeLe: m.creeLe, origine: m.origine, modele: m.modeleSource }); continue; }
  vus.push({ id, bits, w: meta.width, h: meta.height, sims: [{ id, z, creeLe: m.creeLe, origine: m.origine, modele: m.modeleSource }] });
}
fs.writeFileSync(OUT + "/photos-distinctes.json", JSON.stringify(vus.map(({ bits, ...r }) => r), null, 1));
console.log("distinctes", vus.length);
const T = 300, H = 225, C = 6;
const tuiles = await Promise.all(vus.map(async (v, i) => {
  const im = await sharp(path.join(J, v.id, JSON.parse(fs.readFileSync(path.join(J, v.id, "meta.json"))).fichiers.avant)).rotate().resize(T, H, { fit: "contain", background: "#000" }).toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="${H}"><rect width="70" height="26" fill="#000"/><text x="4" y="20" font-size="18" font-family="Arial" fill="#ff0">${i}</text></svg>`;
  return sharp(im).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer();
}));
const rangs = Math.ceil(tuiles.length / C);
await sharp({ create: { width: C * T, height: rangs * H, channels: 3, background: "#222" } }).composite(tuiles.map((t, i) => ({ input: t, left: (i % C) * T, top: Math.floor(i / C) * H }))).jpeg({ quality: 80 }).toFile(OUT + "/planche-distinctes.jpg");
