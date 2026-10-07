import { ZONES_SIMULATEUR, piece as lirePiece, zonesCouvertes, zonesElementaires, type IdPiece, type IdZoneElementaire } from "../zones";
import { REGLES_REALISME, decrireFilm, poseDeZone } from "./materiaux";
import { TAILLES, type AnalysePhoto, type EntreeMoteur, type ZoneMoteur } from "./types";

/**
 * Les 12 blocs du prompt « studio » (mission 15, partie 2), dans l'ordre
 * imposé, chacun une fonction pure qui rend son texte anglais. L'assembleur
 * (`index.ts`) les enchaîne. Aucun emoji nulle part.
 */

/** Un film distinct : une même référence sur deux zones n'est décrite qu'une fois (et jointe une fois en mode échantillons bruts). */
export type FilmDistinct = { reference: ZoneMoteur["reference"]; zones: ZoneMoteur[]; etiquettes: string[]; /** Rang de l'image jointe en mode `api-swatches` (2, 3…). */ image: number };

/** Ce que chaque bloc reçoit : l'entrée, plus les films distincts. */
export type ContexteBlocs = { entree: EntreeMoteur; films: FilmDistinct[] };

const TITRES = {
  ROLE: "ROLE",
  IMAGES: "IMAGES",
  ART_DIRECTION: "ART DIRECTION",
  METHODE: "HOW THE JOB IS DONE IN REAL LIFE",
  AFFECTATION: "MATERIAL ASSIGNMENT",
  REALISME: "MATERIAL REALISM",
  QUALITE_PHOTO: "PHOTOGRAPHIC QUALITY",
  LOCKED: "LOCKED",
  AVOID: "AVOID",
  FINAL_CHECK: "FINAL CHECK",
  OUTPUT: "OUTPUT",
} as const;

const titre = (nom: string, corps: string) => `${nom}\n${corps}`;
const puces = (lignes: string[]) => lignes.map((l) => `- ${l}`).join("\n");

const filmDe = (ctx: ContexteBlocs, zone: ZoneMoteur) => ctx.films.find((f) => f.reference.ref === zone.reference.ref)!;

/** L'échantillon d'une zone dans le prompt : « Sample B » (planche : une tuile par zone) ou « Image 3 » (échantillons bruts : un par film). */
export function nomEchantillonZone(ctx: ContexteBlocs, zone: ZoneMoteur): string {
  return ctx.entree.mode === "api-swatches" ? `Image ${filmDe(ctx, zone).image}` : `Sample ${zone.etiquette}`;
}

/** Un film dans le prompt : « Sample A », « Samples A and B » (même film sur deux zones) ou « Image 3 ». */
export function nomEchantillonFilm(ctx: ContexteBlocs, film: FilmDistinct): string {
  if (ctx.entree.mode === "api-swatches") return `Image ${film.image}`;
  return film.etiquettes.length > 1 ? `Samples ${film.etiquettes.slice(0, -1).join(", ")} and ${film.etiquettes[film.etiquettes.length - 1]}` : `Sample ${film.etiquettes[0]}`;
}

/* 1 */
export function blocRole(ctx: ContexteBlocs): string {
  const p = lirePiece(ctx.entree.piece);
  return titre(
    TITRES.ROLE,
    `You are a senior architectural visualisation artist and interior photographer working for a surface covering company. The company wraps existing surfaces with Cover Styl' adhesive decor films; you produce the visual that shows the client ${p.nomEn} exactly as it will look once the job is done. The client must recognise the room instantly and see it as a finished job photographed by a professional.`
  );
}

/* 2 */
export function blocImages(ctx: ContexteBlocs): string {
  if (ctx.entree.mode === "api-swatches") {
    const n = ctx.films.length;
    const liste = n === 1 ? "Image 2 is a flat, front-lit sample" : `Images 2 to ${n + 1} are flat, front-lit samples`;
    return titre(TITRES.IMAGES, `Image 1 is the photograph of the room. ${liste} of Cover Styl' adhesive decor film, one per material: they show a material, not a scene — never copy their framing, borders or lighting into the result. If the images arrive in another order, recognise them by content: the room is Image 1, the flat samples are the others.`);
  }
  const tuiles = ctx.entree.zones.length;
  if (ctx.entree.variante === "planche-neutre") {
    // Mission 23 (L4a) : la planche neutre de la campagne de calibrage ; seule cette phrase change dans le prompt.
    return titre(
      TITRES.IMAGES,
      `Image 1 is the photograph of the room. Image 2 is the labelled sample board: a neutral mid-grey sheet with ${tuiles === 1 ? "one large square sample" : `${tuiles} large square samples`} of Cover Styl' adhesive decor film, each labelled with its letter and the zone it goes on, and a pure white reference square in its top right corner. Read each sample's true colour against that white square and the neutral grey. The board shows materials, not a scene — never copy its grey background, its white square, its labels or any text into the result. If the images arrive in another order, recognise them by content: the room is Image 1, the grey sheet of samples is Image 2.`
    );
  }
  return titre(
    TITRES.IMAGES,
    `Image 1 is the photograph of the room. Image 2 is the labelled sample board: a light grey sheet with ${tuiles === 1 ? "one square sample" : `${tuiles} square samples`} of Cover Styl' adhesive decor film, each labelled with its letter and the zone it goes on. The board shows materials, not a scene — never copy its grey background, its labels or any text into the result. If the images arrive in another order, recognise them by content: the room is Image 1, the grey sheet of samples is Image 2.`
  );
}

