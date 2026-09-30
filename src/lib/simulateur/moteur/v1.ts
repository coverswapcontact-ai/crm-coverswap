import { ZONES_SIMULATEUR, type IdPiece, type IdZone, type SensPose } from "../zones";
import { profilDe, type Profil } from "./materiaux";
import type { ReferenceMoteur } from "./types";

/**
 * Le prompt V1 (mission 15, partie 2) — le « V1 revu » : la structure et les
 * textes du prompt que le site construit encore (`coverswap/src/lib/simulation-prompt.ts`
 * + `surfaces.ts` + `projets.ts`), gardés ici pour que le CRM n'en dépende
 * plus — mêmes trois étages (surface, revêtement, scène), les emojis en moins,
 * « an interior room » corrigé. Ce n'est PAS une copie octet pour octet : les
 * textes des zones viennent de la source unique `zones.ts` (revus pour le V2,
 * partagés avec lui), remis au vocabulaire du V1 (« IMAGE 1 », « target »).
 * Écarts assumés avec le prompt en production sur le site : « WALL UNITS » sans
 * « ONLY », la pose du plan / du plateau / du plan vasque (« and the returns,
 * matched at the fold »), les murs et le plafond (« seams invisible »), le
 * meuble vasque (« the decor restarts on every door and drawer »), le tablier
 * (« laid in one length »). Sert au paramètre `SIMULATEUR_MOTEUR = V1`
 * (espace, CRM, banc) ; le site, lui, envoie encore son prompt signé jusqu'à
 * la partie 4.
 */

export type ZoneV1 = { zone: IdZone; reference: ReferenceMoteur };

/** Un texte de zone (source unique, vocabulaire V2) dans le vocabulaire du V1 : « IMAGE 1 », « another target ». */
export const texteV1 = (texte: string): string => texte.replace(/\bImage 1\b/g, "IMAGE 1").replace(/\banother zone\b/g, "another target");

const SENS: Record<SensPose, string> = {
  vertical: "vertically (bottom to top) on this surface",
  horizontal: "horizontally (left to right) on this surface",
  longueur: "along the longest dimension of this surface",
};

