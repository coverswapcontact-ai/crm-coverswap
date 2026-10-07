import { ZONES_SIMULATEUR, piece as lirePiece, zonesCouvertes, zonesElementaires, type IdZoneElementaire } from "../zones";
import { nomEchantillonFilm, nomEchantillonZone, type ContexteBlocs, type FilmDistinct } from "./blocs";
import { decrireFilm, profilDe, type Profil } from "./materiaux";
import { teinteEnMots } from "./teinte-en-mots";
import { TAILLES } from "./types";

/**
 * Mission 23 (L4a) — les variantes du prompt pour la campagne de calibrage (P3). Jamais un réglage de production :
 * le prompt par défaut (`actuel`) reste celui des 12 blocs, et `PROMPTS_PAR_DEFAUT` n'en dépend pas (test qui le fige).
 * Une seule chose change à la fois :
 *  - `retouche` : la variante prioritaire du gérant (essai manuel du 07/10), en version générique — « EDIT Image 1, do
 *    not create a new image », la teinte en mots en plus du hex (`teinte-en-mots.ts`), les surfaces de la photo nommées
 *    une à une, la liste de ce qui reste identique, et pour finir « compare with the sample before you output… » dans
 *    le sens de la dérive mesurée pour la famille ;
 *  - `ordre` / `ordre-fin` : la consigne de teinte du prompt actuel (les lignes des films du bloc MATERIAL REALISM, mot
 *    pour mot) placée en tête, ou répétée en fin ;
 *  - `planche-neutre` : la planche change (vignettes plus grandes, gris neutre, mire blanche) ; le prompt ne change que
 *    dans la phrase du bloc IMAGES qui la décrit (`blocImages`).
 */

const MATIERE_COURTE: Partial<Record<Profil, string>> = {
  "uni-mat": "solid matt colour, no pattern at all",
  "uni-brillant": "solid gloss colour, no pattern at all",
  "uni-raye": "solid colour with fine tone-on-tone embossed stripes",
  bois: "wood-grain decor, the grain at true scale exactly as on the sample",
  "bois-peint": "painted-wood look, an opaque colour with a faint tone-on-tone grain",
  marbre: "marble decor, veins as on the sample at true scale",
  pierre: "natural-stone decor as on the sample, no tile joints",
  terrazzo: "terrazzo decor as on the sample",
  beton: "concrete decor with soft mottling, no joints",
  tissu: "fine textile weave, reading as a soft plain from room distance",
  cuir: "leather-look film reading as an almost plain, soft surface",
};

/** Les lignes de couleur du prompt actuel (bloc MATERIAL REALISM, une par film), mot pour mot : la consigne de `ordre`. */
export function lignesCouleurActuelles(ctx: ContexteBlocs): string[] {
  return ctx.films.map((f) => `${nomEchantillonFilm(ctx, f)} — ${decrireFilm(f.reference, f.zones[0]?.zone ?? null)}`);
}

/** Le bloc de la consigne de teinte déplacée (`ordre`) ou répétée (`ordre-fin`). */
export function blocCouleurDeplacee(ctx: ContexteBlocs, position: "tete" | "fin"): string {
  const titre = position === "tete" ? "COLOUR — READ THIS FIRST" : "COLOUR — CHECK IT AGAIN BEFORE YOU OUTPUT";
  return `${titre}\n${lignesCouleurActuelles(ctx).map((l) => `- ${l}`).join("\n")}`;
}

/** Les surfaces de la photo couvertes par une zone, nommées une à une (description de l'analyse quand elle les voit). */
function surfacesDeLaZone(ctx: ContexteBlocs, zone: IdZoneElementaire): string | null {
  const vue = ctx.entree.analyse?.zones_visibles?.[zone];
  if (vue && vue.visible === false) return null;
  const description = vue?.description?.trim().replace(/\.$/, "");
  return `the ${ZONES_SIMULATEUR[zone].nomCourt}${description ? ` (${description})` : ""}`;
}

