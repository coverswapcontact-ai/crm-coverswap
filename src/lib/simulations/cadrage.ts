/**
 * Cadrage de la photo pour le modèle d'image.
 *
 * Le modèle ne sort que trois formats (1536×1024, 1024×1536, 1024×1024). Une
 * photo de téléphone en 16:9 ou 4:3 envoyée telle quelle est recadrée par le
 * modèle à sa façon : le rendu n'est plus superposable à l'original.
 *
 * Mode « rogner » (par défaut) : la photo est coupée, centrée, au format du
 * modèle ; la même image coupée est rendue au site comme « avant ». Avant et
 * après ont donc le même cadrage par construction.
 * Mode « miroir » (SIMULATION_CADRAGE=miroir) : la photo reste entière, les
 * marges la prolongent en miroir et le rendu est recoupé sur elle. Des bandes
 * unies ont été essayées : le modèle les comble (pièce prolongée, objets
 * inventés, scène décalée). Le miroir n'a pas pu être validé faute de crédit.
 * Mode « aucun » : ancien comportement.
 *
 * sharp est chargé à la demande : s'il manque, la photo part telle quelle.
 */
export type TailleSortie = "1536x1024" | "1024x1536" | "1024x1024";
export type Zone = { left: number; top: number; width: number; height: number };
export type ModeCadrage = "rogner" | "miroir" | "aucun";
export type Cadrage = { photo: Buffer; type: string; taille: TailleSortie; zone: Zone | null; /** La photo telle que le modèle la voit, quand elle a été rognée : c'est l'« avant » à montrer. */ avant: Buffer | null };

export function modeCadrage(): ModeCadrage {
  const v = process.env.SIMULATION_CADRAGE;
  return v === "miroir" || v === "aucun" ? v : "rogner";
}

/** Marge rognée sur les côtés prolongés : la jonction avec le miroir bave parfois d'un ou deux pixels. */
const MARGE = 2;

type Sharp = typeof import("sharp");
async function chargerSharp(): Promise<Sharp | null> {
  try {
    const charge = await import("sharp");
    return (charge.default ?? charge) as Sharp;
  } catch {
    return null;
  }
}

export function tailleSelonRatio(largeur: number, hauteur: number): TailleSortie {
  const ratio = largeur / hauteur;
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.85) return "1024x1536";
  return "1024x1024";
}

/** Zone occupée par une photo posée entière et centrée dans la toile. */
export function zoneDansToile(largeur: number, hauteur: number, taille: TailleSortie): Zone {
  const [L, H] = taille.split("x").map(Number);
  const echelle = Math.min(L / largeur, H / hauteur);
  const width = Math.min(L, Math.round(largeur * echelle));
  const height = Math.min(H, Math.round(hauteur * echelle));
  return { left: Math.floor((L - width) / 2), top: Math.floor((H - height) / 2), width, height };
}

export async function cadrerPourGeneration(photo: Buffer, tailleParDefaut: TailleSortie = "1024x1024", mode: ModeCadrage = modeCadrage()): Promise<Cadrage> {
  const sharp = mode === "aucun" ? null : await chargerSharp();
  if (!sharp) return { photo, type: "image/png", taille: tailleParDefaut, zone: null, avant: null };
  try {
    const image = sharp(photo).rotate(); // applique l'orientation EXIF si elle existe encore
    const meta = await image.metadata();
    const tourne = (meta.orientation ?? 1) >= 5;
    const largeur = (tourne ? meta.height : meta.width) ?? 0;
    const hauteur = (tourne ? meta.width : meta.height) ?? 0;
    if (!largeur || !hauteur) return { photo, type: "image/png", taille: tailleParDefaut, zone: null, avant: null };
    const taille = tailleSelonRatio(largeur, hauteur);
    const [L, H] = taille.split("x").map(Number);
    if (mode === "rogner") {
      const dejaAuFormat = Math.abs(largeur / hauteur - L / H) < 0.02;
      const rognee = await image.resize(L, H, { fit: dejaAuFormat ? "fill" : "cover", position: "centre" }).png().toBuffer();
      const avant = dejaAuFormat ? null : await sharp(rognee).jpeg({ quality: 88 }).toBuffer();
      return { photo: rognee, type: "image/png", taille, zone: null, avant };
    }
    const zone = zoneDansToile(largeur, hauteur, taille);
    // Les marges prolongent la photo en miroir : une bande unie serait « comblée » par le modèle
    // (pièce prolongée, objets inventés, scène décalée). Un bord en miroir ne lui donne rien à réparer,
    // et il est recoupé après la génération.
    const toile = await image
      .resize(zone.width, zone.height, { fit: "fill" })
      .extend({ top: zone.top, bottom: H - zone.height - zone.top, left: zone.left, right: L - zone.width - zone.left, extendWith: "mirror" })
      .png()
      .toBuffer();
    return { photo: toile, type: "image/png", taille, zone, avant: null };
  } catch (e) {
    console.error("[simulate] cadrage impossible, photo envoyée telle quelle :", e);
    return { photo, type: "image/png", taille: tailleParDefaut, zone: null, avant: null };
  }
}

/** Recoupe le rendu sur la zone de la photo : les bandes disparaissent, le cadrage d'origine revient. */
export async function recadrerRendu(rendu: Buffer, cadrage: Pick<Cadrage, "zone" | "taille">): Promise<Buffer> {
  const { zone } = cadrage;
  if (!zone) return rendu;
  const sharp = await chargerSharp();
  if (!sharp) return rendu;
  try {
    const [L, H] = cadrage.taille.split("x").map(Number);
    const meta = await sharp(rendu).metadata();
    if (meta.width !== L || meta.height !== H) return rendu; // format inattendu : on ne coupe pas à l'aveugle
    const margeX = zone.width < L ? MARGE : 0;
    const margeY = zone.height < H ? MARGE : 0;
    if (!margeX && !margeY) return rendu;
    return await sharp(rendu)
      .extract({ left: zone.left + margeX, top: zone.top + margeY, width: zone.width - 2 * margeX, height: zone.height - 2 * margeY })
      .png()
      .toBuffer();
  } catch (e) {
    console.error("[simulate] recoupe du rendu impossible :", e);
    return rendu;
  }
}
