import assert from "node:assert/strict";
import { mkdtempSync, promises as fs, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-correction-teintes-"));

/**
 * Mission 23 (L3) — la correction des teintes (`correction-teintes.ts`), son branchement en fin de pipeline derrière
 * le réglage `correctionTeintes` (désactivé par défaut), la fidélité enregistrée et affichée (liste du CRM,
 * `voir_fichiers`). Images SYNTHÉTIQUES faites ici par sharp (aucune photo de client) ; générateur d'images simulé
 * (aucun appel OpenAI, aucun réseau).
 */

let ct: typeof import("./correction-teintes");
let fid: typeof import("./fidelite");
let mr: typeof import("./mesure-rendu");
let teintes: typeof import("./teintes");
let sharp: typeof import("sharp");
let prisma: typeof import("@/lib/prisma").default;
const DOSSIER = mkdtempSync(path.join(tmpdir(), "coverswap-correction-images-"));

before(async () => {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM", "OPENAI_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée
  process.env.TACHES_DESACTIVEES = "1";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  ct = await import("./correction-teintes");
  fid = await import("./fidelite");
  mr = await import("./mesure-rendu");
  teintes = await import("./teintes");
  sharp = (await import("sharp")).default;
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/simulateur/catalogue")).definirCatalogueEssai([
    { id: "RM30", nom: "Pastel Olive Green", famille: "couleur", categorie: "Color", finition: "Soft", image: "https://ssi.s3.fr-par.scw.cloud/essai/rm30.jpg", tags: ["couleur"], hex: "#A4A38F" },
  ]);
});
after(async () => {
  rmSync(DOSSIER, { recursive: true, force: true });
  await prisma.$disconnect();
});

const W = 1024;
const H = 683;
type Rgb = [number, number, number];
type Peintre = (x: number, y: number) => Rgb;
type Rect = [number, number, number, number];
const dans = (r: Rect, x: number, y: number) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