function ligneCouleur(ctx: ContexteBlocs, f: FilmDistinct): string {
  const r = f.reference;
  const mots = teinteEnMots(r);
  const matiere = MATIERE_COURTE[profilDe(r)] ?? "decor exactly as on the sample";
  const teinte = mots ? mots.phrase : "exactly the colour of the sample";
  return `${nomEchantillonFilm(ctx, f)}, ${r.ref} "${r.nom}": ${teinte}. ${matiere[0].toUpperCase()}${matiere.slice(1)}; the room's light and shadows fall on it, they never change its hue.`;
}

/** La variante `retouche` : le prompt court en mode édition, construit à partir des zones et des références. */
export function construirePromptRetouche(ctx: ContexteBlocs): string {
  const { entree } = ctx;
  const p = lirePiece(entree.piece);
  const images =
    entree.mode === "api-swatches"
      ? ctx.films.length === 1
        ? "Image 2 is a flat sample of the adhesive film"
        : `Images 2 to ${ctx.films.length + 1} are flat samples of the adhesive films, one per material`
      : "Image 2 is the labelled sample board, one square sample per surface";
  const tete = `EDIT Image 1, do not create a new image. Image 1 is a phone photo of ${p.nomEn}; ${images}. Keep Image 1 exactly as it is and change only the colour and material of the surfaces listed below, as if an adhesive decor film had been laid on them.`;

  const surfaces = entree.zones.flatMap((z) => {
    const nommees = zonesCouvertes(z.zone).map((el) => surfacesDeLaZone(ctx, el)).filter((s): s is string => s !== null);
    const liste = nommees.length ? nommees : [`the ${ZONES_SIMULATEUR[z.zone].nomCourt}`];
    return liste.map((s) => `- ${s} → ${nomEchantillonZone(ctx, z)} (${z.reference.ref} "${z.reference.nom}"), covered completely up to its limits, edges included; nothing beyond them.`);
  });

  const couvertes = new Set(entree.zones.flatMap((z) => zonesCouvertes(z.zone)));
  const autres = zonesElementaires(entree.piece).filter((z) => !couvertes.has(z) && entree.analyse?.zones_visibles?.[z]?.visible !== false).map((z) => `the ${ZONES_SIMULATEUR[z].nomCourt}`);
  const objets = entree.analyse?.objets?.filter(Boolean) ?? [];
  const identique = [
    "the framing: same camera position, angle, perspective and borders; no crop, no zoom, no straightening",
    `${autres.length ? `${autres.join(", ")}, ` : ""}the walls, floor, ceiling and windows: same material and colour`,
    "handles, hinges, appliances, sink and taps, sockets and lights: same model, same place",
    `every object${objets.length ? ` (${objets.join(", ")})` : ""}: same place, same size, same colour, in front of the film`,
    "the light, shadows, reflections and white balance of the photo",
    "the number of doors, drawers and panels, and every gap between them",
  ];

  const consignes = [...new Set(ctx.films.map((f) => teinteEnMots(f.reference)?.consigneFin ?? "compare with the sample before you output; if different, match the sample"))];
  const fin =
    consignes.length === 1
      ? `${consignes[0][0].toUpperCase()}${consignes[0].slice(1)}.`
      : // Le film de la première zone (les façades du banc) parle en dernier : la consigne de sa famille finit le prompt.
        [...ctx.films]
          .reverse()
          .map((f) => `${nomEchantillonFilm(ctx, f)} (${f.reference.ref}): ${teinteEnMots(f.reference)?.consigneFin ?? "compare with the sample before you output; if different, match the sample"}.`)
          .join("\n");

  return [
    tete,
    `SURFACES TO CHANGE, ONE BY ONE\n${surfaces.join("\n")}`,
    `COLOUR, IN WORDS AS WELL AS IN THE SAMPLE\n${ctx.films.map((f) => `- ${ligneCouleur(ctx, f)}`).join("\n")}`,
    `STAYS IDENTICAL\n${identique.map((l) => `- ${l}`).join("\n")}`,
    `OUTPUT\nOne image, same format as Image 1 (${TAILLES[entree.format]}).${entree.mode === "chatgpt" ? " Generate it directly, without asking any question." : " Generate it directly."}`,
    fin,
  ].join("\n\n");
}
