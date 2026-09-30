/**
 * LES ZONES DU SIMULATEUR — source unique (mission 15, partie 2).
 *
 * Fusion de `surfaces.ts` du site (consigne par surface : cible, limites,
 * exclus, pose, sens, contrôle) et de `types-surface.ts` / `prestations.ts` du
 * CRM (libellés, sens de pose, pièces). Le moteur de prompt (`moteur/`) la lit ;
 * le site la recevra par `GET /api/site/simulateur` (partie 4) ; l'espace par
 * `creationPourLeClient` (partie 5). Aucune dépendance Node : importable par
 * les écrans.
 *
 * Une zone = ce que le film recouvre, exactement, en anglais (la langue que le
 * modèle d'image suit le mieux). `facades-cuisine` est une zone composée
 * (meubles hauts + meubles bas) ; `tablier-baignoire` et les murs y figurent.
 */

/** Les zones élémentaires : celles que le CRM range dans une simulation (`types-surface.ts › IdZone`). */
export type IdZoneElementaire =
  | "meubles-hauts"
  | "meubles-bas"
  | "plan-de-travail"
  | "credence"
  | "meuble-vasque"
  | "plan-vasque"
  | "carrelage-mural"
  | "tablier-baignoire"
  | "portes-dressing"
  | "meuble-tv"
  | "meuble-complet"
  | "comptoir-habillage"
  | "comptoir-plateau"
  | "mobilier-pro"
  | "rangements-pro"
  | "habillage-mural"
  | "mur-principal"
  | "mur-accent"
  | "plafond";

/** Toutes les zones du simulateur, zone composée comprise (« Façades (toutes) » = meubles hauts + meubles bas). */
export type IdZone = IdZoneElementaire | "facades-cuisine";

export type IdPiece = "cuisine" | "salle-de-bain" | "meubles" | "mur-plafond" | "professionnel";

/** Sens d'un décor directionnel (bois, lignes, métal brossé, lin). */
export type SensPose = "vertical" | "longueur" | "horizontal";

/** Famille de pose : comment le film s'applique sur cette forme (moteur › materiaux). */
export type FamillePose = "facades" | "plan" | "credence" | "murs" | "comptoir" | "ilot" | "meuble";

export type Zone = {
  id: IdZone;
  /** Libellé court (écran du CRM, étiquette de la planche : « A · Meubles hauts »). */
  libelle: string;
  /** Ce que le visiteur lit sous le libellé. */
  description: string;
  /** Nom anglais de la zone, dans le prompt. */
  nom: string;
  /** Nom anglais court (listes « NOT COVERED », verrous). */
  nomCourt: string;
  /** Ce qui reçoit le film, exactement. */
  cible: string;
  /** Où le film s'arrête. */
  limites: string;
  /** Ce qui touche la zone ou s'y trouve, et ne change jamais. */
  exclus: string;
  /** Comment le film se pose sur cette forme. */
  pose: string;
  sens: SensPose;
  famillePose: FamillePose;
  /** Contrôle final propre à cette zone. */
  controle: string;
  /** Zones incompatibles (les choisir ensemble reviendrait à couvrir deux fois la même surface). */
  exclut?: IdZone[];
  /** Zone composée : les zones élémentaires qu'elle recouvre (analyse de la photo, dépliage). */
  compose?: IdZoneElementaire[];
};

export type Piece = {
  id: IdPiece;
  libelle: string;
  /** Titre de l'écran résultat : « Votre cuisine ». */
  titre: string;
  /** Code de l'espace client et des leads (CUISINE, SDB…). */
  code: "CUISINE" | "SDB" | "MEUBLES" | "MURS" | "PRO";
  /** La pièce dans le prompt (« a kitchen », « an interior room »). */
  nomEn: string;
  /** Mot en majuscules du titre du bloc « THE KITCHEN IN IMAGE 1 ». */
  titreEn: string;
  /** Une phrase générique quand la photo n'a pas été analysée. */
  phraseGenerique: string;
  zones: IdZone[];
};

/** Nombre maximal de zones dans un même rendu (au-delà, le modèle perd en fidélité et le coût monte). */
export const ZONES_MAX = 4;