function brut(peintre: Peintre): Buffer {
  const b = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = peintre(x, y);
      const i = 3 * (y * W + x);
      for (let k = 0; k < 3; k++) b[i + k] = Math.max(0, Math.min(255, Math.round(c[k])));
    }
  return b;
}
/** Une image PNG (sans perte : un pixel inchangé l'est à l'octet près). */
const png = (peintre: Peintre) => sharp(brut(peintre), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
const pixels = async (image: Buffer) => sharp(image).removeAlpha().raw().toBuffer();

const hex = (h: string) => teintes.hexVersRgb(h) as Rgb;
// La pièce de la mesure (L2) : mur gris moyen, cadre blanc #F2F2F2 (le blanc de la scène), sol sombre, une façade.
const MUR: Rgb = [140, 138, 135];
const BLANC: Rgb = [242, 242, 242];
const SOL: Rgb = [70, 60, 50];
const CADRE: Rect = [40, 40, 160, 120];
const FACADE: Rect = [300, 300, 450, 300];
const piece = (facade: Peintre): Peintre => (x, y) => (dans(CADRE, x, y) ? BLANC : dans(FACADE, x, y) ? facade(x, y) : y >= 640 ? SOL : MUR);
const uni = (c: Rgb): Peintre => () => c;
const fauxBois = (c: Rgb, amp = 18): Peintre => (x) => {
  const v = amp * Math.sin(x * 0.9) * (0.6 + 0.4 * Math.sin(x * 0.13));
  return [c[0] + v, c[1] + v, c[2] + v];
};
const eclaire = (c: Rgb, k: number): Rgb => c.map((v) => teintes.versSrgb(teintes.versLineaire(v) * k)) as Rgb;
const RM30 = { ref: "RM30", nom: "Pastel Olive Green", hex: "#A4A38F", classe: "uni" as const };
const ZONES = [{ zone: "meubles-bas", ref: "RM30" }];
const AVANT = () => png(piece(uni([120, 100, 80])));

/** Médianes Lab (sans balance : le cadre est déjà #F2F2F2) d'une bande de la façade. */
async function labBande(image: Buffer, x0: number, x1: number): Promise<{ L: number; a: number; b: number }> {
  const p = await pixels(image);
  const L: number[] = [];
  const A: number[] = [];
  const B: number[] = [];
  for (let y = FACADE[1] + 30; y < FACADE[1] + FACADE[3] - 30; y += 3)
    for (let x = x0; x < x1; x += 3) {
      const lab = teintes.rgbVersLab([p[3 * (y * W + x)], p[3 * (y * W + x) + 1], p[3 * (y * W + x) + 2]]);
      L.push(lab[0]);
      A.push(lab[1]);
      B.push(lab[2]);
    }
  const med = (v: number[]) => [...v].sort((u, w) => u - w)[v.length >> 1];
  return { L: med(L), a: med(A), b: med(B) };
}

describe("correction des teintes : recalage, limites, bord", () => {
  test("un aplat connu décalé (RM30 rendu trop vert et trop clair) : corrigé à ΔE ≤ 1,5 ; à clarté partielle, la teinte est juste", async () => {
    const rendu = await png(piece(uni(hex("#A6B095"))));
    const complet = await ct.corrigerTeintes({ avant: await AVANT(), apres: rendu, zones: ZONES, references: [RM30], amplitudeL: 1 });
    const f = complet.fidelite[0];
    assert.equal(f.etat, "corrigee", f.raison);
    assert.equal(complet.corrigee, true);
    assert.ok(f.deltaEAvant! > 5, `avant ${f.deltaEAvant}`);
    assert.ok(f.deltaEApres! <= 1.5, `après ${f.deltaEApres}`);
    // La mesure indépendante (L2) relit l'image produite : elle aussi trouve la teinte du catalogue.
    const relue = await mr.mesurerRendu(await AVANT(), complet.image, [RM30]);
    assert.ok(relue.surfaces[0].deltaE! <= 1.5, `relue ${relue.surfaces[0].deltaE}`);
    // L'amplitude par défaut (clarté corrigée à moitié) : la teinte est juste, la clarté rapprochée seulement.
    const defaut = await ct.corrigerTeintes({ avant: await AVANT(), apres: rendu, zones: ZONES, references: [RM30] });
    const d = defaut.fidelite[0];
    assert.equal(ct.AMPLITUDE_L, 0.5);
    assert.ok(d.deltaETeinteApres! <= 1, `teinte ${d.deltaETeinteApres}`);
    assert.ok(d.deltaEApres! < d.deltaEAvant! - 2 && d.deltaEApres! <= 3, `après ${d.deltaEApres}`);
    assert.equal(f.zone, "meubles-bas");
    assert.ok(complet.dureeMs > 0 && complet.dureeMs < 10_000);
  });

  test("un dégradé d'éclairage : ombres gardées, le rapport de clarté entre l'ombre et la lumière respecté", async () => {
    const C = hex("#A6B095");
    const degrade: Peintre = (x) => eclaire(C, 0.55 + (0.45 * (x - FACADE[0])) / (FACADE[2] - 1));
    const rendu = await png(piece(degrade));
    const r = await ct.corrigerTeintes({ avant: await AVANT(), apres: rendu, zones: ZONES, references: [RM30] });
    assert.equal(r.fidelite[0].etat, "corrigee", r.fidelite[0].raison);
    const [ombreAvant, lumiereAvant, ombreApres, lumiereApres] = await Promise.all([labBande(rendu, 340, 400), labBande(rendu, 650, 710), labBande(r.image, 340, 400), labBande(r.image, 650, 710)]);
    assert.ok(ombreApres.L < lumiereApres.L - 5, "l'ombre reste plus sombre");
    const rapportAvant = ombreAvant.L / lumiereAvant.L;
    const rapportApres = ombreApres.L / lumiereApres.L;
    assert.ok(Math.abs(rapportApres / rapportAvant - 1) < 0.03, `rapport ${rapportAvant.toFixed(3)} → ${rapportApres.toFixed(3)}`);
    // La teinte est recalée partout pareil : l'ombre et la lumière perdent le même excès de vert.
    assert.ok(ombreApres.a > ombreAvant.a + 2 && lumiereApres.a > lumiereAvant.a + 2, `a ${ombreAvant.a}→${ombreApres.a}, ${lumiereAvant.a}→${lumiereApres.a}`);
  });

  test("un faux bois : le fil est conservé (variance locale à ±15 %)", async () => {
    const bois = { ref: "BOIS", nom: "Chêne d'essai", hex: "#B49063", classe: "bois" as const };
    const rendu = await png(piece(fauxBois([150, 140, 110])));
    const r = await ct.corrigerTeintes({ avant: await png(piece(fauxBois([90, 60, 40]))), apres: rendu, zones: [{ zone: "plan-de-travail", ref: "BOIS" }], references: [bois] });
    assert.equal(r.fidelite[0].etat, "corrigee", r.fidelite[0].raison);
    assert.ok(r.fidelite[0].deltaEApres! < r.fidelite[0].deltaEAvant! - 3);
    const ecartLocal = async (image: Buffer) => {
      const lab = await mr.labImage(await pixels(image), W, H);
      const ecarts: number[] = [];
      for (let y = FACADE[1] + 40; y < FACADE[1] + FACADE[3] - 40; y += 9)
        for (let x = FACADE[0] + 40; x < FACADE[0] + FACADE[2] - 40; x += 9) {
          let s = 0;
          let s2 = 0;
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++) {
              const v = lab.L[(y + dy) * W + x + dx];
              s += v;
              s2 += v * v;
            }
          ecarts.push(Math.sqrt(Math.max(0, s2 / 49 - (s / 49) ** 2)));
        }
      return [...ecarts].sort((u, w) => u - w)[ecarts.length >> 1];
    };
    const [avant, apres] = await Promise.all([ecartLocal(rendu), ecartLocal(r.image)]);
    assert.ok(Math.abs(apres / avant - 1) <= 0.15, `fil ${avant.toFixed(2)} → ${apres.toFixed(2)}`);
  });

  test("aucun pixel modifié hors du masque au-delà du bord flou", async () => {
    const rendu = await png(piece(uni(hex("#A6B095"))));
    const r = await ct.corrigerTeintes({ avant: await AVANT(), apres: rendu, zones: ZONES, references: [RM30] });
    assert.equal(r.corrigee, true);
    assert.equal(r.image[0], 0x89, "PNG en entrée, PNG en sortie (sans perte)");
    const [a, b] = await Promise.all([pixels(rendu), pixels(r.image)]);
    const MARGE = 12;
    const large: Rect = [FACADE[0] - MARGE, FACADE[1] - MARGE, FACADE[2] + 2 * MARGE, FACADE[3] + 2 * MARGE];
    let dehors = 0;
    let dedans = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = 3 * (y * W + x);
        const change = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
        if (!change) continue;
        if (dans(large, x, y)) dedans++;
        else dehors++;
      }
    assert.equal(dehors, 0, `${dehors} pixel(s) modifié(s) hors de la façade et de son bord`);
    assert.ok(dedans > 0.9 * FACADE[2] * FACADE[3], `${dedans} pixels recalés`);
  });

  test("un masque douteux (rendu décalé) et une texture perdue : « a_regenerer », rien n'est touché", async () => {
    const blocs: Peintre = (x, y) => {
      const i = Math.floor(x / 64) + 17 * Math.floor(y / 48);
      return [60 + ((i * 53) % 170), 60 + ((i * 97) % 170), 60 + ((i * 31) % 170)];
    };
    const decale = await png((x, y) => (dans(FACADE, x, y) ? hex("#A6B095") : blocs(Math.max(0, x - 30), y)));
    const douteux = await ct.corrigerTeintes({ avant: await png(blocs), apres: decale, zones: ZONES, references: [RM30] });
    assert.equal(douteux.corrigee, false);
    assert.equal(douteux.fidelite[0].etat, "a_regenerer");
    assert.match(douteux.fidelite[0].raison ?? "", /masque douteux/);
    assert.ok(douteux.image.equals(decale), "mêmes octets");

    const bois = { ref: "BOIS", nom: "Chêne d'essai", hex: "#C8AA82", classe: "bois" as const };
    const aplat = await png(piece(uni([200, 170, 130])));
    const perdue = await ct.corrigerTeintes({ avant: await png(piece(fauxBois([150, 110, 70]))), apres: aplat, zones: [{ zone: "plan-de-travail", ref: "BOIS" }], references: [bois] });
    assert.equal(perdue.fidelite[0].etat, "a_regenerer");
    assert.match(perdue.fidelite[0].raison ?? "", /texture perdue/);
    assert.ok(perdue.image.equals(aplat));
  });

  test("une surface déjà fidèle est laissée intacte ; la mesure seule (réglage inactif) ne touche jamais l'image", async () => {
    const juste = await png(piece(uni(hex("#A4A38F"))));
    const r = await ct.corrigerTeintes({ avant: await AVANT(), apres: juste, zones: ZONES, references: [RM30] });
    assert.equal(r.fidelite[0].etat, "fidele");
    assert.ok(r.fidelite[0].deltaEAvant! <= ct.SEUIL_FIDELE);
    assert.equal(r.corrigee, false);
    assert.ok(r.image.equals(juste));

    const faux = await png(piece(uni(hex("#A6B095"))));
    const lecture = await ct.corrigerTeintes({ avant: await AVANT(), apres: faux, zones: ZONES, references: [RM30], appliquer: false });
    assert.equal(lecture.fidelite[0].etat, "mesuree");
    assert.equal(lecture.fidelite[0].deltaEApres, lecture.fidelite[0].deltaEAvant);
    assert.equal(lecture.corrigee, false);
    assert.ok(lecture.image.equals(faux));
  });

  test("résumé et détail de la fidélité : « teinte fidèle à 2,1 », « à régénérer », « non corrigé »", () => {
    const base = { zone: "meubles-bas", ref: "RM30", deltaETeinteAvant: 6.6, deltaETeinteApres: 0.4, texture: null };
    const corrigee = { ...base, deltaEAvant: 7.6, deltaEApres: 2.1, etat: "corrigee" as const };
    const fidele = { ...base, zone: "meubles-hauts", deltaEAvant: 1.4, deltaEApres: 1.4, etat: "fidele" as const };
    assert.deepEqual(fid.resumerFidelite([corrigee, fidele]), { etat: "fidele", pire: 2.1, texte: "teinte fidèle à 2,1" });
    assert.equal(fid.resumerFidelite([corrigee, { ...fidele, etat: "a_regenerer", raison: "texture perdue" }])?.texte, "à régénérer");
    assert.equal(fid.resumerFidelite([{ ...corrigee, etat: "mesuree", deltaEApres: 7.6 }])?.texte, "écart de teinte 7,6 (non corrigé)");
    assert.equal(fid.resumerFidelite(null), null);
    assert.equal(fid.detailFidelite(corrigee), "ΔE 7,6 → 2,1");
    assert.equal(fid.detailFidelite(fidele), "fidèle (ΔE 1,4)");
    assert.equal(fid.detailFidelite({ ...corrigee, etat: "a_regenerer", raison: "texture perdue" }), "à régénérer : texture perdue");
    assert.equal(fid.detailFidelite({ ...corrigee, clarteIncertaine: true }), "ΔE à clarté égale 6,6 → 0,4");
    assert.deepEqual(fid.lireFidelite(JSON.stringify([corrigee])), [corrigee]);
    assert.equal(fid.lireFidelite("pas du json"), null);
  });
});

