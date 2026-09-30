import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BLOCS, construirePrompt, contientEmoji, directionArtistique, etiquettesPour, filmsDistincts, type AnalysePhoto, type ReferenceMoteur, type ZoneMoteur } from "./index";
import { PHRASE_GENERIQUE, regleAccent, regleBoisEtMineral, regleDeuxBois, regleMonolithique, regleProfessionnel, regleRetours, regleSalleDeBain, regleUniHautsBoisBas } from "./direction-artistique";
import { couleurDepuisHex, couleurEnPhrase, decrireFilm, essenceProbable, poseDeZone, profilDe } from "./materiaux";
import { lireAnalyse, zoneVisible, zonesNonVisibles } from "./analyse-photo";
import { lireControle } from "./controle-rendu";
import { construirePromptV1, texteV1 } from "./v1";
import { promptsParDefautGeneres } from "./generer-prompts";
import { ZONES_SIMULATEUR, zonesElementaires, zonesPubliques } from "../zones";
import { PROMPTS_PAR_DEFAUT } from "../prompts-defaut";
import { rendrePrompt, verifierModele } from "../rendu";
import { TYPES_SURFACE } from "../types-surface";

/**
 * Mission 15 (partie 2) — le moteur de prompt, fonctions pures : une sélection
 * donnée → un prompt donné (instantané figé sur trois cas), les douze blocs dans
 * l'ordre, chaque règle de direction artistique, les profils et la pose, le
 * « V1 revu » (structure du site, vocabulaire V1), la bibliothèque générée à
 * jour. Aucun réseau, aucune base.
 */

const ref = (r: Partial<ReferenceMoteur> & { ref: string; nom: string; famille: string }): ReferenceMoteur => ({ categorie: "", finition: "Soft", tags: [], ...r });
const CREAMY = ref({ ref: "AB02", nom: "Creamy", famille: "couleur", hex: "#EDE6D6" });
const WALNUT = ref({ ref: "D1", nom: "Classic Walnut", famille: "bois", hex: "#6B4A32", couleur: { hex: "#6B4A32", clarte: 34, chroma: 22, teinte: 55, contraste: 9 } });
const TRAVERTIN = ref({ ref: "MK15", nom: "Raw Travertine", famille: "pierre", hex: "#C9BBA6" });
const OAK = ref({ ref: "AA01", nom: "Beige Oak", famille: "bois", hex: "#B49063", tags: ["chêne"] });
const GLITTER = ref({ ref: "GL01", nom: "Silver Glitter", famille: "paillettes" });
const EBONY = ref({ ref: "CT68", nom: "Brown Ebony", famille: "bois", hex: "#3E2A1E" });

const zones = (liste: [ZoneMoteur["zone"], ReferenceMoteur][]): ZoneMoteur[] => etiquettesPour(liste.map(([zone, reference]) => ({ zone, reference })));

const ANALYSE_CUISINE: AnalysePhoto = {
  description: "A narrow galley kitchen seen from the doorway: black matt fronts on both sides, a walnut-look worktop, a stainless hood and a window at the far end.",
  zones_visibles: { "meubles-hauts": { visible: true, description: "black upper units on the left" }, "meubles-bas": { visible: true, description: "black base units under the worktop" }, "plan-de-travail": { visible: true, description: "walnut-look worktop" }, credence: { visible: false, description: "" } },
  objets: ["a kettle", "a fruit bowl", "the stainless hood", "a dish rack"],
  lumiere: { source: "daylight from the far window", direction: "from behind the units", temperature: "neutral", dominante: "none" },
  format: "paysage",
  qualite_photo: { verdict: "bonne", conseil: "" },
};