/** Description du film à poser : matière, échelle du décor, sens, comportement à la lumière (texte V1 du site). */
export function decrireRevetementV1(el: ReferenceMoteur, sens: SensPose, image: number): string[] {
  const direction = SENS[sens];
  const profil: Profil = profilDe(el);
  switch (profil) {
    case "uni-mat":
      return [
        `Solid colour, matt to soft-satin film. It has NO pattern: no grain, no veining, no speckle, no brush marks, no gradient of its own.`,
        `Colour: take it from the centre of IMAGE ${image} and keep that exact hue, saturation and lightness as the base colour of the whole surface. The name "${el.nom}" must read true to a human eye. Do not drift toward the room's white balance: warm bulbs must not turn a white film cream, daylight must not turn it bluish; do not mute, pastel, darken or "harmonise" the colour with the room.`,
        `Light: a matt film diffuses light — broad, soft luminance gradients only, no mirror-like reflection, no hotspot. All shading on the surface comes from the light already in IMAGE 1 (same shadows, same gradients), multiplied over the flat base colour.`,
      ];
    case "uni-brillant":
      return [
        `Solid colour, high-gloss lacquer-look film. It has NO pattern of its own: a perfectly uniform colour under a glossy clear surface.`,
        `Colour: exact hue, saturation and lightness of the centre of IMAGE ${image}; the name "${el.nom}" must read true. No drift toward the room's white balance, no muting.`,
        `Light: gloss means soft mirror-like reflections — but ONLY of what already exists in IMAGE 1 (windows, lamps, the opposite worktop or floor), placed where the geometry puts them, slightly blurred. Do not invent a window, a lamp or a studio highlight. Deep colours stay deep: reflections sit on top, the base colour does not turn grey.`,
      ];
    case "uni-raye":
      return [
        `Solid colour film with fine, regular, embossed parallel stripes (tone on tone), as in IMAGE ${image}.`,
        `Colour: exact base colour of IMAGE ${image}, no drift toward the room's white balance. Stripes: thin, evenly spaced, perfectly parallel, running ${direction}; keep the real scale of the sample (a stripe every few millimetres — from a distance they read as a fine texture, not as bold bands).`,
        `Light: matt; the stripes only catch a faint directional sheen.`,
      ];
    case "bois":
      return [
        `Wood-grain decor film "${el.nom}": reproduce the species look of IMAGE ${image} — its base tone, the contrast of its grain lines, its knots or absence of knots, its cathedral or straight-grain figure.`,
        `Grain runs ${direction}, continuous over the full length of each panel. Scale: true to life — the sample is a close-up of the film; at room distance grain lines are a few millimetres to a few centimetres apart, never enlarged into giant stripes nor shrunk into noise. Do not mirror or tile the sample visibly: no repeated knot at regular intervals. Each door or panel is cut from a different part of the roll, so neighbouring panels look alike but not identical.`,
        `Colour: keep the exact wood tone of the sample (do not redden, yellow, grey or darken it to suit the room). Light: satin-matt film with a fine wood-pore emboss — soft broad highlights, no varnish glare, no plastic shine.`,
      ];
    case "bois-peint":
      return [
        `Painted-wood decor film "${el.nom}": an opaque colour through which a fine wood grain remains visible as subtle tone-on-tone lines, as in IMAGE ${image}.`,
        `Grain lines run ${direction}, fine and low-contrast, true to life in scale (the sample is a close-up of the film). The colour is the exact colour of IMAGE ${image}: no drift toward the room's white balance, no muting.`,
        `Light: matt; the grain only shows as a faint texture in grazing light.`,
      ];
    case "marbre":
      return [
        `Marble decor film "${el.nom}": reproduce the stone of IMAGE ${image} — its ground colour, the colour, thickness and softness of its veins, the density of veining (sparse or busy) exactly as the sample shows.`,
        `Veins: irregular, organic, branching, never parallel stripes, never a regular lattice; they flow diagonally or ${direction} and continue without a break across the whole panel, then restart on the next separate panel. Scale: large and true to life — the sample is a close-up; a main vein may cross a whole door or a metre of worktop. No visible repetition of the same vein motif, no mirrored "butterfly" pattern.`,
        `Colour: keep the ground colour exact (a white marble stays neutral white, not cream; a Nero stays deep black with crisp veins). Light: honed-satin stone look — smooth, soft broad reflections of the light sources already present in IMAGE 1, no invented glare, no wet look.`,
      ];
    case "pierre":
      return [
        `Natural-stone decor film "${el.nom}" (travertine, slate, basalt, granite type): reproduce the mineral structure of IMAGE ${image} — its ground colour, its fine grain, pits, clouds or soft layered bands.`,
        `Structure: fine and irregular, spread evenly, with any layering running ${direction}; true to life in scale (the sample is a close-up of the film). No marble-like veins unless the sample shows them, no tile joints, no repetition.`,
        `Colour: exact tone of the sample, no drift toward the room's white balance. Light: matt mineral surface, soft diffuse shading, no gloss.`,
      ];
    case "terrazzo":
      return [
        `Terrazzo / speckled-stone decor film "${el.nom}": a ground colour scattered with stone chips, as in IMAGE ${image}.`,
        `Chips: irregular in shape and size, randomly scattered with no alignment and no repetition, in the colours and density of the sample; true scale (the sample is a close-up: chips measure millimetres to a few centimetres, not more).`,
        `Colour: exact ground and chip colours. Light: smooth satin-matt surface, soft reflections only of what exists in IMAGE 1.`,
      ];
    case "beton":
      return [
        `Concrete / cement / stucco decor film "${el.nom}": reproduce the mineral, cloudy surface of IMAGE ${image} — soft tonal clouds, trowel movements, fine pores.`,
        `Structure: large, soft, irregular mottling with no direction and no repetition; no formwork joints, no cracks, no stains and no tile grid unless the sample shows them. True to life in scale: the sample is a close-up of the film.`,
        `Colour: exact grey/taupe/earth tone of the sample, no drift. Light: dead-matt, fully diffuse — no reflection at all, only the shading already present in IMAGE 1.`,
      ];
    case "brique":
      return [
        `Brick decor film "${el.nom}": courses of bricks with mortar joints as in IMAGE ${image}, printed on a flat film.`,
        `Courses are perfectly horizontal, in running bond, at true scale (a brick is about 22 cm long and 6 cm high); they follow the perspective of the surface. The surface stays FLAT: the relief is printed, the outline of the surface does not become jagged.`,
        `Colour: exact brick and mortar tones of the sample. Light: matt.`,
      ];
    case "metal-brosse":
      return [
        `Brushed-metal decor film "${el.nom}": reproduce the metal tone of IMAGE ${image} with its fine, straight brushing lines (or its embossed stripe or dot pattern if the sample shows one, at true scale).`,
        `Brushing runs ${direction}, perfectly straight and parallel, hair-fine. Colour: exact metal tone of the sample (silver stays neutral, gold stays the sample's gold, graphite stays dark).`,
        `Light: anisotropic metallic sheen — highlights stretch perpendicular to the brushing as soft bands; they come only from light sources already present in IMAGE 1. No mirror reflection, no chrome effect, no invented studio light.`,
      ];
    case "metal-poli":
      return [
        `Polished / iridescent metallic film "${el.nom}" as shown in IMAGE ${image}.`,
        `Colour and effect: exact tone and shimmer of the sample. Any stripe pattern runs ${direction} at true scale.`,
        `Light: strongly reflective, but it reflects ONLY the existing scene of IMAGE 1, blurred and plausible for the geometry. Do not invent objects, windows or lamps in the reflection.`,
      ];
    case "metal-patine":
      return [
        `Patinated / oxidised metal decor film "${el.nom}" (copper, bronze, corten, blackened iron type): reproduce the clouded, uneven patina of IMAGE ${image}.`,
        `Structure: irregular clouds and stains of oxidation, no direction, no repetition, true to life in scale (the sample is a close-up). Colour: exact tones of the sample.`,
        `Light: low satin metallic sheen, soft and uneven, only from the light already in IMAGE 1. No mirror reflection.`,
      ];
    case "cuir":
      return [
        `Leather-look decor film "${el.nom}": reproduce the fine leather grain of IMAGE ${image} and its exact colour.`,
        `Grain: tiny, irregular, uniform over the surface — at room distance it reads as an almost plain, slightly soft surface. No seams, no stitching, no quilting, no upholstery buttons: it is a flat film, not padded leather.`,
        `Colour: exact colour of the sample, no drift. Light: soft satin sheen with gentle, broad highlights.`,
      ];
    case "tissu":
      return [
        `Textile-look decor film "${el.nom}" (linen, weave, mesh, chevron type): reproduce the woven structure and colour of IMAGE ${image}.`,
        `Weave: fine and regular, threads running ${direction} and across; true scale (threads are about a millimetre — at room distance the surface reads as a soft, slightly heathered plain, with the weave visible only up close). Metallic threads, if the sample has them, glint faintly. No folds, no drape, no seams: a flat film.`,
        `Colour: exact tones of the sample. Light: matt, fully diffuse.`,
      ];
    case "paillettes":
      return [
        `Glitter decor film "${el.nom}": a coloured ground densely covered with tiny reflective flakes, as in IMAGE ${image}.`,
        `Flakes: minute (about a millimetre), random, evenly dense; they sparkle as tiny points of light, more where the existing light of IMAGE 1 hits the surface. No large sequins, no stars, no pattern.`,
        `Colour: exact ground colour of the sample. Light: glossy ground with point sparkles; no invented spotlight.`,
      ];
  }
}