/* 3 */
export function blocArtDirection(_ctx: ContexteBlocs, direction: string): string {
  return titre(TITRES.ART_DIRECTION, direction);
}

/* 4 */
export function blocMethode(): string {
  return titre(
    TITRES.METHODE,
    "An installer wraps the existing surfaces with a 0.2 mm adhesive decor film. The film takes the exact shape it is laid on: it adds no thickness, moves nothing, removes nothing, repairs nothing and adds no light. It is cut and folded around every front, edge and return, and it wraps around every visible edge, so no old material remains visible on a covered surface. After the job the room is the same room, seen from the same spot: only the skin of the listed zones has changed."
  );
}

/* 5 */
export function blocPiece(ctx: ContexteBlocs): string {
  const p = lirePiece(ctx.entree.piece);
  const analyse = ctx.entree.analyse;
  const corps = analyse?.description?.trim() || p.phraseGenerique;
  const lumiere = analyse?.lumiere ? ` Light: ${[analyse.lumiere.source, analyse.lumiere.direction, analyse.lumiere.temperature, analyse.lumiere.dominante].filter(Boolean).join(", ")}.` : "";
  return titre(`THE ${p.titreEn} IN IMAGE 1`, `${corps}${lumiere}`);
}

/** Les zones élémentaires de la pièce visibles sur la photo et non choisies (« NOT COVERED »). */
function zonesVisiblesNonChoisies(piece: IdPiece, zones: ZoneMoteur[], analyse: AnalysePhoto | null | undefined): IdZoneElementaire[] {
  const couvertes = new Set(zones.flatMap((z) => zonesCouvertes(z.zone)));
  return zonesElementaires(piece).filter((z) => !couvertes.has(z) && (analyse ? analyse.zones_visibles[z]?.visible !== false : true));
}

/* 6 */
export function blocAffectation(ctx: ContexteBlocs): string {
  const { entree } = ctx;
  const lignes = entree.zones.map((z) => {
    const zone = ZONES_SIMULATEUR[z.zone];
    return `${nomEchantillonZone(ctx, z)} (${z.reference.ref} — ${z.reference.nom}) goes on the ${zone.nomCourt}. Covers: ${zone.cible} Stops: ${zone.limites} Laid: ${poseDeZone(z.zone)}. Untouched on or around it: ${zone.exclus}`;
  });
  const objets = entree.analyse?.objets?.filter(Boolean) ?? [];
  const nonChoisies = zonesVisiblesNonChoisies(entree.piece, entree.zones, entree.analyse).map((z) => `the ${ZONES_SIMULATEUR[z].nomCourt}`);
  const nonCouvert = [...objets, ...nonChoisies];
  const nonCouvertTexte = nonCouvert.length ? `${nonCouvert.join(", ")} — they keep their exact material, colour, place and shadow.` : "everything that is not a listed zone keeps its exact material, colour, place and shadow.";
  const affectees = new Set(entree.zones.map((z) => z.reference.ref));
  const nonUtilises = ctx.films.filter((f) => !affectees.has(f.reference.ref)).map((f) => `${nomEchantillonFilm(ctx, f)} (${f.reference.ref} — ${f.reference.nom})`);
  return titre(TITRES.AFFECTATION, `${puces(lignes)}\nNOT COVERED: ${nonCouvertTexte}\nNOT USED IN THIS IMAGE: ${nonUtilises.length ? `${nonUtilises.join(", ")} — ignore ${nonUtilises.length > 1 ? "them" : "it"} completely.` : "none — every sample is assigned above, and no other material is introduced."}`);
}

/* 7 */
export function blocRealisme(ctx: ContexteBlocs): string {
  const lignes = ctx.films.map((f) => `${nomEchantillonFilm(ctx, f)} — ${decrireFilm(f.reference, f.zones[0]?.zone ?? null)}`);
  return titre(TITRES.REALISME, puces([...lignes, ...REGLES_REALISME]));
}