const LISTE: Zone[] = [
  /* ───────────── Cuisine ───────────── */
  {
    id: "facades-cuisine",
    libelle: "Façades (toutes)",
    description: "Toutes les portes et tous les tiroirs : meubles hauts, bas, colonnes, îlot",
    nom: "ALL KITCHEN CABINET FRONTS (wall units, base units, tall units, island)",
    nomCourt: "all cabinet fronts",
    exclut: ["meubles-hauts", "meubles-bas"],
    compose: ["meubles-hauts", "meubles-bas"],
    cible:
      "the front face of every cabinet door, every drawer front, every flap and every fixed filler panel of the kitchen, plus the visible end panels of the cabinet runs and of the island — on wall units, base units, tall/column units and island alike, including fronts that are partly hidden by an object or cut by the edge of the frame.",
    limites:
      "the film stops at the outline of each individual front. The dark gaps between two fronts, the shadow line under the worktop overhang and the recessed handle grooves stay exactly as dark, as wide and as straight as in Image 1. The plinth/kickboard under the base units keeps its original material.",
    exclus:
      "handles, knobs, finger-pull profiles, hinges, glass inserts of glazed doors, integrated appliance fascias that are steel or glass (oven door, microwave, hood, wine cooler), control panels, the worktop, the backsplash, the sink, the plinth, the cabinet interiors visible through an open or glazed door.",
    pose:
      "each front is wrapped separately, like a real installer does: the decor restarts on every door and drawer and does not flow across the gap as one continuous picture. Shaker frames, routed grooves, bevels and mouldings keep their relief: the film follows them, so their highlight and shadow lines remain visible under the new decor. An integrated dishwasher or fridge hidden behind a cabinet front is a cabinet front: cover it.",
    sens: "vertical",
    famillePose: "facades",
    controle:
      "count the doors, drawer fronts and handles in Image 1 and in your result: the three counts must be equal and every handle must sit at the same height and the same distance from the edge. No front may remain in the old colour, not even a narrow filler or a front at the very edge of the frame.",
  },
  {
    id: "meubles-hauts",
    libelle: "Meubles hauts",
    description: "Les portes des meubles suspendus au-dessus du plan de travail",
    nom: "WALL UNITS (upper kitchen cabinets)",
    nomCourt: "wall units (upper cabinets)",
    exclut: ["facades-cuisine"],
    cible:
      "the front face of every door and flap of the wall-mounted cabinets located ABOVE the worktop, the fixed filler panels between them, their visible end panels and the visible underside panel of these wall units.",
    limites:
      "the film stops at the outline of each upper front. Everything at or below worktop level belongs to another zone: base units, drawers, island, and tall column units standing on the floor are NOT wall units and keep their original material unless they are listed as another zone.",
    exclus:
      "the extractor hood and its casing, under-cabinet lights, handles and hinges, glass inserts, open shelves and what stands on them, the backsplash right below the wall units, the ceiling and cornice above them.",
    pose: "each upper door is wrapped separately; the decor restarts on every door. Reliefs (frames, grooves) stay visible under the film. The shadow that the wall units cast on the backsplash stays identical.",
    sens: "vertical",
    famillePose: "facades",
    controle:
      "upper doors wear the new film; base units, drawers, tall units and island are strictly unchanged (same colour, same sheen) unless they are another zone. Count the upper doors: same number as Image 1.",
  },
  {
    id: "meubles-bas",
    libelle: "Meubles bas",
    description: "Portes et tiroirs sous le plan de travail, colonnes, îlot",
    nom: "BASE UNITS, TALL UNITS AND ISLAND FRONTS (lower kitchen cabinets)",
    nomCourt: "base units, tall units and island fronts",
    exclut: ["facades-cuisine"],
    cible:
      "the front face of every door and drawer front located BELOW the worktop, the fronts of the floor-standing tall/column units, the fronts, back panel and end panels of the island or peninsula, and the visible end panels of the base runs.",
    limites:
      "the film stops under the worktop edge at the top and above the plinth at the bottom. Wall-mounted cabinets above the worktop are NOT part of this zone and keep their original material unless listed as another zone.",
    exclus:
      "the worktop and its edge, the plinth/kickboard, handles and finger-pull profiles, oven, dishwasher control strip, steel or glass appliance doors, sockets on the island, and anything that stands in front of the units in Image 1 (it stays in front, complete; the film passes behind it).",
    pose: "each door and drawer front is wrapped separately; on a drawer stack the decor restarts on each drawer. An integrated dishwasher or fridge behind a cabinet front is covered like the other fronts. Reliefs stay visible under the film.",
    sens: "vertical",
    famillePose: "ilot",
    controle: "count drawers and doors below the worktop: same number, same heights, same gaps as Image 1. The upper cabinets must be strictly unchanged unless they are another zone.",
  },
  {
    id: "plan-de-travail",
    libelle: "Plan de travail",
    description: "La surface horizontale de travail et son chant",
    nom: "KITCHEN WORKTOP (countertop)",
    nomCourt: "worktop",
    cible:
      "the horizontal top surface of the worktop(s), island top included, together with its visible front edge and side edges, and the matching upstand strip if the worktop has one made of the same material.",
    limites:
      "the film stops where the worktop meets the wall or backsplash (keep the silicone/joint line), at the cut-out rims of the sink and of the hob, and at the bottom of the front edge. The thickness and the edge profile (square, rounded, bevelled) stay exactly the same.",
    exclus:
      "the sink bowl and drainer, tap, hob/cooktop glass and burners, pop-up sockets, and EVERY object standing on the worktop — appliances, jars, bottles, boards, fruit, plants, dish rack, cables. Objects are not moved, not removed, not cleaned up; the film is visible only around and between them, and their contact shadows and reflections on the top stay in place.",
    pose:
      "the film lies flat in one direction along the length of the worktop and folds down over the front edge, so the decor continues from the top onto the edge and the returns, matched at the fold. On an L-shaped worktop the direction follows each run and changes at the corner joint. Window and lamp highlights stay at the same place with the same shape; only their sharpness adapts to the new finish.",
    sens: "longueur",
    famillePose: "plan",
    controle:
      "every object that stood on the worktop in Image 1 is still there, same place, same size, same shadow. The sink and hob cut-outs have the same shape. No patch of the old worktop remains between objects or behind the tap.",
  },
  {
    id: "credence",
    libelle: "Crédence",
    description: "Le mur entre le plan de travail et les meubles hauts",
    nom: "KITCHEN BACKSPLASH (wall strip between worktop and wall units)",
    nomCourt: "backsplash",
    cible:
      "the vertical wall surface between the top of the worktop and the underside of the wall units or hood, along the whole length where it exists in Image 1, including the return behind the hob and behind the sink.",
    limites:
      "bottom limit: the joint line on the worktop. Top limit: the underside of the wall units, of the hood or of a shelf; where there is no wall unit, the film stops at the height where the existing backsplash (tiles, glass, panel) stops — if the wall above is painted, it stays painted. Side limits: the end of the existing backsplash; never extend onto adjacent walls, window reveals or the ceiling.",
    exclus:
      "sockets, switches, their cover plates, rail systems, hooks, utensils hanging on the wall, the hood, under-cabinet lighting, the window and its frame, and all objects standing in front of the backsplash (they stay in front; the film passes behind them).",
    pose:
      "the film covers the old tiles completely: the tile grid and grout lines disappear and the backsplash becomes one continuous, flat panel of the new decor. Sockets and switches remain, cut out cleanly. The light pools from under-cabinet spots and the shadow under the wall units fall on the new decor exactly where they fell before.",
    sens: "horizontal",
    famillePose: "credence",
    controle: "same number of sockets and switches at the same positions. No tile joint shows through. The decor does not climb above the original backsplash height nor spread onto a side wall.",
  },

  /* ───────────── Salle de bain ───────────── */
  {
    id: "meuble-vasque",
    libelle: "Meuble vasque",
    description: "Les façades et les côtés du meuble sous le lavabo",
    nom: "BATHROOM VANITY CABINET (fronts and sides of the unit under the basin)",
    nomCourt: "vanity cabinet fronts",
    cible: "the door and drawer fronts of the vanity unit and its visible side panels, plus the fronts of a matching tall bathroom cabinet if one stands next to it in the same finish.",
    limites: "the film stops under the vanity top / basin at the top and at the bottom edge of the unit. The top surface of the vanity is another zone.",
    exclus: "the basin, the tap, the vanity top, handles, legs or wall brackets, the mirror and its reflection, towels and objects, the wall and floor around the unit.",
    pose: "each front is wrapped separately; the decor restarts on every door and drawer. The reflection of the vanity in a mirror or in a glossy floor follows the new decor only where the vanity itself is reflected — the rest of every reflection is unchanged.",
    sens: "vertical",
    famillePose: "facades",
    controle: "same number of drawers and doors, same handles. The basin is still pure ceramic, same shape, same white.",
  },
  {
    id: "plan-vasque",
    libelle: "Plan vasque",
    description: "Le dessus du meuble, autour du lavabo",
    nom: "BATHROOM VANITY TOP (countertop around the basin)",
    nomCourt: "vanity top",
    cible: "the horizontal top surface of the vanity around or under the basin, with its visible front and side edges.",
    limites:
      "the film stops at the rim of the basin (inset, semi-recessed or vessel bowl): the ceramic bowl is never covered. It stops at the wall joint at the back and at the bottom of the front edge. If the basin and the top are one single moulded ceramic or resin piece with no separate top, there is nothing to cover here: leave it unchanged.",
    exclus:
      "the basin bowl, the tap and its base plate, the pop-up waste, soap dispenser, toothbrush glass, cosmetics, plants, towels — every object stays exactly where it is, with its contact shadow. The mirror above and what it reflects stay unchanged, except the reflected strip of the top itself.",
    pose: "the film lies flat and folds over the front edge; the decor continues from the top onto the edge, matched at the fold. A cut-out follows the basin outline precisely. Water-splash highlights and the soft reflection of the tap on the top stay at the same place.",
    sens: "longueur",
    famillePose: "plan",
    controle: "the basin outline, the tap and every object are superimposable on Image 1. No old top material remains between the objects or behind the tap.",
  },
  {
    id: "carrelage-mural",
    libelle: "Murs carrelés",
    description: "Les murs carrelés de la salle de bain",
    nom: "BATHROOM WALL TILES",
    nomCourt: "tiled walls",
    cible: "the wall areas that are tiled in Image 1 (or clad with a panel), over their full existing extent.",
    limites: "the film stops where the existing tiling stops: at a painted wall, at the ceiling, at the floor, at a window reveal, at the rim of the bathtub or shower tray. Painted walls stay painted. The floor tiles are never part of this zone.",
    exclus:
      "mirrors and everything they reflect, glass shower screens (they stay transparent: the covered wall is seen through them with the same glass tint and reflections), taps, shower column, towel rail, radiator, hooks, shelves and the products on them, sockets, switches, light fittings, ventilation grille, toilet, cistern plate.",
    pose: "the film covers the tiles completely: the tile grid and grout lines disappear; the wall becomes continuous panels of the new decor. Fixtures stay mounted through the film. Niches keep their depth and their shadow.",
    sens: "vertical",
    famillePose: "murs",
    controle: "glass is still transparent. The mirror still shows the same scene. No tile joint shows through. Nothing has been added to or removed from the walls.",
  },
  {
    id: "tablier-baignoire",
    libelle: "Tablier de baignoire",
    description: "Le panneau sous la baignoire ou l'habillage du receveur",
    nom: "BATHTUB APRON / SHOWER SURROUND PANEL",
    nomCourt: "bathtub side panel",
    cible: "the vertical side panel (apron) of the bathtub, or the clad riser under a shower tray, as visible in Image 1.",
    limites: "the film stops under the rim of the tub at the top and at the floor at the bottom.",
    exclus: "the inside of the bathtub, the rim, the shower tray, the taps, the glass screen, the floor, bath mats and objects standing against the panel.",
    pose: "a single flat panel of the new decor, laid in one length; an access hatch keeps its outline.",
    sens: "horizontal",
    famillePose: "meuble",
    controle: "the bathtub interior and rim keep their original white and their highlights.",
  },

  /* ───────────── Meubles ───────────── */
  {
    id: "portes-dressing",
    libelle: "Portes du dressing",
    description: "Portes battantes ou coulissantes, du sol au plafond",
    nom: "WARDROBE AND CLOSET DOORS (hinged or sliding)",
    nomCourt: "wardrobe doors",
    cible: "the front face of every wardrobe/closet door leaf visible in Image 1 — hinged, sliding or folding — and the fixed filler or top panels belonging to the same front.",
    limites:
      "the film stops at the outline of each leaf. Aluminium or steel frames and vertical handle profiles of sliding doors, top and bottom rails, the gaps between leaves and the overlap of sliding panels keep their exact position and colour.",
    exclus:
      "mirror doors or mirror strips (a mirrored leaf stays a mirror, reflection unchanged), glass inserts, handles, hinges, rails, the inside of the wardrobe if a door is open (clothes, hangers, shelves, boxes: untouched, same arrangement), the surrounding wall, ceiling, floor, skirting boards, and any furniture or object standing in front of the doors.",
    pose:
      "each leaf is wrapped separately as one tall panel: the decor runs over the full height without a horizontal seam and restarts on the next leaf. Horizontal dividing strips or grooves in a door stay visible under the film. Large flat doors show the soft gradient of the room light exactly as in Image 1 — do not flatten it, do not add a new reflection.",
    sens: "vertical",
    famillePose: "facades",
    controle: "same number of leaves, same widths, same overlaps and same handle profiles. A mirrored door is still a mirror. Nothing inside an open wardrobe has moved.",
  },
  {
    id: "meuble-tv",
    libelle: "Meuble TV",
    description: "Façades, dessus et côtés du meuble TV",
    nom: "TV UNIT / MEDIA CABINET",
    nomCourt: "TV unit",
    cible: "the door and drawer fronts, the top surface, the visible side panels and the visible frame of the TV unit. If the unit includes wall-mounted matching cabinets or shelves of the same furniture set, their visible faces are included.",
    limites: "the film stops at the outline of the furniture. Open compartments keep their depth: only their visible inner faces that share the furniture's material are covered; their back stays in shadow as in Image 1.",
    exclus:
      "the television, its stand or wall bracket, the screen content and reflections, soundbar, speakers, consoles, set-top boxes, remotes, cables, LED strips, books and decorative objects on or in the unit, legs or metal feet, handles, glass doors, the wall behind, the floor and rug.",
    pose: "each front is wrapped separately; the top is one continuous panel whose decor runs along the length of the unit and folds onto the front edge. Objects on the top stay in place with their contact shadows; the film is visible only around them.",
    sens: "horizontal",
    famillePose: "meuble",
    controle: "the television and every device and object are superimposable on Image 1. Same number of doors, drawers and open compartments. Feet and handles unchanged.",
  },
  {
    id: "meuble-complet",
    libelle: "Commode, buffet, bureau",
    description: "Un meuble seul : façades, dessus et côtés",
    nom: "FREESTANDING PIECE OF FURNITURE (chest of drawers, sideboard, desk, bedside table)",
    nomCourt: "freestanding furniture",
    cible: "all visible outer panels of the piece of furniture that is the main subject of Image 1: drawer and door fronts, top surface, side panels and visible frame.",
    limites: "the film stops at the outline of the furniture. Turned or carved legs, metal feet and castors are not covered.",
    exclus: "handles, knobs, keyholes, legs, glass or mirror parts, everything placed on or in the furniture (lamps, frames, vases, books, screens, papers), the wall, floor, rug and any other furniture of the room.",
    pose: "each drawer and door front is wrapped separately; the top is one continuous panel. Mouldings, bevels and frame-and-panel reliefs stay visible under the film with their shadow lines.",
    sens: "horizontal",
    famillePose: "meuble",
    controle: "same number of drawers and doors, same handles at the same place, same objects on top. Only ONE piece of furniture has changed.",
  },

  /* ───────────── Professionnel ───────────── */
  {
    id: "comptoir-habillage",
    libelle: "Façade du bar",
    description: "La face avant et les côtés du bar ou du comptoir d'accueil",
    nom: "BAR / RECEPTION COUNTER — FRONT CLADDING",
    nomCourt: "bar front cladding",
    cible: "the customer-facing front face of the bar or counter and its visible side and return panels, over their full height, including a curved front if the counter is curved.",
    limites: "the film stops under the counter top overhang at the top and above the kick plate / footrest / plinth at the bottom. The top surface is another zone.",
    exclus:
      "logos, lettering, illuminated signs and brand colours fixed on the counter (they stay, perfectly legible, same place — the film passes around them), LED strips and their glow, footrest rail, kick plate, any seat standing in front of the counter in Image 1 (it stays complete, the film passes behind it), card terminals, tills, screens, taps and beer pumps, glass displays, menus, bottles and everything on or behind the bar, the staff and customers.",
    pose: "large continuous panels; on a curved front the decor follows the curve without distortion of scale. Panel joints or decorative grooves existing in Image 1 stay visible. LED light washing down or up the front keeps the same colour and falloff on the new decor.",
    sens: "vertical",
    famillePose: "comptoir",
    controle: "every logo and sign present in Image 1 is intact and readable. Nothing in front of or on the counter has changed. The top of the counter keeps its original material unless it is another zone.",
  },
  {
    id: "comptoir-plateau",
    libelle: "Plateau du bar",
    description: "Le dessus du bar, du comptoir ou du bureau d'accueil",
    nom: "BAR / RECEPTION COUNTER — TOP SURFACE",
    nomCourt: "bar top",
    cible: "the horizontal top surface of the bar, counter or reception desk (both levels if it has a raised customer shelf), with its visible edges.",
    limites: "the film stops at the bottom of the edge. Thickness and edge profile are unchanged.",
    exclus:
      "every item on the top: till, card terminal, screen, keyboard, phone, papers, brochures, glasses, bottles, drip trays, beer taps, sinks, plants, signs — all stay in place with contact shadows and reflections. People, their hands and arms resting on the counter stay untouched.",
    pose: "the film lies flat along the length of the counter and folds over the edge and the returns, matched at the fold. Ceiling-light highlights on the top stay at the same place; only their sharpness adapts to the new finish.",
    sens: "longueur",
    famillePose: "plan",
    controle: "all objects and hands on the counter are superimposable on Image 1. No patch of old surface remains between them.",
  },
  {
    id: "mobilier-pro",
    libelle: "Mobilier",
    description: "Carrosserie d'un distributeur, borne, présentoir, casiers, mobilier d'agencement",
    nom: "VENDING MACHINE / KIOSK / COMMERCIAL FURNITURE — BODY PANELS",
    nomCourt: "commercial furniture body panels",
    cible:
      "the opaque body panels of the machine or commercial furniture that is the main subject of Image 1: side panels, front surround, top fascia and door skin of a vending machine or kiosk; outer panels and fronts of lockers, display units, shop fittings or office storage.",
    limites: "the film stops at the rim of every functional opening and at every trim, seal, hinge line and ventilation grille. Panel seams stay visible.",
    exclus:
      "product window glass and the products behind it, screens and their content, keypads, buttons, coin slot, bill acceptor, card/contactless reader, delivery flap, dispensing nozzle and cup area, locks, handles, price labels, regulatory and safety stickers, serial plates, QR codes, brand logos and printed branding (kept intact and legible: the film passes around them), ventilation grilles, feet, cables, the wall and floor around.",
    pose: "each panel is wrapped separately up to its edges, like vehicle wrapping on flat panels: the decor restarts at each panel seam. Backlit areas stay backlit with the same brightness.",
    sens: "vertical",
    famillePose: "meuble",
    controle: "every button, slot, reader, screen, window and sticker is present, same place, same size, readable. The products inside are unchanged. Only opaque body panels changed.",
  },
  {
    id: "rangements-pro",
    libelle: "Rangements",
    description: "Portes de placards, armoires et meubles bas du local",
    nom: "OFFICE / SHOP STORAGE FRONTS",
    nomCourt: "storage fronts",
    cible: "the front face of every door and drawer of the storage cabinets, cupboards and low units visible in Image 1, and their visible end panels.",
    limites: "the film stops at the outline of each front; gaps between fronts stay as they are.",
    exclus: "handles, locks, label holders and their labels, binders and objects on open shelves, screens, printers, plants, chairs, the walls and the floor.",
    pose: "each front is wrapped separately; the decor restarts on every front.",
    sens: "vertical",
    famillePose: "facades",
    controle: "same number of doors and drawers, same handles and locks. Nothing on the shelves has moved.",
  },
  {
    id: "habillage-mural",
    libelle: "Habillage mural",
    description: "Un mur ou un panneau décoratif du local",
    nom: "WALL CLADDING (one feature wall or panel)",
    nomCourt: "wall cladding",
    cible: "the single wall or wall panel that is the most prominent flat wall surface of Image 1, over its full visible extent.",
    limites: "the film stops at the corners with adjacent walls, at the ceiling line, at the top of the skirting board, and around door and window frames. Adjacent walls keep their exact original colour — do not harmonise them.",
    exclus: "signs, logos, lettering, frames, screens, shelves and their content, sockets, switches, thermostats, radiators, lights, doors, windows, furniture and people in front of the wall (the film passes behind them).",
    pose: "large continuous vertical lengths of film, seams invisible. The light gradient across the wall, the shadows of objects and the glow of wall lights stay exactly as in Image 1.",
    sens: "vertical",
    famillePose: "murs",
    controle: "only one wall changed. Everything hanging on it or standing before it is superimposable on Image 1.",
  },

  /* ───────────── Murs et plafond ───────────── */
  {
    id: "mur-principal",
    libelle: "Mur principal",
    description: "Le mur le plus large ou le plus visible",
    nom: "MAIN WALL (the widest, most visible wall)",
    nomCourt: "main wall",
    cible: "the widest wall facing the camera in Image 1, over its full visible extent.",
    limites: "the film stops at the corners with adjacent walls, at the ceiling line or cornice, at the top of the skirting board, and around door and window frames. The other walls keep their exact original colour — do not harmonise them.",
    exclus: "frames, artwork, mirrors, shelves and their content, sockets, switches, thermostats, radiators, wall lights, curtains, doors, windows, skirting boards, cornices, furniture and people in front of the wall (the film passes behind them).",
    pose: "large continuous vertical lengths of film, seams invisible. The light gradient across the wall and the cast shadows of furniture and objects stay exactly as in Image 1.",
    sens: "vertical",
    famillePose: "murs",
    controle: "only this wall changed. Everything hanging on it or standing before it is superimposable on Image 1.",
  },
  {
    id: "mur-accent",
    libelle: "Second mur",
    description: "Un autre mur ou un pan décoratif (niche, tête de lit, retour)",
    nom: "SECOND WALL / ACCENT SECTION (a secondary wall, recess or wall section)",
    nomCourt: "accent wall",
    cible: "the second most visible wall of Image 1, or the clearly delimited wall section (recess, chimney breast, wall behind the bed or sofa) if there is one.",
    limites: "same limits as any wall: corners, ceiling line, top of skirting, door and window frames. It never merges with the main wall: the corner between them stays a clean vertical line.",
    exclus: "frames, shelves, sockets, switches, radiators, lights, curtains, doors, windows, skirting boards, furniture and objects in front of it.",
    pose: "large continuous vertical lengths of film, seams invisible; light gradient and shadows unchanged.",
    sens: "vertical",
    famillePose: "murs",
    controle: "the section has clean, straight limits and nothing on it or before it has changed.",
  },
  {
    id: "plafond",
    libelle: "Plafond",
    description: "La surface du plafond",
    nom: "CEILING",
    nomCourt: "ceiling",
    cible: "the flat visible ceiling surface of Image 1.",
    limites: "the film stops at the junction with the walls or at the cornice; cornices, beams and mouldings keep their original colour unless they are flat parts of the ceiling plane.",
    exclus: "ceiling lights, spots, pendants and their canopies, fans, smoke detectors, vents, curtain tracks, and the light halos they cast (same place, same intensity).",
    pose: "continuous lengths of film running along the longest dimension of the room, seams invisible.",
    sens: "longueur",
    famillePose: "murs",
    controle: "every fitting on the ceiling is present and unchanged. The walls did not change.",
  },
];

