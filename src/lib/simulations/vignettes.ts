import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Le catalogue du site et ses vignettes réelles (mission 19) : lus par le relevé des teintes (`teintes.ts`) et par les
 * éditions qui reçoivent des échantillons (`ambiances.ts`, série 2). Une vignette (le champ `image` du catalogue) est
 * téléchargée une fois dans le dossier des vignettes, puis relue sur le disque.
 */
export const CATALOGUE_DEFAUT = () => path.resolve(process.cwd(), "..", "coverswap", "src", "data", "revetements.json");

export type Revetement = { id: string; nom: string; famille: string; image: string; hex: string; tags?: string[] };

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export function lireCatalogue(texte: string): Revetement[] {
  const brut = JSON.parse(texte) as unknown;
  const liste = Array.isArray(brut) ? brut : Object.values(brut as Record<string, unknown>).flat();
  return z.array(z.object({ id: z.string(), nom: z.string(), famille: z.string(), image: z.string(), hex, tags: z.array(z.string()).optional() }).passthrough()).parse(liste) as Revetement[];
}

/** La vignette réelle d'une référence dans `<dossier>/<id>.<ext>` : téléchargée une fois, sinon relue. */
export async function vignetteLocale(ref: Revetement, dossier: string): Promise<string> {
  const ext = path.extname(new URL(ref.image).pathname) || ".jpg";
  const fichier = path.join(dossier, `${ref.id}${ext}`);
  if (existsSync(fichier)) return fichier;
  await fs.mkdir(dossier, { recursive: true });
  const reponse = await fetch(ref.image);
  if (!reponse.ok) throw new Error(`Vignette ${ref.id} introuvable (HTTP ${reponse.status}).`);
  await fs.writeFile(fichier, Buffer.from(await reponse.arrayBuffer()));
  return fichier;
}

/** Une vignette prête à joindre à une édition : 512 × 512, PNG (le format des images d'entrée du service). */
export async function vignetteEnEntree(fichier: string): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(fichier).resize(512, 512, { fit: "cover" }).png().toBuffer();
}