/* 8 */
export function blocQualitePhoto(): string {
  return titre(
    TITRES.QUALITE_PHOTO,
    puces([
      "The result reads as the work of an interior photographer: neutral white balance, balanced exposure with detail kept in highlights and shadows, crisp micro-detail on the new materials, no noise, no haze.",
      "Natural rendering: no HDR look, no oversaturation, no bloom, nothing that looks like a 3D render.",
      "Only global photo adjustments are allowed (white balance, exposure, clarity); nothing outside the covered surfaces is retouched locally.",
    ])
  );
}

/* 9 */
export function blocLocked(ctx: ContexteBlocs): string {
  const objets = ctx.entree.analyse?.objets?.filter(Boolean) ?? [];
  const nonChoisies = zonesVisiblesNonChoisies(ctx.entree.piece, ctx.entree.zones, ctx.entree.analyse).map((z) => ZONES_SIMULATEUR[z].nomCourt);
  return titre(
    TITRES.LOCKED,
    puces([
      "Framing: same camera position, angle, focal length, perspective lines, horizon and lens distortion; same aspect ratio; no crop, no zoom, no straightening, no widening — the four borders show exactly the same content.",
      "Geometry: every piece of furniture keeps its position, size, proportions, number of doors, drawers and panels, the width of every gap, every edge profile and relief; layout unchanged.",
      "Hardware and equipment: handles, knobs, hinges, rails, taps, sinks, appliances, sockets, switches, lights, screens — same model, same finish, same place.",
      `Objects and living things: every object present in Image 1 stays at the same place, same size, same orientation, same colour, with its contact shadow${objets.length ? ` — including ${objets.join(", ")}` : ", including clutter, cables, stains, dishes, plants, people and pets"}; an object in front of a covered zone stays in front of it, complete; the film passes behind it.`,
      `Surfaces not listed: ${nonChoisies.length ? `the ${nonChoisies.join(", the ")}, and ` : ""}walls, floor, ceiling, windows, curtains and every surface that is not a listed zone keep their exact material and colour — never harmonised with the new films.`,
      "Reflections: mirrors, glass, screens, glossy floors and chrome keep their reflections; a covered zone seen in a reflection changes there too, and nothing else in the reflection changes.",
    ])
  );
}

/* 10 */
export function blocAvoid(): string {
  return titre(
    TITRES.AVOID,
    puces([
      "A CGI or 3D-render look, a staged showroom, invented studio lighting.",
      "Shiny vinyl or plastic sheen on a matt film; a flat, texture-less fill where the sample shows a decor.",
      "Blurred or mushy grain; a visibly repeated pattern, a mirrored or tiled sample.",
      "Curved or bent lines where the surface is straight; a decor that follows the wrong perspective.",
      "Doors, drawers or panels that change count, size, shape or position; handles that move or change.",
      "Objects melted into a surface, duplicated, moved, tidied, removed or added.",
      "Any text, logo, label, watermark, border or sample sheet inside the image.",
      "An orange or warm colour cast over the whole image; a change of white balance that tints the walls, the floor or the new films.",
    ])
  );
}

/* 11 */
export function blocFinalCheck(ctx: ContexteBlocs): string {
  const controles = ctx.entree.zones.map((z) => `${ZONES_SIMULATEUR[z.zone].nomCourt}: ${ZONES_SIMULATEUR[z.zone].controle}`);
  const precedents = (ctx.entree.defautsPrecedents ?? []).filter(Boolean).map((d) => `In the previous attempt, ${d.replace(/\.$/, "")}: do not repeat it — keep everything else exactly as in Image 1.`);
  const points = [
    "Overlay: outside the covered zones, the result and Image 1 superimpose exactly — same edges, same objects, same borders of the frame.",
    "Counts: same number of doors, drawers, handles, sockets, appliances and objects as in Image 1.",
    "Coverage: every instance of each listed zone is fully covered up to its limits, edges and returns included; no patch of the old material is left; nothing beyond the limits has been covered.",
    "Material: next to its sample, each film shows the same colour, the same decor, a true-to-life scale and direction.",
    "Each zone wears ITS OWN film exactly as assigned; no zone takes the film of another.",
    "Light: shadows, gradients and highlights on the covered zones are where they were in Image 1; the new finish only changes how the surface answers them.",
    "Nothing added, removed, tidied, embellished or invented.",
    "The image looks like a real, professionally photographed room, never like a render or a collage.",
    ...controles,
    ...precedents,
  ];
  return titre(TITRES.FINAL_CHECK, `Before you output, compare your result with Image 1 point by point and correct every difference:\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}`);
}

/* 12 */
export function blocOutput(ctx: ContexteBlocs): string {
  const taille = TAILLES[ctx.entree.format];
  const question = ctx.entree.mode === "chatgpt" ? " Generate it directly, without asking any question." : " Generate it directly.";
  return titre(TITRES.OUTPUT, `One image, same format as Image 1 (${taille}): Image 1 itself, with only the listed zones wearing their new film.${question}`);
}