export const ZONES_SIMULATEUR: Readonly<Record<IdZone, Zone>> = Object.fromEntries(LISTE.map((z) => [z.id, z])) as Record<IdZone, Zone>;

export const PIECES: readonly Piece[] = [
  {
    id: "cuisine",
    libelle: "Cuisine",
    titre: "Votre cuisine",
    code: "CUISINE",
    nomEn: "a kitchen",
    titreEn: "KITCHEN",
    phraseGenerique: "Image 1 shows a real, lived-in kitchen photographed with a phone: fitted cabinets, a worktop, appliances and everyday objects, in its own daylight or artificial light.",
    zones: ["facades-cuisine", "meubles-hauts", "meubles-bas", "plan-de-travail", "credence"],
  },
  {
    id: "salle-de-bain",
    libelle: "Salle de bain",
    titre: "Votre salle de bain",
    code: "SDB",
    nomEn: "a bathroom",
    titreEn: "BATHROOM",
    phraseGenerique: "Image 1 shows a real bathroom photographed with a phone: a vanity unit and basin, tiled or painted walls, taps, a mirror, towels and toiletries, in its own light.",
    zones: ["meuble-vasque", "plan-vasque", "carrelage-mural", "tablier-baignoire"],
  },
  {
    id: "meubles",
    libelle: "Meubles",
    titre: "Vos meubles",
    code: "MEUBLES",
    nomEn: "a piece of furniture in a room",
    titreEn: "FURNITURE",
    phraseGenerique: "Image 1 shows a real piece of furniture (wardrobe doors, a TV unit, a chest of drawers or similar) in a lived-in room, photographed with a phone, with the objects placed on or around it.",
    zones: ["portes-dressing", "meuble-tv", "meuble-complet"],
  },
  {
    id: "mur-plafond",
    libelle: "Murs, plafond",
    titre: "Vos murs",
    code: "MURS",
    nomEn: "an interior room (walls and ceiling)",
    titreEn: "ROOM",
    phraseGenerique: "Image 1 shows a real interior room photographed with a phone: walls and ceiling with their trim, doors, windows, lights and the furniture in front of them.",
    zones: ["mur-principal", "mur-accent", "plafond"],
  },
  {
    id: "professionnel",
    libelle: "Local professionnel",
    titre: "Votre espace pro",
    code: "PRO",
    nomEn: "a professional space (shop, bar, reception or office)",
    titreEn: "SPACE",
    phraseGenerique: "Image 1 shows a real professional space photographed with a phone: a counter, commercial furniture, storage or a feature wall, with signage, equipment and people possibly present.",
    zones: ["comptoir-habillage", "comptoir-plateau", "mobilier-pro", "rangements-pro", "habillage-mural"],
  },
];

