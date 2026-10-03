// Photos, série 2 — les retouches après relecture (bouilloires hors cuisine, variantes), dans le plafond de la série.
// Logique : src/lib/simulations/retouches.ts ; liste des retouches : scripts/retouches-serie-2.json.
//
//   node --import tsx scripts/retouches-serie-2.ts --estimer     (le plan et le coût, sans appel)
//   node --import tsx scripts/retouches-serie-2.ts               (lance ; s'arrête avant l'appel qui franchirait le plafond)
//   --hors-base 0,25   dépense facturée mais absente de GenerationImage (appel interrompu), comptée dans le plafond
//
// L'essai retenu de chaque avant vient de scripts/zones-serie-2.json (choix), celui de chaque après de
// <racine>/bibliotheque.json. Les originaux remplacés sont gardés dans <racine>/originaux/.
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { depenseDeLaSerie, dossierDe, estimerAppel, lireListeImages, modeleDe, modeleEdition, type ImageSite } from "../src/lib/simulations/ambiances";
import { lireZones } from "../src/lib/simulations/bibliotheque";
import { genererAmbiance } from "../src/lib/simulations/generation";
import { ecartAutourDeLaZone, lireRetouches, prochainsEssais, promptVariante, recollerZone } from "../src/lib/simulations/retouches";
import { CATALOGUE_DEFAUT, lireCatalogue, vignetteEnEntree, vignetteLocale } from "../src/lib/simulations/vignettes";

/** Écart autour de la zone au-delà duquel le raccord se verrait (édition glissée ou autre photo) : calées 3-4, ratées 32-83. */
const ECART_MAX = 8;
const dollars = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

