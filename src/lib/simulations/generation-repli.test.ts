import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 21 (E5) — le rendu du simulateur (`genererRendu`) face à un modèle d'édition qui refuse un paramètre
 * facultatif : un 400 qui nomme `input_fidelity` (ou `output_format`, `output_compression`) refait l'appel une fois
 * sans lui ; tout autre 400 n'est pas rejoué ; sans 400, l'appel part tel qu'avant (aucun changement pour gpt-image-1).
 * `modele` et `phase` passés par l'appelant sont notés dans GenerationImage. `fetch` est remplacé : aucun appel réseau.
 */

let prisma: typeof import("@/lib/prisma").default;
let generation: typeof import("@/lib/simulations/generation");
let sharp: typeof import("sharp");
let photo: Buffer;
let rendu: string;

type Appel = { champs: Record<string, string>; images: number };
let appels: Appel[] = [];
let reponses: (() => Response)[] = [];
const fetchOrigine = globalThis.fetch;

const refus = (param: string | null, message: string) => () => new Response(JSON.stringify({ error: { message, type: "invalid_request_error", param, code: param ? "unknown_parameter" : null } }), { status: 400, headers: { "Content-Type": "application/json" } });
const reussite = () => () => new Response(JSON.stringify({ data: [{ b64_json: rendu }], usage: { input_tokens: 1500, input_tokens_details: { text_tokens: 500, image_tokens: 1000 }, output_tokens: 4000 } }), { status: 200, headers: { "Content-Type": "application/json" } });
let dejaVues = new Set<string>();
const lignes = async () => (await prisma.generationImage.findMany({ orderBy: { createdAt: "asc" } })).filter((l) => !dejaVues.has(l.id));

before(async () => {
  process.env.OPENAI_API_KEY = "cle-des-essais";
  process.env.OPENAI_BASE_URL = "http://openai.essai/v1";
  process.env.OPENAI_IMAGE_MODEL = "";
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const adresse = String(entree instanceof Request ? entree.url : entree);
    if (adresse.startsWith("data:")) return fetchOrigine(entree, init);
    assert.equal(adresse, "http://openai.essai/v1/images/edits");
    const corps = init?.body as FormData;
    const champs: Record<string, string> = {};
    let images = 0;
    for (const [cle, valeur] of corps.entries()) {
      if (cle === "image[]") images++;
      else champs[cle] = String(valeur);
    }
    appels.push({ champs, images });
    const suivante = reponses.shift();
    assert.ok(suivante, "appel non prévu");
    return suivante();
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  generation = await import("@/lib/simulations/generation");
  sharp = (await import("sharp")).default;
  photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 190, b: 170 } } }).jpeg().toBuffer();
  rendu = (await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 120, g: 140, b: 110 } } }).jpeg().toBuffer()).toString("base64");
});
beforeEach(async () => {
  appels = [];
  reponses = [];
  dejaVues = new Set((await prisma.generationImage.findMany({ select: { id: true } })).map((l) => l.id));
});
after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

const entree = (extra: Partial<import("@/lib/simulations/generation").EntreeGeneration> = {}) => ({ prompt: "Remplacer les façades.", photo, origine: "CRM" as const, swatches: [photo], qualite: "medium" as const, ...extra });

describe("parametreRefuse", () => {
  test("lit error.param, sinon le nom dans le message ; rien hors d'un 400 ni pour un autre refus", () => {
    const { parametreRefuse, PARAMETRES_RETIRABLES } = generation;
    assert.deepEqual([...PARAMETRES_RETIRABLES], ["input_fidelity", "output_compression", "output_format"]);
    assert.equal(parametreRefuse(400, JSON.stringify({ error: { message: "Unknown parameter: 'input_fidelity'.", param: "input_fidelity" } }), PARAMETRES_RETIRABLES), "input_fidelity");
    assert.equal(parametreRefuse(400, "Invalid value for output_compression: not supported for this model", PARAMETRES_RETIRABLES), "output_compression");
    assert.equal(parametreRefuse(400, JSON.stringify({ error: { message: "bad", param: "body.output_format" } }), PARAMETRES_RETIRABLES), "output_format");
    assert.equal(parametreRefuse(500, "input_fidelity", PARAMETRES_RETIRABLES), null);
    assert.equal(parametreRefuse(400, JSON.stringify({ error: { message: "Your request was rejected by the safety system.", param: null } }), PARAMETRES_RETIRABLES), null);
    assert.equal(parametreRefuse(400, JSON.stringify({ error: { message: "Invalid size", param: "size" } }), PARAMETRES_RETIRABLES), null);
    // déjà retiré : plus proposé
    assert.equal(parametreRefuse(400, "Unknown parameter: 'input_fidelity'.", ["output_format", "output_compression"]), null);
  });
});