/* ── La scène, par pièce (projets.ts du site, sans emoji) ─────────── */

const SCENES: Record<IdPiece, { roomType: string; keepUntouched: string[]; specificRules: string }> = {
  cuisine: {
    roomType: "kitchen",
    keepUntouched: [
      "Appliances: oven, hood/range hood, refrigerator, microwave, dishwasher, coffee machine — completely untouched",
      "Sink, faucet/tap, soap dispenser — completely untouched (the sink bowl itself never changes color)",
      "Cabinet structure: same exact number of doors/drawers, same sizes, same positions, same gaps between them",
      "Handles, knobs, hinges: same style, same metal finish, same exact placement — never replaced or moved",
      "Electrical outlets, switches, light fixtures, under-cabinet LEDs — completely untouched",
      "Objects on countertops: bottles, jars, utensils, plants, cutting boards, dishes, kettle, toaster — all stay exactly as photographed",
      "Floor, ceiling, walls outside the backsplash zone — completely untouched",
      "Windows, curtains, blinds, window frames — completely untouched",
      "Furniture and decorative items in the background — completely untouched",
    ],
    specificRules:
      "Treat this as a 'find and replace' on the targeted kitchen surfaces only. Cabinet panels keep their exact original layout. Countertop edge profile (rounded vs. squared) stays the same. The backsplash extends ONLY between countertop and wall cabinets — never onto adjacent walls. If only the backsplash is selected, the cabinets and worktop must remain pixel-identical.",
  },
  "salle-de-bain": {
    roomType: "bathroom",
    keepUntouched: [
      "Mirrors AND their reflections — the mirror MUST reflect the original (pre-modification) room, never the new textures",
      "Glass shower doors, screens, and panels — stay perfectly transparent, never opaque or textured",
      "Faucets, taps, mixer valves, shower head, hand shower, towel rails, robe hooks — completely untouched",
      "Toilet, toilet seat, toilet flush button, bidet — completely untouched",
      "Sink/wash basin BOWL itself (porcelain part) — never changes color, only the cabinet beneath/around it changes",
      "Bathtub interior (the porcelain/acrylic bathing area) — only the side panel changes, the inside stays pure white/original",
      "Soap dispensers, toothbrush holders, towel bars, decorative items, plants — completely untouched",
      "Light fixtures, electrical outlets, switches, towel warmers/heated rails, ventilation grilles — completely untouched",
      "Floor, ceiling, windows, window frames — completely untouched",
    ],
    specificRules:
      "CRITICAL FOR MIRRORS: any mirror visible in the photo must show its ORIGINAL reflection — do NOT apply the new tile/cabinet textures inside mirror reflections. GLASS SHOWER: keep transparent, do not opaque it. The wash basin bowl is NOT part of the vanity cabinet — only the wood/laminate cabinet beneath/around the sink gets the new texture. Bathtub: only the side/skirt panel changes, the bathing surface remains untouched. Wall tiles: replace tile pattern only on existing tiled walls — do not extend onto painted walls.",
  },
  meubles: {
    roomType: "furniture/wardrobe/closet",
    keepUntouched: [
      "Handles, knobs, drawer pulls, hinges — same exact style, finish, and placement (never replaced or moved)",
      "Visible interior contents: clothes, hangers, shelves contents, books, items, drawers — 100% pixel-identical, exact same arrangement",
      "Mirrors on the furniture (e.g., wardrobe mirrors) — keep their reflection identical to the original",
      "Glass panels or transparent inserts — stay transparent, never opaque",
      "Floor and walls visible behind/around the furniture — completely untouched",
      "Other furniture or items in the room (chairs, beds, lamps) — completely untouched",
      "Light fixtures, lamps, electrical outlets, light switches — completely untouched",
      "Decorative items on top of the furniture (vases, frames, books) — stay exactly as photographed",
    ],
    specificRules:
      "This is a piece of furniture — only its visible covering panels change. Door panels keep the exact same number, alignment, hinge positions, and gaps. Drawer fronts keep the exact same number, sizes, and proportions. If doors are open and the interior is visible, the interior contents (clothes, shelves, hangers) stay PIXEL-identical in the same position. The 'top surface' is the horizontal top of the furniture, the 'sides' are the visible side/lateral panels — distinguish them carefully.",
  },
  "mur-plafond": {
    roomType: "interior room (walls and ceiling)",
    keepUntouched: [
      "Artwork, paintings, photos, posters, frames, decorative wall objects — completely untouched",
      "Light fixtures, ceiling fans, pendant lights, sconces, lamps — completely untouched and at the same position",
      "Light switches, electrical outlets, thermostats, alarms, smoke detectors — completely untouched",
      "Wall trim, baseboards, crown molding, chair rails, picture rails — same exact profile, color (typically white), and position",
      "Doors, door frames, doorknobs, hinges — completely untouched",
      "Windows, window frames, sills, blinds, curtains, drapes — completely untouched",
      "All furniture and items in the room (sofas, tables, beds, chairs) — completely untouched",
      "Floor, rugs, carpets — completely untouched",
      "Other walls not selected — keep their original color/material exactly",
    ],
    specificRules:
      "Only the wall/ceiling SURFACE changes — not the architectural elements on it. Trim, baseboards, crown molding must remain in place with their original color (typically white). The new wall texture extends only to where trim begins. For ceilings: preserve all fixtures, fans, and pendants; the new texture fills only the visible flat ceiling surface around them. If only one wall is selected, the OTHER walls must keep their EXACT original color — do not 'harmonize' them.",
  },
  professionnel: {
    roomType: "professional workspace / reception desk / office",
    keepUntouched: [
      "Computer screens, monitors, laptops, keyboards, mice, phones, headsets — completely untouched",
      "Papers, files, folders, notebooks, books, office supplies on the desk — completely untouched, exact same position",
      "Office chairs, seats, sofas — completely untouched",
      "Plants, decorative items, picture frames, plaques — completely untouched",
      "Brand signage, logos, company branding on walls or counter — completely untouched (preserve them in their exact original form)",
      "Light fixtures, lamps, electrical outlets, switches, network ports, USB ports — completely untouched",
      "Floor, ceiling, windows, window frames — completely untouched",
      "Doors, door frames — completely untouched",
      "Cash registers, POS terminals, card readers, scanners — completely untouched",
    ],
    specificRules:
      "This is a professional workspace. Office equipment (screens, computers, papers, files, phones) is NOT a surface to cover — these items sit on the desk and stay 100% pixel-identical. The desk/counter surface gets the new texture but everything ON the desk stays as photographed. Brand signage and logos on walls or counter front: NEVER replaced, hidden, or modified — they remain in their exact original form (this is critical for B2B clients). Only the bare physical surfaces get covered.",
  },
};

