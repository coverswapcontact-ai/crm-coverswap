/**
 * Bibliothèque de prompts ChatGPT — première version de chaque prompt, écrite
 * à partir des consignes du simulateur du site (coverswap/src/lib/simulateur/
 * surfaces.ts et simulation-prompt.ts : cible, limites, exclusions, pose,
 * contrôle), resserrées pour ChatGPT :
 *  - les deux images sont désignées par leur contenu autant que par leur rang
 *    (on les joint depuis la pellicule, l'ordre n'est pas garanti) ;
 *  - chaque teinte est aussi décrite en toutes lettres ({{teinte}}) ;
 *  - la méthode du film adhésif, la scène verrouillée, les interdits, puis un
 *    contrôle final ;
 *  - la dernière ligne évite que ChatGPT pose une question au lieu de produire.
 *
 * En anglais : c'est la langue que le générateur d'images suit le plus
 * fidèlement (même choix que le site). Les étiquettes de la planche restent en
 * français et sont citées telles quelles.
 *
 * Syntaxe (voir rendu.ts) :
 *   [zone:<id>] … [/zone]   section gardée seulement si la zone reçoit une teinte
 *   {{teinte}}               dans une section : la teinte décrite en toutes lettres
 *   {{etiquette}}            dans une section : l'étiquette de l'échantillon (« A · Meubles hauts »)
 *   {{nombre_echantillons}}  nombre d'échantillons de la planche
 *   {{format}}               format de la photo (« landscape 3:2 »…)
 *   {{zones_inchangees}}     zones du type laissées telles quelles (vide sinon)
 *
 * Ces textes ne servent qu'à poser la version 1 en base : ensuite, Lucas les
 * modifie dans Simulateur → Prompts, chaque modification étant une nouvelle
 * version (on revient en arrière d'un clic).
 */

const IMAGES = `Image 1 is a photo of my client's {{piece}}, taken with a phone. Image 2 is a reference board: a light grey sheet of labelled square samples of Cover Styl' adhesive decor film — {{nombre_echantillons}} in all, one per zone, each label naming its zone. (If the images arrive in another order, recognise them by their content: the room is Image 1, the grey sheet of samples is Image 2.)`;

const METHODE = `HOW THE JOB IS DONE IN REAL LIFE: an installer wraps the existing surfaces with a 0.2 mm adhesive film. The film takes the exact shape it is laid on. It adds no thickness, moves nothing, removes nothing, repairs nothing and adds no light. Keep every shape, edge and gap of Image 1; only the skin of the listed surfaces changes.`;

const JAMAIS = `NEVER
- Never copy the reference board, its grey background, its labels or any text or logo into the photo.
- Never invent a door, a handle, a light, a window, a shelf, a plant or any object; never complete an area that is dark, blurred or cut by the frame — reproduce it as it is.
- Never let a film spread beyond its limits or tint a neighbouring surface.`;

const FIN = `Output ONE photorealistic image in the same {{format}} format as Image 1. Generate it directly, without asking me any question.`;