describe("genererRendu : repli sans le paramètre refusé", () => {
  test("sans 400 : un seul appel, tous les paramètres d'avant, phase « rendu », modèle de OPENAI_IMAGE_MODEL (gpt-image-1)", async () => {
    reponses = [reussite()];
    const r = await generation.genererRendu(entree());
    assert.equal(r.ok, true);
    assert.equal(appels.length, 1);
    assert.deepEqual(
      { model: appels[0].champs.model, input_fidelity: appels[0].champs.input_fidelity, output_format: appels[0].champs.output_format, output_compression: appels[0].champs.output_compression, quality: appels[0].champs.quality },
      { model: "gpt-image-1", input_fidelity: "high", output_format: "jpeg", output_compression: "90", quality: "medium" }
    );
    assert.equal(appels[0].images, 2);
    assert.deepEqual(r.ok && r.parametresRetires, []);
    const [ligne] = await lignes();
    assert.equal(ligne.phase, "rendu");
    assert.equal(ligne.modele, "gpt-image-1");
    assert.equal(ligne.statut, "REUSSI");
    assert.equal(ligne.coutDollars, generation.coutEnDollars({ texte: 500, image: 1000, sortie: 4000 }, "gpt-image-1"));
  });

  test("400 sur input_fidelity : refait une fois sans lui, le reste identique ; modèle et phase de l'appelant notés, coût au tarif de sunburst", async () => {
    reponses = [refus("input_fidelity", "Unknown parameter: 'input_fidelity'."), reussite()];
    const r = await generation.genererRendu(entree({ modele: "gpt-image-2.5-sunburst", phase: "essai-modele" }));
    assert.equal(r.ok, true);
    assert.equal(appels.length, 2);
    assert.equal(appels[0].champs.input_fidelity, "high");
    assert.equal("input_fidelity" in appels[1].champs, false);
    const { input_fidelity: _retire, ...avant } = appels[0].champs;
    void _retire;
    assert.deepEqual(appels[1].champs, avant);
    assert.equal(appels[1].champs.model, "gpt-image-2.5-sunburst");
    assert.equal(appels[1].images, 2);
    assert.deepEqual(r.ok && r.parametresRetires, ["input_fidelity"]);
    const toutes = await lignes();
    assert.equal(toutes.length, 1, "le 400 (non facturé) n'est pas noté, seul l'appel abouti l'est");
    assert.equal(toutes[0].phase, "essai-modele");
    assert.equal(toutes[0].modele, "gpt-image-2.5-sunburst");
    const attendu = Math.round(((500 * 5 + 1000 * 8 + 4000 * 30) / 1_000_000) * 10_000) / 10_000;
    assert.equal(toutes[0].coutDollars, attendu);
    assert.equal(r.ok && r.coutDollars, attendu);
  });

  test("400 sur output_format : output_format et output_compression retirés ensemble ; puis un autre paramètre refusé : retiré aussi, une fois", async () => {
    reponses = [refus("output_format", "Unsupported parameter: 'output_format'."), refus("input_fidelity", "Unknown parameter: 'input_fidelity'."), reussite()];
    const r = await generation.genererRendu(entree({ modele: "gpt-image-2.5-sunburst" }));
    assert.equal(r.ok, true);
    assert.equal(appels.length, 3);
    assert.equal("output_format" in appels[1].champs || "output_compression" in appels[1].champs, false);
    assert.equal(appels[1].champs.input_fidelity, "high");
    assert.equal(["input_fidelity", "output_format", "output_compression"].some((p) => p in appels[2].champs), false);
    assert.deepEqual(r.ok && r.parametresRetires, ["output_format", "output_compression", "input_fidelity"]);
  });

  test("le même paramètre refusé deux fois : pas de troisième appel, échec noté", async () => {
    reponses = [refus("input_fidelity", "Unknown parameter: 'input_fidelity'."), refus("input_fidelity", "Unknown parameter: 'input_fidelity'.")];
    const r = await generation.genererRendu(entree({ modele: "gpt-image-2.5-sunburst", phase: "essai-modele" }));
    assert.equal(r.ok, false);
    assert.equal(appels.length, 2);
    const [ligne] = await lignes();
    assert.equal(ligne.statut, "ECHEC");
    assert.equal(ligne.phase, "essai-modele");
    assert.equal(ligne.modele, "gpt-image-2.5-sunburst");
    assert.match(ligne.erreur ?? "", /HTTP 400/);
  });

  test("un autre 400 (photo refusée) et un 429 : jamais rejoués", async () => {
    reponses = [refus(null, "Your request was rejected as a result of our safety system.")];
    const r = await generation.genererRendu(entree());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.raison, "photo-refusee");
    assert.equal(appels.length, 1);
    reponses = [() => new Response("Rate limit reached for input_fidelity requests", { status: 429 })];
    const r2 = await generation.genererRendu(entree());
    assert.equal(r2.ok, false);
    assert.equal(appels.length, 2);
  });
});