describe("branchement : réglage désactivé par défaut, fin du pipeline, rendu d'origine gardé", () => {
  test("le réglage SIMULATEUR_CORRECTION_TEINTES : non par défaut, oui quand il est posé", async () => {
    const { DEFINITIONS_PARAMETRES } = await import("@/lib/parametres/definitions");
    const def = (DEFINITIONS_PARAMETRES as unknown as Record<string, { groupe: string; nature: string; options?: { valeur: string }[] }>).SIMULATEUR_CORRECTION_TEINTES;
    assert.equal(def.groupe, "SIMULATEUR");
    assert.equal(def.nature, "choix");
    assert.deepEqual(def.options?.map((o) => o.valeur), ["NON", "OUI"]);
    const reglages = await import("@/lib/simulateur/reglages");
    assert.equal(reglages.REGLAGES_PAR_DEFAUT.correctionTeintes, false);
    assert.equal((await reglages.reglagesSimulateur()).correctionTeintes, false);
    await prisma.parametre.create({ data: { cle: "SIMULATEUR_CORRECTION_TEINTES", valeur: JSON.stringify("OUI"), valableDu: new Date(Date.now() - 60_000) } });
    assert.equal((await reglages.reglagesSimulateur()).correctionTeintes, true);
    await prisma.parametre.create({ data: { cle: "SIMULATEUR_CORRECTION_TEINTES", valeur: JSON.stringify("NON"), valableDu: new Date(Date.now() - 30_000) } });
    assert.equal((await reglages.reglagesSimulateur()).correctionTeintes, false);
  });

  test("pipeline avec le réglage actif (générateur d'essai) : rendu remplacé, original rendu à part, fidélité écrite ; inactif : ni mesure ni correction (L4a)", async () => {
    const { genererAvecMoteur } = await import("./pipeline");
    const { REGLAGES_PAR_DEFAUT } = await import("@/lib/simulateur/reglages");
    const avant = await AVANT();
    const rendu = await png(piece(uni(hex("#A6B095"))));
    const generateur: import("./generation").Generateur = async () => ({ ok: true, image: rendu, type: "image/png", avant, taille: "1536x1024", dureeMs: 10, usage: { texte: 1, image: 1, sortie: 1 }, coutDollars: 0, generationId: null });
    const entree = { photo: avant, piece: "cuisine" as const, zones: [{ zone: "meubles-bas" as const, ref: "RM30" }], origine: "CRM" as const, promptV1: "essai", swatchUrlsV1: [], generateur };
    const actif = await genererAvecMoteur({ ...entree, reglages: { ...REGLAGES_PAR_DEFAUT, correctionTeintes: true } });
    assert.ok(actif.ok);
    if (!actif.ok) return;
    assert.ok(!actif.image.equals(rendu), "le rendu corrigé remplace le rendu");
    assert.ok(actif.imageOriginale?.equals(rendu), "l'original est rendu à part");
    assert.equal(actif.fidelite?.[0].etat, "corrigee");
    // Gardé à côté du rendu, suffixe -original.
    const { cheminOriginal, ecrireRenduOriginal } = await import("./rendu-original");
    assert.equal(cheminOriginal("site/p/s/apres.jpg"), "site/p/s/apres-original.jpg");
    const ecrit = await ecrireRenduOriginal("dossiers/d1/simulations/abc.png", actif.imageOriginale);
    assert.equal(ecrit, "dossiers/d1/simulations/abc-original.png");
    assert.ok(readFileSync(path.join(process.env.UPLOADS_DIR!, ecrit!)).equals(rendu));
    assert.equal(await ecrireRenduOriginal("x.png", null), null);

    const inactif = await genererAvecMoteur({ ...entree, reglages: REGLAGES_PAR_DEFAUT });
    assert.ok(inactif.ok);
    if (!inactif.ok) return;
    assert.ok(inactif.image.equals(rendu), "réglage inactif : rien ne change");
    assert.equal(inactif.imageOriginale, null);
    assert.equal(inactif.fidelite, null, "réglage inactif : plus aucune mesure en production (L4a)");
  });

  test("L4a : le banc mesure toujours (mesurerFidelite), en lecture seule ; les ambiances et les séries ne sont jamais corrigées", async () => {
    const { genererAvecMoteur, phaseSansCorrection } = await import("./pipeline");
    const { REGLAGES_PAR_DEFAUT } = await import("@/lib/simulateur/reglages");
    const avant = await AVANT();
    const rendu = await png(piece(uni(hex("#A6B095"))));
    const generateur: import("./generation").Generateur = async () => ({ ok: true, image: rendu, type: "image/png", avant, taille: "1536x1024", dureeMs: 10, usage: { texte: 1, image: 1, sortie: 1 }, coutDollars: 0, generationId: null });
    const entree = { photo: avant, piece: "cuisine" as const, zones: [{ zone: "meubles-bas" as const, ref: "RM30" }], origine: "CRM" as const, promptV1: "essai", swatchUrlsV1: [], generateur };
    const banc = await genererAvecMoteur({ ...entree, reglages: REGLAGES_PAR_DEFAUT, mesurerFidelite: true });
    assert.ok(banc.ok);
    if (!banc.ok) return;
    assert.ok(banc.image.equals(rendu), "mesure seule : l'image n'est pas touchée");
    assert.equal(banc.imageOriginale, null);
    assert.equal(banc.fidelite?.[0].etat, "mesuree");
    for (const phase of ["ambiance", "ambiance-edition", "serie-2", "serie-2-edition"]) {
      assert.equal(phaseSansCorrection(phase), true, phase);
      const sortie = await genererAvecMoteur({ ...entree, reglages: { ...REGLAGES_PAR_DEFAUT, correctionTeintes: true }, phase, mesurerFidelite: true });
      assert.ok(sortie.ok);
      if (!sortie.ok) return;
      assert.ok(sortie.image.equals(rendu), `${phase} : image de catalogue laissée telle quelle`);
      assert.equal(sortie.imageOriginale, null, phase);
      assert.equal(sortie.fidelite, null, phase);
    }
    for (const phase of [undefined, null, "rendu", "calibrage-23", "essai-modele"]) assert.equal(phaseSansCorrection(phase), false, String(phase));
    // Les appelants (test de sources) : le banc demande la mesure, le rendu d'ambiance est rangé en phase « ambiance ».
    const lire = (f: string) => fs.readFile(path.join(process.cwd(), f), "utf8");
    assert.match(await lire("src/lib/simulateur/banc/banc.ts"), /mesurerFidelite: true/);
    assert.match(await lire("src/lib/simulations/ambiances.ts"), /genererAvecMoteur\(\{[^}]*phase: "ambiance"/);
    for (const f of ["src/lib/simulations/travaux.ts", "src/lib/simulateur/preparation.ts"]) assert.doesNotMatch(await lire(f), /mesurerFidelite/, `${f} : la production ne mesure pas`);
  });

  test("une erreur de correction laisse le rendu d'origine et ne casse pas la simulation", async () => {
    const { genererAvecMoteur } = await import("./pipeline");
    const { REGLAGES_PAR_DEFAUT } = await import("@/lib/simulateur/reglages");
    const rendu = await png(piece(uni(hex("#A6B095"))));
    const generateur: import("./generation").Generateur = async () => ({ ok: true, image: rendu, type: "image/png", avant: Buffer.from("pas une image"), taille: "1536x1024", dureeMs: 10, usage: { texte: 1, image: 1, sortie: 1 }, coutDollars: 0, generationId: null });
    const sortie = await genererAvecMoteur({ photo: Buffer.from("pas une image"), piece: "cuisine", zones: [{ zone: "meubles-bas", ref: "RM30" }], origine: "SITE", promptV1: "essai", swatchUrlsV1: [], generateur, reglages: { ...REGLAGES_PAR_DEFAUT, correctionTeintes: true } });
    assert.ok(sortie.ok);
    if (!sortie.ok) return;
    assert.ok(sortie.image.equals(rendu));
    assert.equal(sortie.imageOriginale, null);
    assert.equal(sortie.fidelite, null);
  });
});

describe("fidélité affichée : liste du CRM (v1 et v2) et voir_fichiers", () => {
  test("le badge de la liste des simulations, monté par le panneau v1 et le panneau v2 (test de sources)", async () => {
    const lire = (f: string) => fs.readFile(path.join(process.cwd(), f), "utf8");
    const liste = await lire("src/app/(pilotage)/dossiers/_components/SimulationsDossier.tsx");
    assert.match(liste, /resumerFidelite\(s\.fidelite\)/);
    assert.match(liste, /fidelite\.etat === "a_regenerer" \? "ambre"/);
    assert.match(liste, /\{fidelite\.texte\}/);
    assert.match(liste, /detailZone\(z\)/, "le détail par zone dans la ligne des zones");
    assert.ok(liste.indexOf("{fidelite.texte}") > liste.indexOf("contrôle {s.scoreControle}/10"), "après le badge « contrôle »");
    assert.match(await lire("src/app/(pilotage)/dossiers/_components/PanneauDossier.tsx"), /<SimulationsDossier/);
    assert.match(await lire("src/components/v2/dossier/RubriquesDossier.tsx"), /<SimulationsDossier/);
    assert.match(await lire("src/lib/simulations/dossier.ts"), /fidelite: lireFidelite\(s\.fidelite\)/);
  });

  test("voir_fichiers (simulations) : la fidélité dans l'état et dans les données", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Essai Fidélité", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33639980001", objet: "Cuisine", source: "ENTRANT" } });
    const espace = await prisma.espaceClient.create({ data: { code: `fid${Date.now().toString(36)}`, dossierId: dossier.id, expireLe: new Date(Date.now() + 30 * 86_400_000) } });
    const chemin = `dossiers/${dossier.id}/simulations/essai.jpg`;
    await fs.mkdir(path.join(process.env.UPLOADS_DIR!, path.dirname(chemin)), { recursive: true });
    await fs.writeFile(path.join(process.env.UPLOADS_DIR!, chemin), await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 164, g: 163, b: 143 } } }).jpeg().toBuffer());
    const fidelite = [{ zone: "meubles-bas", ref: "RM30", deltaEAvant: 7.6, deltaEApres: 2.1, deltaETeinteAvant: 6.6, deltaETeinteApres: 0.4, texture: null, etat: "corrigee" }];
    await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: dossier.id, chemin, statut: "BROUILLON", source: "API", titre: "Cuisine — Pastel Olive Green", zones: JSON.stringify([{ zone: "meubles-bas", libelle: "Meubles bas", ref: "RM30", nom: "Pastel Olive Green" }]), fidelite: JSON.stringify(fidelite), renduOriginal: `dossiers/${dossier.id}/simulations/essai-original.jpg` } });
    const { outilVoirSimulations } = await import("@/lib/assistant/outils/images");
    const r = await outilVoirSimulations.executer({ dossierId: dossier.id }, { sessionId: "essai", commande: null, utilisateur: "essai@exemple.fr", maintenant: new Date() });
    assert.match(r.texte, /teinte fidèle à 2,1/);
    const donnees = r.donnees as { simulations: { fidelite: { resume: string; zones: { etat: string; deltaEApres: number }[] } | null }[] };
    assert.equal(donnees.simulations[0].fidelite?.resume, "teinte fidèle à 2,1");
    assert.deepEqual(donnees.simulations[0].fidelite?.zones.map((z) => [z.etat, z.deltaEApres]), [["corrigee", 2.1]]);
    // La vue du CRM la lit aussi.
    const { listerSimulationsDossier } = await import("./dossier");
    const { simulations } = await listerSimulationsDossier(dossier.id);
    assert.equal(simulations[0].fidelite?.[0].etat, "corrigee");
  });
});
