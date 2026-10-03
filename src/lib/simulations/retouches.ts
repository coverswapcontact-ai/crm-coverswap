/**
 * Photos, série 2 — les retouches demandées par Lucas après relecture (03/10/2026), dans le plafond de la série.
 *
 * - Bouilloires hors cuisine : édition de l'avant retenu, puis on ne recolle que la zone de la bouilloire (bord
 *   adouci) sur l'original : rien d'autre ne peut changer, même si le modèle a retouché ailleurs. Pas de masque :
 *   avec gpt-image-2.5-sunburst il a coûté 0,25 $ (6 208 jetons de sortie) et rendu une tout autre photo (03/10).
 *   Avant de recoller, on vérifie que l'image rendue est calée autour de la zone (`ecartAutourDeLaZone`). Quand la
 *   bouilloire n'est pas posée sur une surface couverte, la même zone corrigée est recopiée dans les après retenus
 *   (`recopier`, sans appel) ; sinon chaque après retenu est corrigé de la même façon (`corriger`).
 * - Variantes : de nouveaux essais d'une image de la liste, numérotés après les essais existants, avec une phrase
 *   ajoutée au prompt (`ajout`) ou un passage remplacé (`remplacer`), sans réécrire le reste.
 *
 * Les originaux remplacés sont gardés dans `<racine>/originaux/`. Leur présence marque une retouche faite : le script
 * ne la refait pas.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const zone = z.tuple([z.number().min(0).max(100), z.number().min(0).max(100), z.number().positive().max(100), z.number().positive().max(100)]);
export type ZoneRetouche = z.infer<typeof zone>;

const schemaRetouches = z
  .object({
    /** Le prompt des éditions qui retirent une bouilloire (le même pour toutes). */
    prompt_bouilloire: z.string().min(20),
    bouilloires: z.array(
      z
        .object({
          /** Le nom de l'avant dans la liste ; son essai retenu vient de `zones-serie-2.json` (choix). */
          avant: z.string().min(1),
          /** Zone de la bouilloire en % de l'image : [x, y, largeur, hauteur]. */
          zone,
          /** Après où la même zone corrigée est recopiée (bouilloire posée hors des surfaces couvertes). */
          recopier: z.array(z.string()).optional(),
          /** Après corrigés un par un (bouilloire posée sur une surface couverte). */
          corriger: z.array(z.string()).optional(),
        })
        .strict()
    ),
    variantes: z.array(
      z
        .object({
          nom: z.string().min(1),
          essais: z.number().int().min(1).max(4),
          ajout: z.string().optional(),
          remplacer: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
          /** Pourquoi (repris dans le journal et le compte rendu). */
          motif: z.string().min(1),
        })
        .strict()
        .refine((v) => v.ajout || v.remplacer, { message: "ajout ou remplacer" })
    ),
  })
  .strict();
export type Retouches = z.infer<typeof schemaRetouches>;
export type Variante = Retouches["variantes"][number];

export function lireRetouches(texte: string): Retouches {
  return schemaRetouches.parse(JSON.parse(texte));
}

/** Le prompt d'une variante : la phrase ajoutée à la fin, ou le passage remplacé (qui doit exister tel quel). */
export function promptVariante(prompt: string, variante: Pick<Variante, "nom" | "ajout" | "remplacer">): string {
  let sortie = prompt;
  if (variante.remplacer) {
    const [avant, apres] = variante.remplacer;
    if (!sortie.includes(avant)) throw new Error(`${variante.nom} : « ${avant} » absent du prompt.`);
    sortie = sortie.replace(avant, apres);
  }
  if (variante.ajout) sortie = `${sortie.trimEnd()}${/[.!?]$/.test(sortie.trimEnd()) ? "" : "."} ${variante.ajout}`;
  return sortie;
}

/** Les numéros des `n` prochains essais : après le plus grand déjà présent dans le dossier. */
export function prochainsEssais(dossier: string, nom: string, n: number, max = 10): number[] {
  let dernier = 0;
  for (let k = 1; k <= max; k++) if (existsSync(path.join(dossier, `${nom}-${k}.png`))) dernier = k;
  return Array.from({ length: n }, (_, i) => dernier + 1 + i);
}

const enPixels = (z: ZoneRetouche, largeur: number, hauteur: number) => {
  const left = Math.max(0, Math.round((z[0] / 100) * largeur));
  const top = Math.max(0, Math.round((z[1] / 100) * hauteur));
  return { left, top, width: Math.min(largeur - left, Math.round((z[2] / 100) * largeur)), height: Math.min(hauteur - top, Math.round((z[3] / 100) * hauteur)) };
};

/**
 * L'écart moyen (0-255, par canal, en 512 px de large) entre deux images dans l'ANNEAU autour de la zone (la zone
 * élargie de moitié de chaque côté, moins la zone) : c'est là que se fait le raccord du recollage. Une édition qui a
 * glissé ou rendu une autre photo y dépasse vite 15 ; une édition calée reste sous quelques unités.
 */
export async function ecartAutourDeLaZone(a: Buffer, b: Buffer, z: ZoneRetouche): Promise<number> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(a).metadata();
  const L = 512;
  const H = Math.round(((meta.height ?? 1) * L) / (meta.width ?? 1));
  const pa = await sharp(a).resize(L, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const pb = await sharp(b).resize(L, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const dedans = (x: number, y: number, m: number) => x >= ((z[0] - z[2] * m) / 100) * L && x <= ((z[0] + z[2] * (1 + m)) / 100) * L && y >= ((z[1] - z[3] * m) / 100) * H && y <= ((z[1] + z[3] * (1 + m)) / 100) * H;
  let somme = 0;
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < L; x++) {
      if (!dedans(x, y, 0.5) || dedans(x, y, 0)) continue;
      const i = (y * L + x) * 3;
      for (let c = 0; c < 3; c++) somme += Math.abs(pa[i + c] - pb[i + c]);
      n += 3;
    }
  return n ? somme / n : 0;
}

/**
 * Recolle la zone de `retouche` sur `original`, bord adouci (flou gaussien du masque, `adoucir` px) : hors de la zone
 * élargie de 2 × `adoucir`, l'original reste au pixel près. La retouche est remise à la taille de l'original.
 */
export async function recollerZone(original: Buffer, retouche: Buffer, z: ZoneRetouche, adoucir = 8): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(original).metadata();
  const largeur = meta.width ?? 0;
  const hauteur = meta.height ?? 0;
  const r = enPixels(z, largeur, hauteur);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}"><rect width="100%" height="100%" fill="#000"/><rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="#fff"/></svg>`;
  const alpha = await sharp(Buffer.from(svg)).blur(adoucir).greyscale().extractChannel(0).raw().toBuffer();
  const piece = await sharp(retouche).resize(largeur, hauteur, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const fond = await sharp(original).removeAlpha().raw().toBuffer();
  const sortie = Buffer.alloc(fond.length);
  for (let i = 0, p = 0; p < alpha.length; p++, i += 3) {
    const a = alpha[p] / 255;
    for (let c = 0; c < 3; c++) sortie[i + c] = Math.round(fond[i + c] * (1 - a) + piece[i + c] * a);
  }
  return sharp(sortie, { raw: { width: largeur, height: hauteur, channels: 3 } }).png().toBuffer();
}
