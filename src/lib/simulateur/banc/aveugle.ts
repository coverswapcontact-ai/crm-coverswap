import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Mission 23 (L4a) — le jugement à l'aveugle (énoncé § 4) : pour chaque cas, une planche « avant » puis les rendus à
 * comparer, mélangés et nommés A, B, C… ; la clé (quelle lettre est quelle variante) est écrite à part dans
 * `cle.json`, à n'ouvrir qu'après avoir noté. Le mélange est tiré d'une graine (rejouable). Aucune image n'est écrite
 * ailleurs que dans le dossier donné (hors du dépôt : `~/coverswap-photos/calibrage/banc/aveugle/`).
 */

export type CasAveugle = { id: string; avant: string; colonnes: { cle: string; fichier: string }[] };

/** Générateur pseudo-aléatoire à graine (mulberry32) : le même mélange d'un lancement à l'autre. */
export function aleatoire(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function melanger<T>(liste: T[], tirage: () => number): T[] {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(tirage() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

export const LETTRES_AVEUGLE = "ABCDEFGH";

export async function planchesAveugles(entree: { dossier: string; cas: CasAveugle[]; graine: number }): Promise<{ dossier: string; cle: string; planches: number }> {
  const sharp = (await import("sharp")).default;
  await fs.mkdir(entree.dossier, { recursive: true });
  const tirage = aleatoire(entree.graine);
  const cle: Record<string, Record<string, string>> = {};
  const L = 720;
  const H = 540;
  const BANDE = 56;
  for (const c of entree.cas) {
    const colonnes = melanger(c.colonnes, tirage).slice(0, LETTRES_AVEUGLE.length);
    cle[c.id] = Object.fromEntries(colonnes.map((col, i) => [LETTRES_AVEUGLE[i], col.cle]));
    const tuiles = await Promise.all(
      [{ titre: "AVANT", fichier: c.avant }, ...colonnes.map((col, i) => ({ titre: LETTRES_AVEUGLE[i], fichier: col.fichier }))].map(async (t) => {
        const image = await sharp(t.fichier).rotate().resize(L, H, { fit: "contain", background: "#1b1b1b" }).toBuffer();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${BANDE}"><rect width="100%" height="100%" fill="#111"/><text x="14" y="38" font-family="Arial" font-size="30" font-weight="bold" fill="#ffd75e">${t.titre}</text></svg>`;
        return sharp({ create: { width: L, height: H + BANDE, channels: 3, background: "#111" } }).composite([{ input: image, top: 0, left: 0 }, { input: Buffer.from(svg), top: H, left: 0 }]).png().toBuffer();
      })
    );
    const largeur = tuiles.length * (L + 8) - 8;
    await sharp({ create: { width: largeur, height: H + BANDE, channels: 3, background: "#222" } })
      .composite(tuiles.map((t, i) => ({ input: t, top: 0, left: i * (L + 8) })))
      .jpeg({ quality: 88 })
      .toFile(path.join(entree.dossier, `${c.id}.jpg`));
  }
  const fichierCle = path.join(entree.dossier, "cle.json");
  await fs.writeFile(fichierCle, JSON.stringify({ graine: entree.graine, cle }, null, 2) + "\n");
  return { dossier: entree.dossier, cle: fichierCle, planches: entree.cas.length };
}