async function principal() {
  const estimer = process.argv.includes("--estimer");
  const i = process.argv.indexOf("--hors-base");
  const horsBase = i > 0 ? Number(process.argv[i + 1].replace(",", ".")) : 0;
  if (!Number.isFinite(horsBase) || horsBase < 0) throw new Error("--hors-base : un montant en dollars.");
  const racine = path.join(os.homedir(), "coverswap-photos", "serie-2");
  const liste = lireListeImages(await fs.readFile(path.resolve("scripts", "photos-serie-2.json"), "utf8"));
  const zones = lireZones(await fs.readFile(path.resolve("scripts", "zones-serie-2.json"), "utf8"));
  const retouches = lireRetouches(await fs.readFile(path.resolve("scripts", "retouches-serie-2.json"), "utf8"));
  const bibliotheque: { nom: string; essai: number | null }[] = JSON.parse(await fs.readFile(path.join(racine, "bibliotheque.json"), "utf8"));
  const parNom = new Map(liste.images.map((i) => [i.nom, i]));
  const image = (nom: string): ImageSite => {
    const i = parNom.get(nom);
    if (!i) throw new Error(`${nom} absent de la liste.`);
    return i;
  };
  const retenu = (nom: string) => {
    const k = image(nom).mode === "edition" ? bibliotheque.find((l) => l.nom === nom)?.essai : zones.choix[nom];
    if (!k) throw new Error(`${nom} : aucun essai retenu.`);
    return path.join(dossierDe(image(nom), racine, liste), `${nom}-${k}.png`);
  };
  const originaux = path.join(racine, "originaux");
  const sauvegarde = (fichier: string) => path.join(originaux, path.basename(fichier));

  // Le plan, appel par appel, avec son coût estimé.
  type Appel = { titre: string; estime: number; faire: () => Promise<number> };
  const appels: Appel[] = [];
  const copies: { titre: string; faire: () => Promise<void> }[] = [];
  const catalogue = new Map(lireCatalogue(await fs.readFile(CATALOGUE_DEFAUT(), "utf8")).map((r) => [r.id, r]));

  const corrigerBouilloire = async (fichier: string, zone: [number, number, number, number]) => {
    const original = await fs.readFile(fichier);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(original).metadata();
    const format = `${meta.width}x${meta.height}` as ImageSite["format"];
    const r = await genererAmbiance({ prompt: retouches.prompt_bouilloire, format, source: { octets: original, type: "image/png", nom: path.basename(fichier) } }, { modele: modeleEdition(), phase: "serie-2", journal: console.log });
    if (!r.ok) throw new Error(`${path.basename(fichier)} : échec ${r.raison} (${r.message}).`);
    await fs.mkdir(originaux, { recursive: true });
    await fs.writeFile(path.join(originaux, `${path.basename(fichier, ".png")}.brut-retouche.png`), r.image);
    // Garde : hors de la zone, l'image rendue doit rester la même photo ; sinon rien n'est recollé.
    const ecart = await ecartAutourDeLaZone(original, r.image, zone);
    if (ecart > ECART_MAX) {
      console.log(`  ${path.basename(fichier)} : NON recollée, l'image rendue a glissé ou changé (écart autour ${ecart.toFixed(1)} > ${ECART_MAX}) — ${dollars(r.coutDollars)}.`);
      return r.coutDollars;
    }
    await fs.writeFile(sauvegarde(fichier), original);
    await fs.writeFile(fichier, await recollerZone(original, r.image, zone));
    console.log(`  ${path.basename(fichier)} : bouilloire retirée (écart autour ${ecart.toFixed(1)}) — ${dollars(r.coutDollars)}.`);
    return r.coutDollars;
  };

  for (const b of retouches.bouilloires) {
    const avant = retenu(b.avant);
    if (existsSync(sauvegarde(avant))) console.log(`Déjà fait : ${path.basename(avant)}.`);
    else appels.push({ titre: `bouilloire ${path.basename(avant)}`, estime: estimerAppel({ mode: "edition", format: image(b.avant).format }), faire: () => corrigerBouilloire(avant, b.zone) });
    for (const nom of b.corriger ?? []) {
      const f = retenu(nom);
      if (existsSync(sauvegarde(f))) console.log(`Déjà fait : ${path.basename(f)}.`);
      else appels.push({ titre: `bouilloire ${path.basename(f)}`, estime: estimerAppel({ mode: "edition", format: image(nom).format }), faire: () => corrigerBouilloire(f, b.zone) });
    }
    for (const nom of b.recopier ?? []) {
      const f = retenu(nom);
      if (existsSync(sauvegarde(f))) console.log(`Déjà fait : ${path.basename(f)}.`);
      else
        copies.push({
          titre: `zone recopiée de ${path.basename(avant)} dans ${path.basename(f)}`,
          faire: async () => {
            if (!existsSync(sauvegarde(avant))) throw new Error(`${path.basename(avant)} pas encore corrigé.`);
            const original = await fs.readFile(f);
            await fs.mkdir(originaux, { recursive: true });
            await fs.writeFile(sauvegarde(f), original);
            await fs.writeFile(f, await recollerZone(original, await fs.readFile(avant), b.zone));
          },
        });
    }
  }

  for (const v of retouches.variantes) {
    const img = image(v.nom);
    const dossier = dossierDe(img, racine, liste);
    const prompt = promptVariante(img.prompt, v);
    for (const k of prochainsEssais(dossier, v.nom, v.essais)) {
      appels.push({
        titre: `${v.nom}-${k} (${v.motif})`,
        estime: estimerAppel(img),
        faire: async () => {
          let source = null;
          if (img.mode === "edition") {
            const avant = retenu(img.source!);
            source = { octets: await fs.readFile(avant), type: "image/png" as const, nom: path.basename(avant) };
          }
          const references = [];
          for (const ref of img.echantillons ?? []) references.push({ octets: await vignetteEnEntree(await vignetteLocale(catalogue.get(ref)!, path.join(os.homedir(), "coverswap-photos", "vignettes"))), type: "image/png" as const, nom: `${ref}.png` });
          const r = await genererAmbiance({ prompt, format: img.format, source, ...(references.length ? { references } : {}), fond: img.fond ?? null }, { modele: modeleDe(img), phase: "serie-2", journal: console.log });
          if (!r.ok) throw new Error(`${v.nom}-${k} : échec ${r.raison} (${r.message}).`);
          await fs.writeFile(path.join(dossier, `${v.nom}-${k}.png`), r.image);
          console.log(`  ${v.nom}-${k}.png — ${dollars(r.coutDollars)}.`);
          return r.coutDollars;
        },
      });
    }
  }

  const plafond = liste.plafond ?? 10;
  const deja = (await depenseDeLaSerie("serie-2")) + horsBase;
  const estime = appels.reduce((s, a) => s + a.estime, 0);
  console.log(`Plan : ${appels.length} appel(s), ≈ ${dollars(estime)} ; ${copies.length} recopie(s) de zone (sans appel). Série : ${dollars(deja)} déjà dépensés${horsBase ? ` (dont ${dollars(horsBase)} hors GenerationImage)` : ""}, plafond ${dollars(plafond)}, reste ${dollars(plafond - deja)}.`);
  for (const a of appels) console.log(`  - ${a.titre} : ≈ ${dollars(a.estime)}`);
  if (estimer) return;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY absente de l'environnement : rien n'est lancé.");

  let depense = deja;
  const echecs: string[] = [];
  for (const [i, a] of appels.entries()) {
    if (depense + a.estime > plafond) {
      console.log(`PLAFOND : ${dollars(depense)} + ≈ ${dollars(a.estime)} dépasseraient ${dollars(plafond)} — arrêt, ${appels.length - i} appel(s) non lancé(s).`);
      break;
    }
    console.log(`[${i + 1}/${appels.length}] ${a.titre}`);
    try {
      const cout = await a.faire();
      depense += cout;
      // Garde : un appel bien plus cher que prévu (le masque l'a été 4 fois) arrête tout avant le suivant.
      if (cout > 2 * a.estime) {
        console.log(`ARRÊT : ${dollars(cout)} pour un appel estimé à ${dollars(a.estime)}.`);
        break;
      }
    } catch (erreur) {
      echecs.push(erreur instanceof Error ? erreur.message : String(erreur));
      console.log(`  ÉCHEC : ${echecs.at(-1)}`);
    }
    // Les recopies dès que leur avant est corrigé.
    for (const c of copies.splice(0)) {
      try {
        await c.faire();
        console.log(`  ${c.titre}.`);
      } catch {
        copies.push(c);
      }
    }
  }
  for (const c of copies) console.log(`Recopie non faite : ${c.titre}.`);
  const total = await depenseDeLaSerie("serie-2");
  console.log(`Retouches : ${dollars(total + horsBase - deja)} ; série 2 relue dans GenerationImage : ${dollars(total)}${horsBase ? ` + ${dollars(horsBase)} hors base` : ""} / ${dollars(plafond)}${echecs.length ? ` ; ${echecs.length} échec(s)` : ""}.`);
}

principal().catch((erreur) => {
  console.error("[retouches]", erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
});
