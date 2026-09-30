import { ZONES_SIMULATEUR, piece as lirePiece } from "../zones";
import type { TypeSurface } from "../types-surface";
import { REGLES_REALISME, poseDeZone } from "./materiaux";
import { blocAvoid, blocMethode, blocQualitePhoto } from "./blocs";

/**
 * Le modèle ChatGPT d'un type de surface (mission 15, partie 2) : le prompt du
 * moteur, mode `chatgpt`, écrit avec les marqueurs de la bibliothèque
 * (`[zone:…]…[/zone]`, `{{teinte}}`, `{{etiquette}}`, `{{nombre_echantillons}}`,
 * `{{format}}`, `{{zones_inchangees}}`, `{{direction_artistique}}`) pour que
 * `rendu.ts` continue de le remplir. `prompts-defaut.ts` est GÉNÉRÉ d'ici
 * (`npm run simulateur:prompts`) ; les versions de Lucas en base restent.
 */

const puces = (lignes: string[]) => lignes.map((l) => `- ${l}`).join("\n");

export function construireModeleChatGPT(type: TypeSurface): string {
  const p = lirePiece(type.projet);
  const sections = type.zones.map((id) => {
    const z = ZONES_SIMULATEUR[id];
    return `[zone:${id}]\n- Sample "{{etiquette}}" (its label on Image 2) goes on the ${z.nomCourt}. Film: {{teinte}} Covers: ${z.cible} Stops: ${z.limites} Laid: ${poseDeZone(id)}. Untouched on or around it: ${z.exclus}\n[/zone]`;
  });
  const controles = type.zones.map((id) => `[zone:${id}]\n- ${ZONES_SIMULATEUR[id].nomCourt}: ${ZONES_SIMULATEUR[id].controle}\n[/zone]`);
  return [
    `ROLE\nYou are a senior architectural visualisation artist and interior photographer working for a surface covering company. The company wraps existing surfaces with Cover Styl' adhesive decor films; you produce the visual that shows my client ${p.nomEn} exactly as it will look once the job is done. The client must recognise the room instantly and see it as a finished job photographed by a professional.`,
    `IMAGES\nImage 1 is the photograph of my client's ${p.titreEn.toLowerCase()}, taken with a phone. Image 2 is the labelled sample board: a light grey sheet of square samples of Cover Styl' adhesive decor film — {{nombre_echantillons}} in all, one per zone, each labelled with its letter and the zone it goes on. The board shows materials, not a scene — never copy its grey background, its labels or any text into the result. If the images arrive in another order, recognise them by content: the room is Image 1, the grey sheet of samples is Image 2.`,
    `ART DIRECTION\n{{direction_artistique}}`,
    blocMethode(),
    `THE ${p.titreEn} IN IMAGE 1\n${p.phraseGenerique}`,
    `MATERIAL ASSIGNMENT\n${sections.join("\n")}\n{{zones_inchangees}}\nNOT COVERED as well: every object, appliance, fitting and surface that is not a listed zone keeps its exact material, colour, place and shadow.\nNOT USED IN THIS IMAGE: none — every sample on the board is assigned above, and no other material is introduced.`,
    `MATERIAL REALISM\n${puces([...REGLES_REALISME, "Each film is described next to its sample above (material, pattern and scale, finish, measured colour): reproduce exactly that, not a generic version of it."])}`,
    blocQualitePhoto(),
    `LOCKED\n${puces([
      "Framing: same camera position, angle, focal length, perspective lines, horizon and lens distortion; same aspect ratio ({{format}}); no crop, no zoom, no straightening, no widening — the four borders show exactly the same content.",
      "Geometry: every piece of furniture keeps its position, size, proportions, number of doors, drawers and panels, the width of every gap, every edge profile and relief; layout unchanged.",
      "Hardware and equipment: handles, knobs, hinges, rails, taps, sinks, appliances, sockets, switches, lights, screens — same model, same finish, same place.",
      "Objects and living things: every object present in Image 1 stays at the same place, same size, same orientation, same colour, with its contact shadow, including clutter, cables, stains, dishes, plants, people and pets; an object in front of a covered zone stays in front of it, complete; the film passes behind it.",
      "Surfaces not listed: walls, floor, ceiling, windows, curtains and every surface that is not a listed zone keep their exact material and colour — never harmonised with the new films.",
      "Reflections: mirrors, glass, screens, glossy floors and chrome keep their reflections; a covered zone seen in a reflection changes there too, and nothing else in the reflection changes.",
    ])}`,
    blocAvoid(),
    `FINAL CHECK\nBefore you output, compare your result with Image 1 point by point and correct every difference:\n${puces([
      "Overlay: outside the covered zones, the result and Image 1 superimpose exactly — same edges, same objects, same borders of the frame.",
      "Counts: same number of doors, drawers, handles, sockets, appliances and objects as in Image 1.",
      "Coverage: every instance of each listed zone is fully covered up to its limits, edges and returns included; no patch of the old material is left; nothing beyond the limits has been covered.",
      "Material: next to its sample, each film shows the same colour, the same decor, a true-to-life scale and direction.",
      "Each zone wears ITS OWN film exactly as assigned (the one whose label names it on Image 2); no zone takes the film of another.",
      "Light: shadows, gradients and highlights on the covered zones are where they were in Image 1; the new finish only changes how the surface answers them.",
      "Nothing added, removed, tidied, embellished or invented.",
      "The image looks like a real, professionally photographed room, never like a render or a collage.",
    ])}\n${controles.join("\n")}`,
    `OUTPUT\nOne image, same format as Image 1 ({{format}}): Image 1 itself, with only the listed zones wearing their new film. Generate it directly, without asking any question.`,
  ].join("\n\n");
}