describe("construirePrompt : trois instantanés figés", () => {
  test("cuisine, bois sur les façades et pierre sur le plan, paysage, planche : les douze blocs dans l'ordre, sans emoji", () => {
    const p = construirePrompt({ piece: "cuisine", zones: zones([["meubles-hauts", CREAMY], ["meubles-bas", WALNUT], ["plan-de-travail", TRAVERTIN]]), analyse: ANALYSE_CUISINE, format: "paysage", mode: "api-planche" });
    assert.equal(p.version, "v2");
    assert.equal(contientEmoji(p.texte), false);
    // Les douze titres, dans l'ordre imposé.
    const titres = ["ROLE", "IMAGES", "ART DIRECTION", "HOW THE JOB IS DONE IN REAL LIFE", "THE KITCHEN IN IMAGE 1", "MATERIAL ASSIGNMENT", "MATERIAL REALISM", "PHOTOGRAPHIC QUALITY", "LOCKED", "AVOID", "FINAL CHECK", "OUTPUT"];
    let position = -1;
    for (const t of titres) {
      const i = p.texte.indexOf(`${t}\n`);
      assert.ok(i > position, `bloc ${t} présent et à sa place`);
      position = i;
    }
    assert.deepEqual(Object.keys(p.blocs), [...BLOCS]);
    // Instantané des passages clés.
    assert.match(p.blocs.ROLE, /senior architectural visualisation artist and interior photographer/);
    assert.match(p.blocs.ROLE, /The client must recognise the room instantly and see it as a finished job photographed by a professional/);
    assert.match(p.blocs.IMAGES, /Image 2 is the labelled sample board: a light grey sheet with 3 square samples/);
    assert.match(p.blocs.IMAGES, /recognise them by content/);
    assert.equal(p.blocs.ART_DIRECTION, `ART DIRECTION\n${p.directionArtistique}`);
    assert.match(p.directionArtistique, /Warm timber cabinetry \(D1 "Classic Walnut"\) under a mineral top \(MK15 "Raw Travertine"\): the worktop is the visual anchor/);
    assert.match(p.directionArtistique, /Light upper units \(AB02 "Creamy"\) keep the room airy; the wood bases \(D1 "Classic Walnut"\) bring warmth/);
    assert.match(p.blocs.METHODE, /it wraps around every visible edge, so no old material remains visible on a covered surface/);
    assert.match(p.blocs.PIECE, /^THE KITCHEN IN IMAGE 1\nA narrow galley kitchen/);
    assert.match(p.blocs.PIECE, /Light: daylight from the far window, from behind the units, neutral, none\./);
    assert.match(p.blocs.AFFECTATION, /- Sample A \(AB02 — Creamy\) goes on the wall units \(upper cabinets\)\. Covers: the front face of every door and flap/);
    assert.match(p.blocs.AFFECTATION, /- Sample B \(D1 — Classic Walnut\) goes on the base units, tall units and island fronts/);
    assert.match(p.blocs.AFFECTATION, /- Sample C \(MK15 — Raw Travertine\) goes on the worktop\./);
    assert.match(p.blocs.AFFECTATION, /Laid: the decor runs along the length of the top and continues over the front edge and the returns, matched at the fold as if one slab had been cut and mitred/);
    assert.match(p.blocs.AFFECTATION, /NOT COVERED: a kettle, a fruit bowl, the stainless hood, a dish rack — they keep their exact material/, "les objets vus ; la crédence non visible n'y est pas");
    assert.doesNotMatch(p.blocs.AFFECTATION, /NOT COVERED:.*backsplash/);
    assert.match(p.blocs.AFFECTATION, /NOT USED IN THIS IMAGE: none/);
    assert.match(p.blocs.REALISME, /- Sample B — D1 "Classic Walnut": walnut-look decor with a clearly visible, medium-contrast grain/);
    assert.match(p.blocs.REALISME, /base tone dark brown \(about #6B4A32\), clearly visible, medium contrast decor/);
    assert.match(p.blocs.REALISME, /- Sample C — MK15 "Raw Travertine": natural-stone decor/);
    assert.match(p.blocs.REALISME, /laid taut and flat: no bubbles/);
    assert.match(p.blocs.QUALITE_PHOTO, /only global photo adjustments are allowed \(white balance, exposure, clarity\); nothing outside the covered surfaces is retouched locally/i);
    assert.match(p.blocs.LOCKED, /including a kettle, a fruit bowl, the stainless hood, a dish rack/);
    assert.match(p.blocs.AVOID, /orange or warm colour cast/);
    assert.match(p.blocs.FINAL_CHECK, /Each zone wears ITS OWN film exactly as assigned/);
    assert.match(p.blocs.FINAL_CHECK, /The image looks like a real, professionally photographed room, never like a render or a collage/);
    assert.match(p.blocs.OUTPUT, /^OUTPUT\nOne image, same format as Image 1 \(1536×1024 landscape\)/);
    assert.match(p.blocs.OUTPUT, /Generate it directly\.$/);
    assert.ok(p.texte.length > 4000 && p.texte.length < 12_000, `longueur raisonnable (${p.texte.length})`);
  });

  test("salle de bain, un seul film, portrait, échantillons bruts : monolithique, spa, Image 2 citée", () => {
    const p = construirePrompt({ piece: "salle-de-bain", zones: zones([["meuble-vasque", EBONY]]), format: "portrait", mode: "api-swatches" });
    assert.match(p.blocs.IMAGES, /Image 2 is a flat, front-lit sample of Cover Styl'/);
    assert.match(p.blocs.AFFECTATION, /- Image 2 \(CT68 — Brown Ebony\) goes on the vanity cabinet fronts/);
    assert.match(p.blocs.REALISME, /- Image 2 — CT68 "Brown Ebony": ebony-look decor/);
    assert.match(p.directionArtistique, /^A single material: vanity cabinet fronts wear CT68 "Brown Ebony" as one clean, monolithic surface/);
    assert.match(p.directionArtistique, /Spa-like mood: matt and quiet/);
    assert.match(p.blocs.PIECE, /^THE BATHROOM IN IMAGE 1\nImage 1 shows a real bathroom/, "sans analyse : la phrase générique");
    assert.match(p.blocs.AFFECTATION, /NOT COVERED: the vanity top, the tiled walls, the bathtub side panel — they keep/, "sans analyse, toutes les zones non choisies sont réputées visibles");
    assert.match(p.blocs.OUTPUT, /1024×1536 portrait/);
    assert.equal(contientEmoji(p.texte), false);
  });

  test("professionnel, comptoir façade + plateau avec le même film : « Samples A and B », comptoir = première impression, retours", () => {
    const p = construirePrompt({ piece: "professionnel", zones: zones([["comptoir-habillage", WALNUT], ["comptoir-plateau", WALNUT]]), format: "carre", mode: "chatgpt" });
    assert.match(p.blocs.IMAGES, /2 square samples/);
    assert.match(p.blocs.AFFECTATION, /- Sample A \(D1 — Classic Walnut\) goes on the bar front cladding/);
    assert.match(p.blocs.AFFECTATION, /- Sample B \(D1 — Classic Walnut\) goes on the bar top/);
    assert.match(p.blocs.REALISME, /- Samples A and B — D1 "Classic Walnut"/, "un même film décrit une fois");
    assert.match(p.directionArtistique, /One material, one gesture: bar front cladding, bar top all wear D1 "Classic Walnut"/);
    assert.match(p.directionArtistique, /The counter is the brand's first impression/);
    assert.match(p.directionArtistique, /On the bar top the decor runs continuous over the front edge and the returns/);
    assert.match(p.blocs.OUTPUT, /1024×1024 square/);
    assert.match(p.blocs.OUTPUT, /without asking any question/);
  });

  test("défauts de la tentative précédente rappelés dans FINAL CHECK ; zone inconnue ou cinq zones refusées", () => {
    const p = construirePrompt({ piece: "cuisine", zones: zones([["credence", CREAMY]]), format: "paysage", mode: "api-planche", defautsPrecedents: ["the kettle disappeared from the worktop.", "the island fronts took the backsplash film"] });
    assert.match(p.blocs.FINAL_CHECK, /In the previous attempt, the kettle disappeared from the worktop: do not repeat it/);
    assert.match(p.blocs.FINAL_CHECK, /In the previous attempt, the island fronts took the backsplash film: do not repeat it/);
    assert.throws(() => construirePrompt({ piece: "cuisine", zones: [{ zone: "porte-de-garage" as never, etiquette: "A", reference: CREAMY }], format: "paysage", mode: "api-planche" }), /Zone inconnue/);
    assert.throws(() => construirePrompt({ piece: "cuisine", zones: [], format: "paysage", mode: "api-planche" }), /au moins une zone/);
    // Cinq zones : refusées, jamais tronquées en silence (la cinquième serait ni dans le prompt ni sur la planche).
    assert.throws(() => etiquettesPour([{ zone: "facades-cuisine" }, { zone: "meubles-hauts" }, { zone: "meubles-bas" }, { zone: "plan-de-travail" }, { zone: "credence" }]), /Au plus 4 zones par rendu \(5 demandées\)/);
    assert.equal(etiquettesPour([{ zone: "credence" }]).length, 1);
  });
});

describe("direction artistique : chaque règle", () => {
  const lire = (liste: [ZoneMoteur["zone"], ReferenceMoteur][]) => zones(liste).map((z) => ({ zone: z.zone, ref: z.reference.ref, nom: z.reference.nom, profil: profilDe(z.reference), clarte: z.reference.couleur?.clarte ?? (z.reference.hex ? couleurDepuisHex(z.reference.hex)!.clarte : null) }));
  test("un seul film → monolithique", () => {
    assert.match(regleMonolithique(lire([["meubles-hauts", CREAMY], ["meubles-bas", CREAMY]]))!, /single monolithic volume/);
    assert.equal(regleMonolithique(lire([["meubles-hauts", CREAMY], ["meubles-bas", WALNUT]])), null);
  });
  test("bois façades + pierre ou béton plan → le plan est l'ancre", () => {
    assert.match(regleBoisEtMineral(lire([["meubles-bas", WALNUT], ["plan-de-travail", TRAVERTIN]]))!, /the worktop is the visual anchor/);
    assert.equal(regleBoisEtMineral(lire([["meubles-bas", CREAMY], ["plan-de-travail", TRAVERTIN]])), null);
  });
  test("deux bois → sens du fil, contraste, le plus sombre ancre", () => {
    const phrase = regleDeuxBois(lire([["meubles-hauts", OAK], ["meubles-bas", WALNUT]]))!;
    assert.match(phrase, /Two woods/);
    assert.match(phrase, /the darker wood \(D1 "Classic Walnut"\) grounds the composition/);
    assert.equal(regleDeuxBois(lire([["meubles-hauts", WALNUT], ["meubles-bas", WALNUT]])), null, "le même bois deux fois n'est pas « deux bois »");
  });
  test("uni hauts + bois bas → haut aérien, bas chaleureux", () => {
    assert.match(regleUniHautsBoisBas(lire([["meubles-hauts", CREAMY], ["meubles-bas", WALNUT]]))!, /Light upper units .* keep the room airy; the wood bases .* bring warmth/);
    assert.equal(regleUniHautsBoisBas(lire([["meubles-hauts", WALNUT], ["meubles-bas", CREAMY]])), null);
  });
  test("paillettes ou métal → accent qui prend la lumière", () => {
    assert.match(regleAccent(lire([["credence", GLITTER], ["meubles-bas", CREAMY]]))!, /backsplash in GL01 "Silver Glitter" is the accent that catches the light; base units, tall units and island fronts stay quiet/);
    assert.equal(regleAccent(lire([["credence", CREAMY]])), null);
  });
  test("salle de bain → spa ; professionnel → comptoir ; îlot ou plan → retours", () => {
    assert.match(regleSalleDeBain("salle-de-bain")!, /Spa-like mood/);
    assert.equal(regleSalleDeBain("cuisine"), null);
    assert.match(regleProfessionnel("professionnel")!, /hospitality-grade finish/);
    assert.equal(regleProfessionnel("meubles"), null);
    assert.match(regleRetours(lire([["plan-vasque", TRAVERTIN]]))!, /as if one slab had been cut and mitred/);
    assert.equal(regleRetours(lire([["meubles-hauts", CREAMY]])), null);
  });
  test("aucune règle → la phrase générique ; jamais plus de trois phrases", () => {
    assert.equal(directionArtistique("meubles", zones([["portes-dressing", OAK], ["meuble-tv", CREAMY]])), PHRASE_GENERIQUE);
    const longue = directionArtistique("cuisine", zones([["meubles-hauts", CREAMY], ["meubles-bas", WALNUT], ["plan-de-travail", TRAVERTIN], ["credence", GLITTER]]));
    assert.ok((longue.match(/\. /g) ?? []).length <= 2, longue);
  });
});

describe("matériaux : profils, couleur, pose", () => {
  test("les seize profils d'après la famille et le nom", () => {
    const profil = (nom: string, famille: string, tags: string[] = []) => profilDe({ nom, famille, categorie: "", tags });
    assert.equal(profil("Ultra White", "couleur"), "uni-mat");
    assert.equal(profil("Black Gloss", "couleur"), "uni-brillant");
    assert.equal(profil("Grey Stripes", "couleur"), "uni-raye");
    assert.equal(profil("Beige Oak", "bois"), "bois");
    assert.equal(profil("Painted Blue", "bois"), "bois-peint");
    assert.equal(profil("Statuary White", "pierre"), "marbre");
    assert.equal(profil("Raw Travertine", "pierre"), "pierre");
    assert.equal(profil("Terrazzo Mix", "pierre"), "terrazzo");
    assert.equal(profil("Raw Grey", "beton"), "beton");
    assert.equal(profil("Red Brick", "beton"), "brique");
    assert.equal(profil("Brushed Silver", "metal"), "metal-brosse");
    assert.equal(profil("Chrome Glow", "metal"), "metal-poli");
    assert.equal(profil("Corten Patina", "metal"), "metal-patine");
    assert.equal(profil("Natural Leather", "textile"), "cuir");
    assert.equal(profil("Linen Weave", "textile"), "tissu");
    assert.equal(profil("Silver Glitter", "paillettes"), "paillettes");
  });
  test("couleur mesurée en phrase : depuis le hex du catalogue ou la mesure du CRM", () => {
    assert.equal(couleurEnPhrase(CREAMY, "uni-mat"), "very light warm off-white / greige (about #EDE6D6)");
    assert.equal(couleurEnPhrase(WALNUT, "bois"), "dark brown (about #6B4A32), clearly visible, medium contrast decor");
    assert.equal(couleurEnPhrase(GLITTER, "paillettes"), null);
    assert.equal(couleurDepuisHex("zz"), null);
    assert.equal(couleurDepuisHex("#FFFFFF")!.clarte, 100);
  });
  test("essence probable, film décrit, pose selon la zone", () => {
    assert.equal(essenceProbable("Classic Walnut"), "walnut");
    assert.equal(essenceProbable("Orangey Wenge"), "wenge");
    assert.equal(essenceProbable("Creamy"), null);
    assert.match(decrireFilm(OAK, "meubles-hauts"), /^AA01 "Beige Oak": oak-look decor with .* running vertically \(bottom to top\) on this surface/);
    assert.match(decrireFilm(TRAVERTIN, "plan-de-travail"), /running along the length of this surface/);
    assert.match(decrireFilm(GLITTER, "credence"), /glitter film densely covered/);
    assert.match(poseDeZone("meubles-hauts"), /restarts on every door and drawer front/);
    assert.match(poseDeZone("plan-de-travail"), /mitred/);
    assert.match(poseDeZone("credence"), /grout lines disappear/);
    assert.match(poseDeZone("mur-principal"), /large continuous vertical lengths/);
    assert.match(poseDeZone("comptoir-habillage"), /curved front/);
    assert.match(poseDeZone("meubles-bas"), /island fronts, back panel and end panels/);
  });
});

describe("zones : source unique", () => {
  test("chaque pièce, ses zones ; la zone composée se déplie ; ce que le site lit ne porte pas la consigne", () => {
    assert.deepEqual(zonesElementaires("cuisine"), ["meubles-hauts", "meubles-bas", "plan-de-travail", "credence"]);
    assert.deepEqual(ZONES_SIMULATEUR["facades-cuisine"].compose, ["meubles-hauts", "meubles-bas"]);
    const pub = zonesPubliques();
    assert.equal(pub.zonesMax, 4);
    assert.deepEqual(pub.pieces.map((p) => p.id), ["cuisine", "salle-de-bain", "meubles", "mur-plafond", "professionnel"]);
    assert.ok(pub.pieces.find((p) => p.id === "salle-de-bain")!.zones.some((z) => z.id === "tablier-baignoire"));
    assert.ok(pub.pieces.find((p) => p.id === "mur-plafond")!.zones.some((z) => z.id === "plafond"));
    assert.equal("cible" in pub.pieces[0].zones[0], false);
    for (const z of Object.values(ZONES_SIMULATEUR)) assert.equal(contientEmoji(`${z.cible} ${z.limites} ${z.exclus} ${z.pose} ${z.controle}`), false, z.id);
  });
});

describe("analyse et contrôle : lecture des sorties JSON", () => {
  test("analyse : zones visibles, objets bornés, verdict inconnu ramené à « bonne », format mesuré prioritaire", () => {
    const lu = lireAnalyse({ description: "A kitchen.", zones_visibles: { "meubles-hauts": { visible: true, description: "left" }, credence: { visible: false, description: "" } }, objets: ["a kettle", "", 3], lumiere: { source: "window" }, format: "portrait", qualite_photo: { verdict: "bizarre", conseil: "Reculez." } }, ["meubles-hauts", "credence"], "paysage")!;
    assert.deepEqual(lu.objets, ["a kettle"]);
    assert.equal(lu.format, "paysage");
    assert.equal(lu.qualite_photo.verdict, "bonne");
    assert.equal(zoneVisible(lu, "meubles-hauts"), true);
    assert.equal(zoneVisible(lu, "credence"), false);
    assert.equal(zoneVisible(lu, "facades-cuisine"), true, "composée : visible si l'une de ses zones l'est");
    assert.equal(zoneVisible(lu, "plan-de-travail"), true, "zone inconnue de l'analyse : jamais bloquée");
    assert.deepEqual(zonesNonVisibles(lu, ["credence", "meubles-hauts"]), ["credence"]);
    assert.equal(lireAnalyse({ description: 3 }, ["credence"], null), null);
  });
  test("contrôle : score borné, défauts typés, détail vide écarté", () => {
    const c = lireControle({ score: 12, defauts: [{ type: "objet-disparu", detail: "the kettle" }, { type: "inconnu", detail: "x" }, { type: "autre", detail: "" }] })!;
    assert.equal(c.score, 10);
    assert.deepEqual(c.defauts, [{ type: "objet-disparu", detail: "the kettle" }, { type: "autre", detail: "x" }]);
    assert.equal(lireControle({ score: "abc" }), null);
  });
});

describe("V1 revu : la structure de l'ancien prompt du site, gardée au CRM", () => {
  test("même structure (TASK, TARGET, LOCKED, FORBIDDEN, FINAL CHECK, OUTPUT), vocabulaire V1 partout (« IMAGE 1 », « target »), sans emoji, « an interior room »", () => {
    const zonesV1 = zones([["meubles-hauts", CREAMY], ["meubles-bas", CREAMY], ["plan-de-travail", TRAVERTIN]]);
    const texte = construirePromptV1("cuisine", zonesV1);
    assert.match(texte, /^TASK: TEXTURE REPLACEMENT ON A REAL PHOTOGRAPH\./);
    assert.match(texte, /IMAGE 1 is a real photograph of a kitchen, taken by a client with a phone\. IMAGES 2 to 3 are flat, front-lit sample\(s\)/, "un même film sur deux zones : une seule image jointe");
    assert.match(texte, /TARGET 1 — WALL UNITS \(upper kitchen cabinets\)\nFilm: Cover Styl' ref\. AB02 "Creamy" — flat sample in IMAGE 2\./);
    assert.match(texte, /TARGET 2 — BASE UNITS, TALL UNITS AND ISLAND FRONTS \(lower kitchen cabinets\)\nFilm: Cover Styl' ref\. AB02 "Creamy" — flat sample in IMAGE 2\./);
    assert.match(texte, /TARGET 3 — KITCHEN WORKTOP \(countertop\)\nFilm: Cover Styl' ref\. MK15 "Raw Travertine" — flat sample in IMAGE 3\./);
    assert.match(texte, /Solid colour, matt to soft-satin film\. It has NO pattern/);
    assert.match(texte, /═══ LOCKED — everything that is not a target surface ═══/);
    assert.match(texte, /═══ FORBIDDEN ═══/);
    assert.match(texte, /═══ FINAL CHECK — do this before you output ═══/);
    assert.match(texte, /- Target 3: Every object that stood on the worktop in IMAGE 1 is still there/);
    assert.match(texte, /OUTPUT: one photorealistic image — IMAGE 1 itself, with only the target surfaces wearing their new film\.$/);
    // Les textes des zones viennent de la source unique (vocabulaire V2) : le V1 les dit dans son vocabulaire à lui.
    assert.doesNotMatch(texte, /\bImage 1\b/, "jamais « Image 1 » dans un prompt V1");
    assert.doesNotMatch(texte, /another zone/);
    assert.match(texte, /keep their original material unless they are listed as another target/);
    assert.equal(texteV1("as in Image 1, unless they are another zone."), "as in IMAGE 1, unless they are another target.");
    assert.equal(contientEmoji(texte), false);
    assert.match(construirePromptV1("mur-plafond", zones([["mur-principal", CREAMY]])), /IMAGE 1 is a real photograph of an interior room \(walls and ceiling\)/);
    assert.match(construirePromptV1("salle-de-bain", zones([["meuble-vasque", EBONY]])), /CRITICAL FOR MIRRORS/);
  });
});

describe("bibliothèque ChatGPT générée par le moteur", () => {
  test("prompts-defaut.ts est bien la sortie actuelle du moteur (sinon : npm run simulateur:prompts)", () => {
    assert.deepEqual(PROMPTS_PAR_DEFAUT, promptsParDefautGeneres(), "le fichier généré ne correspond plus au moteur : lancer `npm run simulateur:prompts`");
  });
  test("chaque modèle par défaut passe le contrôle, se rend sans balise ni variable, et porte les blocs du moteur", () => {
    for (const type of TYPES_SURFACE) {
      const modele = PROMPTS_PAR_DEFAUT[type.id].texte;
      assert.deepEqual(verifierModele(modele, type).erreurs, [], type.id);
      const zonesType = type.zones.map((zone, i) => ({ zone, etiquette: `${String.fromCharCode(65 + i)} · ${ZONES_SIMULATEUR[zone].libelle}`, teinte: `TEINTE-${zone}` }));
      const texte = rendrePrompt(modele, { type, zones: zonesType, format: "landscape 3:2", directionArtistique: "DIRECTION-ESSAI" });
      assert.doesNotMatch(texte, /\{\{|\[zone:|\[\/zone\]/, type.id);
      for (const zone of type.zones) assert.match(texte, new RegExp(`TEINTE-${zone}`), `${type.id} / ${zone}`);
      assert.match(texte, /^ROLE\n/, type.id);
      assert.match(texte, /ART DIRECTION\nDIRECTION-ESSAI/, type.id);
      assert.match(texte, /Generate it directly, without asking any question/, type.id);
      assert.equal(contientEmoji(texte), false, type.id);
    }
  });
  test("cuisine, trois zones sur quatre : la zone oubliée passe en NOT COVERED, les lettres suivent", () => {
    const type = TYPES_SURFACE.find((t) => t.id === "cuisine")!;
    const texte = rendrePrompt(PROMPTS_PAR_DEFAUT.cuisine.texte, { type, zones: [{ zone: "meubles-hauts", etiquette: "A · Meubles hauts", teinte: "T-hauts" }, { zone: "meubles-bas", etiquette: "B · Meubles bas", teinte: "T-bas" }, { zone: "plan-de-travail", etiquette: "C · Plan de travail", teinte: "T-plan" }], format: "portrait 2:3" });
    assert.match(texte, /Sample "A · Meubles hauts"/);
    assert.doesNotMatch(texte, /backsplash\) goes on/);
    assert.match(texte, /NOT COVERED: the backsplash\. It keeps its original material/);
    assert.match(texte, /3 in all/);
  });
});

describe("films distincts et étiquettes", () => {
  test("A, B, C, D dans l'ordre ; un même film n'est joint qu'une fois", () => {
    const z = zones([["meubles-hauts", CREAMY], ["meubles-bas", CREAMY], ["plan-de-travail", TRAVERTIN]]);
    assert.deepEqual(z.map((x) => x.etiquette), ["A", "B", "C"]);
    const films = filmsDistincts(z);
    assert.deepEqual(films.map((f) => [f.reference.ref, f.etiquettes, f.image]), [["AB02", ["A", "B"], 2], ["MK15", ["C"], 3]]);
  });
});