export function estIdZone(id: string): id is IdZone {
  return id in ZONES_SIMULATEUR;
}

export function estIdPiece(id: string): id is IdPiece {
  return PIECES.some((p) => p.id === id);
}

export function piece(id: IdPiece): Piece {
  return PIECES.find((p) => p.id === id)!;
}

/** La pièce depuis son code d'espace (CUISINE, SDB…), cuisine à défaut. */
export function pieceDuCode(code: string | null | undefined): Piece {
  return PIECES.find((p) => p.code === code) ?? PIECES[0];
}

export function estZoneElementaire(id: string): id is IdZoneElementaire {
  return estIdZone(id) && !ZONES_SIMULATEUR[id].compose;
}

/** Les zones élémentaires d'une pièce (sans les zones composées) : celles que l'analyse de la photo décrit. */
export function zonesElementaires(pieceId: IdPiece): IdZoneElementaire[] {
  return piece(pieceId).zones.filter(estZoneElementaire);
}

/** Les zones élémentaires que recouvre une zone (elle-même si elle n'est pas composée). */
export function zonesCouvertes(id: IdZone): IdZoneElementaire[] {
  const zone = ZONES_SIMULATEUR[id];
  return zone.compose ?? [id as IdZoneElementaire];
}

/** Ce que le site et l'espace lisent : pièces, zones, libellés et limites — jamais la consigne (elle reste au CRM). */
export type ZonesPubliques = {
  version: 1;
  zonesMax: number;
  pieces: { id: IdPiece; libelle: string; titre: string; code: Piece["code"]; zones: { id: IdZone; libelle: string; description: string; exclut: IdZone[]; compose: IdZone[] }[] }[];
};

export function zonesPubliques(): ZonesPubliques {
  return {
    version: 1,
    zonesMax: ZONES_MAX,
    pieces: PIECES.map((p) => ({
      id: p.id,
      libelle: p.libelle,
      titre: p.titre,
      code: p.code,
      zones: p.zones.map((id) => {
        const z = ZONES_SIMULATEUR[id];
        return { id, libelle: z.libelle, description: z.description, exclut: z.exclut ?? [], compose: z.compose ?? [] };
      }),
    })),
  };
}