const article = (roomType: string) => (/^[aeiou]/i.test(roomType) ? "an" : "a");

function blocSurface(choix: ZoneV1, rang: number, image: number): string {
  const p = ZONES_SIMULATEUR[choix.zone];
  const r = choix.reference;
  return [
    `TARGET ${rang} — ${p.nom}`,
    `Film: Cover Styl' ref. ${r.ref} "${r.nom}" — flat sample in IMAGE ${image}.`,
    `Receives the film: ${texteV1(p.cible)}`,
    `Where the film stops: ${majuscule(texteV1(p.limites))}`,
    `Touching or standing on this surface, NEVER changed: ${texteV1(p.exclus)}`,
    `How the film is laid: ${majuscule(texteV1(p.pose))}`,
    `The film itself:`,
    ...decrireRevetementV1(r, p.sens, image).map((l) => `  - ${l}`),
    `Coverage: every instance of this surface visible in IMAGE 1 receives the film, entirely, up to its limits — including instances partly hidden or cut by the frame. If IMAGE 1 shows no such surface, change nothing for this target: never build one.`,
  ].join("\n");
}

const majuscule = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/** Le rang d'image (2, 3…) de chaque zone : une même référence sur deux zones n'est jointe qu'une fois. */
export function imagesV1(zones: ZoneV1[]): { images: number[]; refsDistinctes: string[] } {
  const refs: string[] = [];
  const images = zones.map((z) => {
    let i = refs.indexOf(z.reference.ref);
    if (i < 0) {
      i = refs.length;
      refs.push(z.reference.ref);
    }
    return i + 2;
  });
  return { images, refsDistinctes: refs };
}

