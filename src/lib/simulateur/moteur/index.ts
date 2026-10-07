import { ZONES_MAX, estIdZone, type IdZone } from "../zones";
import { blocAffectation, blocArtDirection, blocAvoid, blocFinalCheck, blocImages, blocLocked, blocMethode, blocOutput, blocPiece, blocQualitePhoto, blocRealisme, blocRole, type ContexteBlocs, type FilmDistinct } from "./blocs";
import { directionArtistique } from "./direction-artistique";
import { BLOCS, type EntreeMoteur, type Etiquette, type NomBloc, type PromptConstruit, type ZoneMoteur } from "./types";
import { blocCouleurDeplacee, construirePromptRetouche } from "./variantes";

/**
 * L'assembleur du moteur (mission 15, partie 2) : `construirePrompt(entree)`
 * rend le prompt « studio » en 12 blocs, la direction artistique et chaque
 * bloc à part (relecture, essais). Fonction pure : ce que le site, l'espace,
 * le CRM (mode API), la bibliothèque ChatGPT et le banc appellent.
 */

export type { AnalysePhoto, EntreeMoteur, Etiquette, FormatImage, ModeMoteur, PromptConstruit, ReferenceMoteur, VarianteMoteur, ZoneMoteur } from "./types";
export { BLOCS, VARIANTES_MOTEUR, estVarianteMoteur, formatDepuisDimensions } from "./types";
export { directionArtistique } from "./direction-artistique";

const LETTRES: Etiquette[] = ["A", "B", "C", "D"];

/** Les lettres des zones, dans l'ordre donné (A, B, C, D) ; au-delà de ZONES_MAX, on refuse plutôt que de tronquer en silence. */
export function etiquettesPour<T extends { zone: IdZone }>(zones: T[]): (T & { etiquette: Etiquette })[] {
  if (zones.length > LETTRES.length) throw new Error(`Au plus ${ZONES_MAX} zones par rendu (${zones.length} demandées).`);
  return zones.map((z, i) => ({ ...z, etiquette: LETTRES[i] }));
}

/** Les films distincts, dans l'ordre des lettres ; le rang d'image (2, 3…) sert au mode échantillons bruts. */
export function filmsDistincts(zones: ZoneMoteur[]): FilmDistinct[] {
  const films: FilmDistinct[] = [];
  for (const z of zones) {
    const existant = films.find((f) => f.reference.ref === z.reference.ref);
    if (existant) {
      existant.zones.push(z);
      existant.etiquettes.push(z.etiquette);
    } else films.push({ reference: z.reference, zones: [z], etiquettes: [z.etiquette], image: films.length + 2 });
  }
  return films;
}

export function construirePrompt(entree: EntreeMoteur): PromptConstruit {
  if (entree.zones.length === 0) throw new Error("Le moteur a besoin d'au moins une zone.");
  if (entree.zones.length > ZONES_MAX) throw new Error(`Au plus ${ZONES_MAX} zones par rendu.`);
  for (const z of entree.zones) if (!estIdZone(z.zone)) throw new Error(`Zone inconnue : ${z.zone}.`);
  const ctx: ContexteBlocs = { entree, films: filmsDistincts(entree.zones) };
  const direction = directionArtistique(entree.piece, entree.zones);
  const blocs: Record<NomBloc, string> = {
    ROLE: blocRole(ctx),
    IMAGES: blocImages(ctx),
    ART_DIRECTION: blocArtDirection(ctx, direction),
    METHODE: blocMethode(),
    PIECE: blocPiece(ctx),
    AFFECTATION: blocAffectation(ctx),
    REALISME: blocRealisme(ctx),
    QUALITE_PHOTO: blocQualitePhoto(),
    LOCKED: blocLocked(ctx),
    AVOID: blocAvoid(),
    FINAL_CHECK: blocFinalCheck(ctx),
    OUTPUT: blocOutput(ctx),
  };
  // Mission 23 (L4a) : les variantes de la campagne de calibrage ; sans variante (ou `actuel`), le texte d'avant à l'octet près.
  const variante = entree.variante ?? "actuel";
  const parties = BLOCS.map((b) => blocs[b]);
  const texte =
    variante === "retouche"
      ? construirePromptRetouche(ctx)
      : variante === "ordre"
        ? [blocCouleurDeplacee(ctx, "tete"), ...parties].join("\n\n")
        : variante === "ordre-fin"
          ? [...parties, blocCouleurDeplacee(ctx, "fin")].join("\n\n")
          : parties.join("\n\n");
  return { texte, blocs, directionArtistique: direction, version: "v2", variante };
}

/** Vrai si le texte contient un emoji ou un pictogramme (interdit dans un prompt). */
export function contientEmoji(texte: string): boolean {
  return /\p{Extended_Pictographic}/u.test(texte);
}