function verification(specifique: string[]): string {
  const points = [
    "Outside the covered surfaces, Image 1 and your result superimpose exactly: same edges, same objects, same borders of the frame.",
    ...specifique,
    "Every listed surface is covered edge to edge, including parts cut by the frame or hidden behind an object — no patch of the old material is left.",
    "Each film matches its sample on Image 2 AND its written description: same colour, same pattern, true-to-life scale, same finish.",
    "Nothing added, removed, tidied, embellished or invented.",
  ];
  return `FINAL CHECK — before you output, compare your result with Image 1 and fix every difference:\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}

function verrou(lignes: string[]): string {
  return `LOCKED — everything else stays identical to Image 1, as if both photos were taken the same second from the same spot:\n${[
    "Framing: same camera position, angle, perspective, crop and aspect ratio ({{format}}). No zoom, no straightening, no widening, no cropping.",
    ...lignes,
    "Light: same light sources, same direction, same colour temperature, same exposure. Shadows, highlights and reflections stay where they were; the new films simply receive the light that was already there.",
    "Same photographic look: same sharpness, blur, noise and colour balance. Not \"improved\", not HDR, not staged.",
  ]
    .map((l) => `- ${l}`)
    .join("\n")}`;
}

function assembler(piece: string, tache: string, surfaces: string, verrous: string[], controles: string[]): string {
  return [IMAGES.replace("{{piece}}", piece), `TASK: edit Image 1 — ${tache} This is a retouch of Image 1 itself, not a new picture, not a redesign, not a 3D render.`, METHODE, `SURFACES TO COVER\n${surfaces.trim()}\n{{zones_inchangees}}`, verrou(verrous), JAMAIS, verification(controles), FIN].join("\n\n");
}

/* ── Sections de zone, reprises des surfaces du site ──────────────── */

const Z_HAUTS = `[zone:meubles-hauts]
• WALL UNITS (upper cabinets) — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the front of every door and flap of the wall-mounted cabinets above the worktop, the filler strips between them, their visible end panels and their underside.
  Stops at: the outline of each door. The extractor hood, open shelves and what stands on them, under-cabinet lights, the backsplash below and the ceiling above are not part of it.
  Laying: each door is wrapped separately — the decor restarts on every door and never flows across the gaps. Frames and grooves keep their relief under the film. The shadow the wall units cast on the backsplash stays identical.
[/zone]`;

const Z_BAS = `[zone:meubles-bas]
• BASE UNITS, TALL UNITS AND ISLAND — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the front of every door and drawer below the worktop, the fronts of floor-standing tall units, the fronts, back and end panels of the island or peninsula, and the visible end panels of the base runs. An integrated dishwasher or fridge hidden behind a cabinet front is covered like the other fronts.
  Stops at: under the worktop edge at the top, above the plinth (kickboard) at the bottom. The plinth, the oven, steel or glass appliance doors and the dishwasher control strip keep their look.
  Laying: each door and drawer front is wrapped separately; on a drawer stack the decor restarts on each drawer. Reliefs stay visible under the film. Anything standing in front of the units stays in front, complete; the film passes behind it.
[/zone]`;

const Z_PLAN = `[zone:plan-de-travail]
• WORKTOP — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the top surface of every worktop (island top included) and its visible front and side edges, plus an upstand strip of the same material if there is one.
  Stops at: the wall joint (the silicone line stays), the rim of the sink and of the hob, the bottom of the front edge. Thickness and edge profile (square, rounded, bevelled) stay exactly the same.
  Laying: the film lies flat in one direction along the length of the worktop and folds over the front edge, so the decor continues from the top onto the edge; on an L-shaped worktop the direction turns at the corner joint. Every object standing on the worktop stays in place with its shadow and reflection: the film is visible only around and between them. Window and lamp highlights stay at the same place.
[/zone]`;

const Z_CREDENCE = `[zone:credence]
• BACKSPLASH — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the wall between the top of the worktop and the underside of the wall units or hood, along the whole length where a backsplash exists, behind the hob and the sink included.
  Stops at: the worktop joint at the bottom; the wall units, hood or shelf at the top — where there is no wall unit, where the existing tiles or panel stop (a painted wall above stays painted). Never onto a side wall, a window reveal or the ceiling.
  Laying: the film covers the old tiles completely — grout lines disappear and the backsplash becomes one continuous flat panel. Sockets, switches, rails and hanging utensils stay, cut out cleanly. Light pools from under-cabinet spots fall on the new decor exactly where they fell before.
[/zone]`;

const VERROUS_CUISINE = [
  "Geometry: same cabinets at the same place and size, same number of doors and drawers, same gaps, same edge profiles, same layout.",
  "Handles, knobs, hinges, sink, tap, hob, oven, hood, fridge, dishwasher, microwave, sockets, switches and lights: same model, same finish, same position — never replaced, never restyled.",
  "Every object stays exactly where it is, with its shadow and reflection: bottles, jars, kettle, coffee machine, boards, plants, fruit, cables, magnets, dishes, towels. Nothing is tidied, added or removed.",
  "Walls, floor, ceiling, windows and every surface not listed above keep their exact colour and material — do not harmonise them with the new films.",
];
const CONTROLES_CUISINE = ["Same number of doors, drawers and handles; every handle at the same place and height.", "Every object that stood on the worktop is still there, same place, same size, same shadow."];

function cuisineUneZone(section: string, tache: string, inchange: string, controle: string): string {
  return assembler("kitchen", tache, `${section}\n• NOT COVERED: ${inchange} They keep their original material and colour exactly.`, VERROUS_CUISINE, [controle, ...CONTROLES_CUISINE]);
}

export const PROMPTS_PAR_DEFAUT: Record<string, { texte: string; note: string }> = {
  cuisine: {
    note: "Version d'origine : cuisine, une teinte par zone (meubles hauts, bas, plan de travail, crédence).",
    texte: assembler(
      "kitchen",
      "lay the films of Image 2 on the kitchen surfaces listed below, each on its own zone, and change NOTHING else.",
      [Z_HAUTS, Z_BAS, Z_PLAN, Z_CREDENCE].join("\n"),
      VERROUS_CUISINE,
      [...CONTROLES_CUISINE, "Each zone wears ITS OWN film (the one whose label names it on Image 2) — no zone takes the film of another."]
    ),
  },
  "meubles-hauts": {
    note: "Version d'origine : meubles hauts seuls.",
    texte: cuisineUneZone(Z_HAUTS, "lay the film of Image 2 on the wall units (upper cabinets) only, and change NOTHING else.", "the base units, the island, the tall units, the worktop and the backsplash.", "Upper doors wear the new film; base units, drawers, tall units and island are strictly unchanged (same colour, same sheen). Same number of upper doors as Image 1."),
  },
  "meubles-bas": {
    note: "Version d'origine : meubles bas, colonnes et îlot.",
    texte: cuisineUneZone(Z_BAS, "lay the film of Image 2 on the base units, tall units and island fronts only, and change NOTHING else.", "the wall units above the worktop, the worktop and the backsplash.", "Doors and drawers below the worktop: same number, same heights, same gaps as Image 1. The wall units are strictly unchanged."),
  },
  "plan-de-travail": {
    note: "Version d'origine : plan de travail seul.",
    texte: cuisineUneZone(Z_PLAN, "lay the film of Image 2 on the worktop only, and change NOTHING else.", "all cabinet fronts (upper and lower), the island fronts and the backsplash.", "The sink and hob cut-outs keep the same shape; no patch of the old worktop remains between objects or behind the tap."),
  },
  credence: {
    note: "Version d'origine : crédence seule.",
    texte: cuisineUneZone(Z_CREDENCE, "lay the film of Image 2 on the backsplash only, and change NOTHING else.", "all cabinet fronts, the worktop and the walls above or beside the backsplash.", "Same number of sockets and switches at the same positions; no tile joint shows through; the decor does not climb above the original backsplash height nor spread onto a side wall."),
  },
  "plan-vasque": {
    note: "Version d'origine : salle de bain, plan vasque et meuble vasque.",
    texte: assembler(
      "bathroom",
      "lay the films of Image 2 on the bathroom vanity surfaces listed below, and change NOTHING else.",
      `[zone:plan-vasque]
• VANITY TOP (the countertop around the basin) — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the horizontal top of the vanity around or under the basin, with its visible front and side edges.
  Stops at: the rim of the basin (inset, semi-recessed or vessel bowl) — the ceramic bowl is never covered; the wall joint at the back; the bottom of the front edge. If basin and top are one single moulded piece with no separate top, change nothing here.
  Laying: the film lies flat and folds over the front edge; a cut-out follows the basin outline precisely. Taps, soap dispenser, glasses, cosmetics and towels stay exactly where they are, with their contact shadows.
[/zone]
[zone:meuble-vasque]
• VANITY CABINET (fronts and sides of the unit under the basin) — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the door and drawer fronts of the vanity unit and its visible side panels, plus the fronts of a matching tall bathroom cabinet standing next to it in the same finish.
  Stops at: under the vanity top at the top, the bottom edge of the unit. Handles, legs and wall brackets keep their look.
  Laying: each front is wrapped separately; the decor restarts on every door and drawer. Reliefs stay visible under the film.
[/zone]`,
      [
        "Mirror: it keeps showing the original room; only the reflected strip of a covered surface changes in it, nothing else in the reflection.",
        "Glass shower screens stay perfectly transparent; the basin bowl, the bathtub, the toilet and all ceramics keep their original white.",
        "Taps, shower, towel rails, radiator, lights, sockets, switches: same model, same finish, same position.",
        "Every object stays exactly where it is (bottles, toothbrushes, cosmetics, towels, plants), with its shadow. Nothing tidied, added or removed.",
        "Wall tiles, floor, ceiling and every surface not listed above keep their exact colour and material.",
      ],
      ["Same number of drawers and doors, same handles at the same place.", "The basin outline, the tap and every object superimpose exactly on Image 1."]
    ),
  },
  dressing: {
    note: "Version d'origine : portes de dressing et placards.",
    texte: assembler(
      "room (a wardrobe or closet)",
      "lay the film of Image 2 on the wardrobe doors only, and change NOTHING else.",
      `[zone:portes-dressing]
• WARDROBE AND CLOSET DOORS (hinged or sliding) — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the front face of every door leaf visible in Image 1 — hinged, sliding or folding — and the fixed filler or top panels belonging to the same front.
  Stops at: the outline of each leaf. Aluminium or steel frames and handle profiles of sliding doors, top and bottom rails, the gaps between leaves and the overlap of sliding panels keep their exact position and colour.
  Laying: each leaf is wrapped as one tall panel — the decor runs over the full height without a seam and restarts on the next leaf. Horizontal dividing strips or grooves stay visible under the film. Large flat doors keep the soft gradient of the room light exactly as in Image 1.
[/zone]`,
      [
        "Geometry: same number of leaves, same widths, same overlaps, same handle profiles, same layout.",
        "Mirror doors or mirror strips stay mirrors with the same reflection; glass inserts stay glass.",
        "If a door is open, everything inside (clothes, hangers, shelves, boxes) stays exactly as it is.",
        "Handles, hinges, rails, the surrounding walls, ceiling, floor, skirting boards and every piece of furniture or object in the room keep their exact look and position.",
      ],
      ["Same number of leaves, same widths and overlaps, same handles.", "A mirrored door is still a mirror; nothing inside an open wardrobe has moved."]
    ),
  },
  "meuble-tv": {
    note: "Version d'origine : meuble TV.",
    texte: assembler(
      "living room (a TV unit)",
      "lay the film of Image 2 on the TV unit only, and change NOTHING else.",
      `[zone:meuble-tv]
• TV UNIT / MEDIA CABINET — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the door and drawer fronts, the top surface, the visible side panels and the visible frame of the TV unit; matching wall cabinets or shelves of the same furniture set are included.
  Stops at: the outline of the furniture. Open compartments keep their depth: only their visible inner faces made of the same material are covered, their back stays in shadow as in Image 1. Legs and metal feet are not covered.
  Laying: each front is wrapped separately; the top is one continuous panel whose decor runs along the length of the unit and folds onto the front edge. Objects on the top stay in place with their contact shadows; the film is visible only around them.
[/zone]`,
      [
        "The television, its stand or bracket, the screen and what it shows or reflects, soundbar, speakers, consoles, boxes, remotes, cables and LED strips stay exactly as they are.",
        "Books, plants and decorative objects on or in the unit stay in place, same size, same shadow.",
        "Handles, feet, glass doors, the wall behind, the floor, the rug and every other piece of furniture keep their exact look.",
      ],
      ["The television and every device and object superimpose exactly on Image 1.", "Same number of doors, drawers and open compartments; feet and handles unchanged."]
    ),
  },
  bar: {
    note: "Version d'origine : bar ou comptoir, façade et plateau.",
    texte: assembler(
      "bar / reception counter (a professional space)",
      "lay the films of Image 2 on the counter surfaces listed below, and change NOTHING else.",
      `[zone:comptoir-habillage]
• COUNTER FRONT CLADDING — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the customer-facing front of the bar or counter and its visible side and return panels, over their full height, a curved front included.
  Stops at: under the top overhang at the top, above the kick plate, footrest or plinth at the bottom. The top surface is another zone.
  Laying: large continuous panels; on a curved front the decor follows the curve without changing scale. Existing panel joints or grooves stay visible. LED light washing the front keeps the same colour and falloff.
[/zone]
[zone:comptoir-plateau]
• COUNTER TOP — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the horizontal top of the bar, counter or reception desk (both levels if it has a raised shelf), with its visible edges.
  Stops at: the bottom of the edge. Thickness and edge profile are unchanged.
  Laying: the film lies flat along the length of the counter and folds over the edge. Every item on the top stays in place with its contact shadow and reflection; ceiling-light highlights stay at the same place.
[/zone]`,
      [
        "Logos, lettering, illuminated signs and brand colours fixed on the counter stay intact and perfectly legible, at the same place — the film passes around them.",
        "Till, card terminal, screens, beer taps, glasses, bottles, menus, plants, stools and seats stay exactly as they are; staff and customers are untouched.",
        "Floor, walls, ceiling, lights and every surface not listed above keep their exact colour and material.",
      ],
      ["Every logo and sign present in Image 1 is intact and readable.", "Everything on and in front of the counter superimposes exactly on Image 1."]
    ),
  },
  "mobilier-pro": {
    note: "Version d'origine : mobilier professionnel (distributeur, borne, casiers) et rangements.",
    texte: assembler(
      "professional space (commercial furniture)",
      "lay the films of Image 2 on the surfaces listed below, and change NOTHING else.",
      `[zone:mobilier-pro]
• MACHINE OR COMMERCIAL FURNITURE — BODY PANELS — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the opaque body panels of the main machine or piece of commercial furniture of Image 1: side panels, front surround, top fascia and door skin of a vending machine or kiosk; outer panels and fronts of lockers, display units or shop fittings.
  Stops at: the rim of every functional opening and at every trim, seal, hinge line and ventilation grille. Panel seams stay visible.
  Laying: each panel is wrapped separately up to its edges, like vehicle wrapping on flat panels; the decor restarts at each seam. Backlit areas stay backlit with the same brightness.
[/zone]
[zone:rangements-pro]
• STORAGE FRONTS — sample "{{etiquette}}" on Image 2.
  Film: {{teinte}}
  Covers: the front of every door and drawer of the storage cabinets, cupboards and low units, and their visible end panels.
  Stops at: the outline of each front; the gaps between fronts stay as they are.
  Laying: each front is wrapped separately; the decor restarts on every front.
[/zone]`,
      [
        "Product windows and the products behind them, screens and what they show, keypads, buttons, slots, card readers, delivery flaps, locks, handles, label holders, price labels, stickers, QR codes and printed branding stay intact, legible and at the same place — the film passes around them.",
        "Objects on shelves, chairs, plants, printers, the walls and the floor keep their exact look and position.",
      ],
      ["Every button, slot, reader, screen, window and sticker is present, same place, same size, readable.", "Same number of doors, drawers, handles and locks."]
    ),
  },
};
