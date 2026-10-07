// Mission 24 — les variantes essayées : chacune change UNE chose au pipeline (formulation du prompt, mots sur la finition,
// description de la teinte, masque) ; elles se cumulent par « + » (`--variante c1+c2`), dans l'ordre écrit.
// « base » = le pipeline tel quel (prompt V2 du moteur, planche étiquetée, masque dessiné).
import { BLOCS, type NomBloc, type ReferenceMoteur } from "../../src/lib/simulateur/moteur/types";
import type { Reference } from "../../src/lib/simulateur/catalogue";
import type { IdZone } from "../../src/lib/simulateur/zones";
import { masqueTroue, type DefMasque } from "./masques";

export type Contexte = { prompt: string; blocs: Record<NomBloc, string>; reference: ReferenceMoteur; ref: Reference; zone: IdZone; photo: string; masque: DefMasque; planche: Buffer };
export type Appliquee = { prompt: string; planche: Buffer; masque?: Buffer };
type Etat = { blocs: Record<NomBloc, string>; planche: Buffer; masque?: Buffer };
type Etape = { description: string; changer: (e: Etat, c: Contexte) => Etat | Promise<Etat> };

const remplacer = (texte: string, avant: string | RegExp, apres: string): string => {
  const nouveau = texte.replace(avant, apres);
  if (nouveau === texte) throw new Error(`Variante : passage introuvable (${String(avant).slice(0, 60)}).`);
  return nouveau;
};

/** Les familles de teintes de la mission (références difficiles du catalogue). */
export const FAMILLES: Record<string, string[]> = {
  beiges: ["K4", "NE55", "M7"],
  blancs: ["J4", "N3", "J3"],
  bois: ["AA17", "AA14", "AA05"],
  sombres: ["K1", "M9", "NF13"],
  complexes: ["RM30", "RM21", "NE24"],
};
export const familleDe = (ref: string) => Object.entries(FAMILLES).find(([, refs]) => refs.includes(ref))?.[0] ?? null;

/**
 * Étape « t1 » — la description de teinte corrigée par famille : la phrase va contre la dérive mesurée en exploration
 * (beiges plus gris et plus froids, blancs bleutés, bois refroidis, sombres tirés vers le rouge et éclaircis,
 * teintes sourdes assombries ou brunies).
 */
export const MOTS_TEINTE: Record<string, string> = {
  beiges: "a WARM beige: its yellow-brown warmth and its saturation are exactly those of the sample — it must not turn grey, taupe, mushroom or cool under the room light",
  blancs: "a clean white exactly as light as the sample, with its own very slight warmth — never grey, never bluish, never cream or yellow",
  bois: "the warm brown of the sample with its honey / amber undertone and the light-dark contrast between its grain lines — never greyed, never cooled, never darkened",
  sombres: "deep and dark exactly as the sample, its hue kept pure (navy stays blue, bottle green stays green, black stays neutral) — no reddish or brownish shift, not lifted towards grey",
  complexes: "a muted, dusty colour: keep both its lightness and its exact grey-green balance — not darker, not more saturated, not shifted towards brown or yellow",
};

export const ETAPES: Record<string, Etape> = {
  base: { description: "pipeline tel quel", changer: (e) => e },

  // C1 — D2 (pièce rééclairée) : le prompt demandait une photo « de professionnel », une exposition équilibrée et
  // autorisait les retouches globales. Remplacé par : la lumière et l'exposition de la photo sont gardées telles quelles.
  c1: {
    description: "lumière : garder l'exposition, la balance et le contre-jour de la photo (plus de « photo de professionnel » ni de retouche globale)",
    changer: (e) => ({
      ...e,
      blocs: {
        ...e.blocs,
        ROLE: remplacer(e.blocs.ROLE, /The client must recognise the room instantly and see it as a finished job photographed by a professional\./, "The client must recognise the room instantly: it is the same phone photo, taken the same moment, with only the covered surfaces changed."),
        QUALITE_PHOTO: [
          "LIGHT AND EXPOSURE OF THE PHOTO",
          "- Keep the photo exactly as it was taken: same exposure, same brightness, same contrast, same white balance, same haze, glare, backlight and dark corners, same noise and sharpness.",
          "- Do not brighten a dark or backlit photo, do not recover a burnt window, do not 'fix' or beautify the picture: this is not a retouch, only the covered surfaces change.",
          "- The new film receives exactly the light that fell on the old surface at that place in Image 1 (a front in shadow stays in shadow, a backlit front stays backlit).",
        ].join("\n"),
      },
    }),
  },

  // C2 — D1 (façades redessinées) : « one clean, monolithic surface » poussait aux portes lisses sans poignées.
  // Remplacé par une règle de re-pelliculage : contours, cadres, moulures, poignées et nombre de façades gardés.
  c2: {
    description: "façades : re-pelliculage strict (cadres, moulures, poignées, nombre de portes et tiroirs gardés ; plus de « monolithic surface »)",
    changer: (e) => ({
      ...e,
      blocs: {
        ...e.blocs,
        ART_DIRECTION: remplacer(e.blocs.ART_DIRECTION, /as one clean, monolithic surface, with no competing accent\./, "— the same doors and drawers as in Image 1, simply wearing a new skin."),
        AFFECTATION: `${e.blocs.AFFECTATION}\nRE-SKIN, NOT A NEW KITCHEN: every existing door and drawer front keeps its exact outline, its frame, shaker moulding, raised or recessed panel, grooves and bevels — the film follows them, they stay visible. Every handle, knob, bar and finger-pull stays exactly where it is, same model, same metal or colour; the film passes UNDER the handles. Never turn a framed, moulded or handled front into a flat handleless slab; never merge, split, add or remove a front; drawers stay drawers, doors stay doors.`,
      },
    }),
  },
};

ETAPES.t1 = {
  description: "teinte : phrase de couleur corrigée par famille (contre la dérive mesurée en exploration)",
  changer: (e, c) => {
    const famille = familleDe(c.ref.id);
    if (!famille) throw new Error(`t1 : ${c.ref.id} hors des familles de la mission.`);
    const ligne = new RegExp(`(- Sample A — ${c.ref.id} [^\n]*)`);
    return { ...e, blocs: { ...e.blocs, REALISME: remplacer(e.blocs.REALISME, ligne, `$1 Colour check: ${MOTS_TEINTE[famille]}.`) } };
  },
};

ETAPES.c3 = {
  description: "masque : troué sur les détails de la photo (poignées, boutons, joints, rainures restent hors du repeint)",
  changer: async (e, c) => ({ ...e, masque: (await masqueTroue(c.photo, c.masque)).png }),
};

export type Variante = { description: string; appliquer: (c: Contexte) => Promise<Appliquee> };

/** « c1+c2 » → les étapes dans l'ordre, puis les blocs remis bout à bout. */
export function variante(nom: string): Variante {
  const etapes = nom.split("+").map((n) => {
    const e = ETAPES[n];
    if (!e) throw new Error(`Variante inconnue : ${n} (${Object.keys(ETAPES).join(", ")})`);
    return e;
  });
  return {
    description: etapes.map((e) => e.description).join(" + "),
    appliquer: async (c) => {
      let etat: Etat = { blocs: c.blocs, planche: c.planche };
      for (const e of etapes) etat = await e.changer(etat, c);
      return { prompt: BLOCS.map((b) => etat.blocs[b]).join("\n\n"), planche: etat.planche, masque: etat.masque };
    },
  };
}