export function construirePromptV1(pieceId: IdPiece, zones: ZoneV1[]): string {
  const scene = SCENES[pieceId];
  const { images, refsDistinctes } = imagesV1(zones);
  const nbImages = refsDistinctes.length + 1;
  const echantillons = nbImages > 2 ? `IMAGES 2 to ${nbImages} are` : "IMAGE 2 is";
  const cibles = zones.map((c, i) => blocSurface(c, i + 1, images[i])).join("\n\n");
  const verrous = scene.keepUntouched.map((l) => `- ${l}`).join("\n");
  const controles = zones.map((c, i) => `- Target ${i + 1}: ${majuscule(texteV1(ZONES_SIMULATEUR[c.zone].controle))}`).join("\n");

  return `TASK: TEXTURE REPLACEMENT ON A REAL PHOTOGRAPH. This is an edit of IMAGE 1, not a new image, not a redesign, not a 3D render.

IMAGE 1 is a real photograph of ${article(scene.roomType)} ${scene.roomType}, taken by a client with a phone. ${echantillons} flat, front-lit sample(s) of Cover Styl' adhesive decor film: they show a material, not a scene — never copy their framing, borders, labels or lighting into the result.

THE REAL-WORLD OPERATION YOU ARE SIMULATING
An installer lays a 0.2 mm adhesive film onto existing surfaces. The film takes the shape it is laid on. It adds no thickness, moves nothing, removes nothing, repairs nothing and lights nothing. After the job, the room is the same room, photographed from the same spot at the same second: only the skin of the target surfaces is different. Produce exactly that photograph.

═══ TARGET SURFACES (the ONLY things that change) ═══

${cibles}

═══ LOCKED — everything that is not a target surface ═══
Treat the target surfaces as a mask. Outside that mask, the result must be superimposable on IMAGE 1: if both images were stacked and flipped back and forth, nothing outside the target surfaces would move, appear, disappear or change colour.
- Framing: same camera position, angle, focal length, perspective lines, horizon tilt and lens distortion. Same aspect ratio. No crop, no zoom, no straightening, no widening. The four borders of the frame show exactly the same content.
- Geometry: every piece of furniture keeps its position, size, proportions, number of doors, drawers and panels, the width of every gap, every edge profile, every relief. Layout unchanged.
- Hardware and equipment: handles, knobs, hinges, rails, taps, sinks, appliances, sockets, switches, lights — same model, same finish, same place.
- Objects and living things: every object present in IMAGE 1 stays, at the same place, same size, same orientation, same colour, including clutter, cables, stains, dishes, laundry, reflections of objects, people, pets and plants. An object in front of a target surface stays in front of it, complete, with its contact shadow; the film passes behind it.
- Light: same light sources, same direction, same colour temperature, same exposure, same white balance. Every cast shadow, contact shadow, ambient-occlusion line, light pool and gradient stays at the same place with the same softness. On a target surface, the ORIGINAL pattern of light and shadow is kept and simply falls on the new material; only the way the material answers light (matt, satin, gloss, metallic) adapts, as described per film.
- Reflections: mirrors, glass, screens, glossy floors and chrome keep their reflections; a target surface seen in a reflection changes there too, and nothing else in the reflection changes.
- Photographic character: same sharpness, same depth of field, same blur where IMAGE 1 is blurred, same noise/grain, same compression softness, same vignetting. It must look like the same phone took it. No HDR look, no added sharpening, no extra saturation or contrast.
Specific to this ${scene.roomType}:
${verrous}
${scene.specificRules}

═══ FORBIDDEN ═══
- Do NOT add anything: no object, plant, decoration, appliance, handle, light, window, shelf, tile, plinth or person that is not in IMAGE 1.
- The objects and fittings named in this brief are examples of what MAY be present; they do not describe IMAGE 1. Never draw an item because it is named here: only what IMAGE 1 actually shows exists.
- Do NOT remove anything: no object, cable, stain, magnet, sticker or mark disappears.
- Do NOT tidy, clean, declutter, straighten, align, centre or re-arrange anything.
- Do NOT embellish: no staging, no upgrade of appliances or taps, no nicer floor or wall, no better light, no renovation of anything that is not a target surface.
- Do NOT complete or reinterpret unclear areas: where IMAGE 1 is blurry, dark, overexposed, cropped or hidden, reproduce that area exactly as unclear as it is. Never guess what is behind an object or beyond the frame, never sharpen a blurred zone into invented detail.
- Do NOT change the shape of a target surface to suit the material: no new edge profile, no added thickness, no new joints, no removed grooves, no extra panels.
- Do NOT spread the film beyond the listed limits, and do NOT let its colour bleed or tint neighbouring surfaces.
- Do NOT put text, logos, watermarks, borders or sample labels in the image.

═══ FINAL CHECK — do this before you output ═══
Compare your result with IMAGE 1, point by point, and correct any difference before producing the image:
1. Overlay: outside the target surfaces, would the two images superimpose exactly — same edges, same objects, same borders of the frame?
2. Counts: same number of doors, drawers, handles, sockets, appliances and objects as in IMAGE 1.
3. Coverage: every instance of each target surface is fully covered up to its limits; no patch of the old material is left; nothing beyond the limits has been covered.
4. Material: placed next to its sample, each film shows the same colour (hue, saturation, lightness), the same decor and a true-to-life scale and direction.
5. Light: shadows, gradients and highlights on the target surfaces are where they were in IMAGE 1.
6. Nothing added, removed, tidied, embellished or invented.
${controles}

OUTPUT: one photorealistic image — IMAGE 1 itself, with only the target surfaces wearing their new film.`;
}
