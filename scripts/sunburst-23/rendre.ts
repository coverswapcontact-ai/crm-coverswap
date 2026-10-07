// Calibrage Sunburst — UN rendu gpt-image-2.5-sunburst (phases S2 à S4), qualité medium, par le pipeline de la mission
// 24 retenu (prompt V2 du moteur + C1, planche, masque troué C3), avec ce que cette campagne ajoute :
//  - la PRÉ-COMPENSATION de la teinte (`precompensation.ts`) : tour 1, catalogue − décalage de S0 (teinte, sinon
//    famille) ; tours suivants, la cible proposée par le tour précédent (ou `--cible`) ;
//  - le nuancier : `aplat` (planche peinte au hex de la cible, défaut si compensé), `texture` (vignette du catalogue
//    recolorée vers la cible, pour les bois), `catalogue` (vignette telle quelle, défaut sans compensation) ;
//  - le MASQUE AUTOMATIQUE de S1 (`masques-auto/<photo>.json`), troué localement ; `--masque dessine` pour le masque
//    de la mission 24.
// Après le rendu : mesure (score de la mission 24, sur le masque dessiné s'il existe), décalage restant, cible proposée
// pour le tour suivant, puis correction L3 par-dessus et sa mesure.
//
//   node --import tsx scripts/sunburst-23/rendre.ts --photo p04 --ref NE55 --phase S2 --tour 1 [--sans-compensation]
//        [--cible #A8957A] [--nuancier aplat|texture|catalogue] [--masque auto|dessine] [--payer --cle-depuis ../coverswap/.env.local]
//
// SANS `--payer` : rien n'est appelé ; prompt, planche et masque sont écrits dans `preparations/` (local) avec le coût
// estimé et la réponse du plafond. AVEC : le plafond de l'enveloppe de la phase et celui de 2,30 $ sont relus dans le
// journal de la campagne avant l'appel ; le cumul s'affiche après. La clé n'est jamais affichée ni copiée.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { lireMasques } from "../sunburst-24/masques";
import { scorer } from "../sunburst-24/score";
import { variante } from "../sunburst-24/variantes";
import { definirCatalogueEssai, imageEchantillon, type Reference } from "../../src/lib/simulateur/catalogue";
import { construirePrompt, etiquettesPour, formatDepuisDimensions } from "../../src/lib/simulateur/moteur";
import { construirePlanche } from "../../src/lib/simulateur/moteur/planche";
import { resumerTeinte } from "../../src/lib/simulateur/teintes";
import { ZONES_SIMULATEUR, type IdZone } from "../../src/lib/simulateur/zones";
import { coutEnDollars, type Usage } from "../../src/lib/simulations/prix";
import { referenceMoteur } from "../../src/lib/simulations/pipeline";
import { classeTexture } from "../../src/lib/simulations/mesure-rendu";
import { corrigerTeintes } from "../../src/lib/simulations/correction-teintes";
import { hexVersRgb, rgbVersLab } from "../../src/lib/simulations/teintes";
import { ESTIMATION_RENDU, autoriserAppel, enveloppeDe, inscrireAppel, ligneCumul, type PhaseCampagne } from "../../src/lib/simulations/calibrage-sunburst/budget";
import { masqueOpenAI, masqueTroueDepuisPolygones, type Polygone } from "../../src/lib/simulations/calibrage-sunburst/masque-auto";
import { ajusterCible, cibleEntree, decalageDe, familleCalibrage, referenceCompensee, tuileAplat, tuileRecoloree, type GroupeDecalage } from "../../src/lib/simulations/calibrage-sunburst/precompensation";
import { CATALOGUE, RACINE, RENDUS, S0, cheminCadre } from "./commun";
import { ecrireJournalCampagne, lireJournalCampagne, lireMasqueAuto } from "./masque-auto";

const MODELE = "gpt-image-2.5-sunburst";
const args = process.argv.slice(2);
const valeur = (nom: string) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : undefined);
const labDeHex = (hex: string) => rgbVersLab(hexVersRgb(hex));

/**
 * Le décalage de S0 à compenser au tour 1 : a et b de la teinte (au moins 2 rendus retenus), sinon de sa famille ; la
 * clarté toujours de la famille (elle dépend surtout de la lumière de la scène : le dL de M7 vient de deux rendus de la
 * même photo en contre-jour).
 */
function decalageS0(ref: string, famille: string): { source: string; d: Pick<GroupeDecalage["m24"], "dL" | "da" | "db"> } {
  const { resume } = JSON.parse(fs.readFileSync(path.join(S0, "decalages.json"), "utf8")) as { resume: { parTeinte: GroupeDecalage[]; parFamille: GroupeDecalage[] } };
  const f = resume.parFamille.find((g) => g.cle === famille);
  if (!f) throw new Error(`Aucun décalage de S0 pour la famille ${famille}.`);
  const t = resume.parTeinte.find((g) => g.cle === ref && g.n >= 2);
  return t ? { source: `a, b de la teinte ${ref} (${t.n} rendus), clarté de la famille ${famille} (${f.n})`, d: { dL: f.m24.dL, da: t.m24.da, db: t.m24.db } } : { source: `famille ${famille} (${f.n} rendus)`, d: f.m24 };
}

async function main() {
  const photo = valeur("--photo") ?? "";
  const refId = valeur("--ref") ?? "";
  const phase = (valeur("--phase") ?? "") as PhaseCampagne;
  const tour = Number(valeur("--tour") ?? 1);
  if (!["S2", "S3", "S4"].includes(phase)) throw new Error("--phase S2 | S3 | S4");
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, "utf8")) as Reference[];
  definirCatalogueEssai(catalogue);
  const ref = catalogue.find((r) => r.id === refId);
  if (!ref?.hex) throw new Error(`Référence inconnue ou sans hex : ${refId}`);
  const famille = familleCalibrage(ref.hex, classeTexture(ref));
  const dessine = lireMasques()[photo] as { zone: IdZone; polygones: Polygone[] } | undefined;
  const auto = lireMasqueAuto(photo);
  const choixMasque = valeur("--masque") ?? "auto";
  const masqueRendu = choixMasque === "dessine" ? dessine : auto;
  if (!masqueRendu) throw new Error(`Pas de masque ${choixMasque === "dessine" ? "dessiné" : "automatique (S1 d'abord)"} pour ${photo}.`);
  const zone = masqueRendu.zone;

  // 1) La cible d'entrée.
  const compenser = !args.includes("--sans-compensation");
  let cible = { hex: ref.hex, source: "catalogue (aucune compensation)" };
  const journal = lireJournalCampagne();
  if (compenser) {
    if (valeur("--cible")) cible = { hex: valeur("--cible")!.toUpperCase(), source: "donnée par --cible" };
    else if (tour === 1) {
      const s0 = decalageS0(ref.id, famille);
      const c = cibleEntree(ref.hex, s0.d);
      cible = { hex: c.hex, source: `S0, ${s0.source} : dL ${s0.d.dL} da ${s0.d.da} db ${s0.d.db} (clarté à moitié)${c.reductionGamut ? `, saturation −${c.reductionGamut} pour le gamut` : ""}${c.bornee ? ", bornée" : ""}` };
    } else {
      const precedent = [...journal.appels].reverse().find((a) => a.type === "rendu" && !a.erreur && (a.mesure as { ref?: string; prochaineCible?: string } | null)?.ref === ref.id);
      const proposee = (precedent?.mesure as { prochaineCible?: string } | undefined)?.prochaineCible;
      if (!proposee) throw new Error(`Tour ${tour} : aucune cible proposée par un tour précédent de ${ref.id} (donner --cible).`);
      cible = { hex: proposee, source: `proposée par l'appel n°${precedent!.n}` };
    }
  }
  const nuancier = valeur("--nuancier") ?? (compenser ? "aplat" : "catalogue");
  if (!["aplat", "texture", "catalogue"].includes(nuancier)) throw new Error("--nuancier aplat | texture | catalogue");

  // 2) Référence du moteur, planche, prompt (V2 + C1), masque troué.
  const reference = compenser ? referenceCompensee(await referenceMoteur(ref.id), cible.hex) : await referenceMoteur(ref.id);
  const zones = etiquettesPour([{ zone, reference }]);
  const vignette = await imageEchantillon(ref.id);
  const tuile = nuancier === "aplat" ? await tuileAplat(cible.hex) : nuancier === "texture" ? (await tuileRecoloree(vignette, cible.hex)).image : vignette;
  const planche = await construirePlanche(
    zones.map((z) => ({ etiquette: `${z.etiquette} · ${ZONES_SIMULATEUR[z.zone].libelle}`, ref: ref.id, nom: ref.nom, resume: resumerTeinte({ ...ref }, reference.couleur ?? null), image: tuile })),
    "CoverSwap · Cuisine"
  );
  const cadre = fs.readFileSync(cheminCadre(photo));
  const meta = await sharp(cadre).metadata();
  const base = construirePrompt({ piece: "cuisine", zones, analyse: null, format: formatDepuisDimensions(meta.width!, meta.height!), mode: "api-planche", defautsPrecedents: [] });
  const { prompt } = await variante("c1").appliquer({ prompt: base.texte, blocs: base.blocs, reference, ref, zone, photo, masque: { zone, polygones: [] }, planche });
  const troue = await masqueTroueDepuisPolygones(cadre, masqueRendu.polygones);
  const masquePng = await masqueOpenAI(troue.peindre, troue.largeur, troue.hauteur);

  const cle = `${phase}-${photo}-${ref.id}-t${tour}-${nuancier}-${choixMasque}-${cible.hex.slice(1)}`;
  const dossier = path.join(RACINE, "preparations", cle);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, "prompt.txt"), prompt);
  fs.writeFileSync(path.join(dossier, "planche.png"), planche);
  fs.writeFileSync(path.join(dossier, "masque.png"), masquePng);
  const enveloppe = enveloppeDe(phase);
  const ok = autoriserAppel(journal, enveloppe, ESTIMATION_RENDU, cle);
  console.log(`${photo} × ${ref.id} (${ref.nom}, ${famille}) — ${phase} tour ${tour}, zone ${zone}, masque ${choixMasque}, nuancier ${nuancier}.`);
  console.log(`  cible d'entrée ${cible.hex} (catalogue ${ref.hex}) — ${cible.source}.`);
  console.log(`  estimé ${ESTIMATION_RENDU.toFixed(4)} $ ; ${ok.ok ? "autorisé" : `REFUSÉ : ${ok.raison}`}. ${ligneCumul(journal, enveloppe)}.`);
  if (!args.includes("--payer")) {
    console.log(`  (préparation seule, aucun appel : ${dossier})`);
    return;
  }
  if (!ok.ok) {
    process.exitCode = 2;
    return;
  }
  const fichierCle = valeur("--cle-depuis");
  const cleApi = fichierCle ? /^OPENAI_API_KEY=["']?([^"'\s]+)/m.exec(fs.readFileSync(fichierCle, "utf8"))?.[1] : undefined;
  if (!cleApi) throw new Error("OPENAI_API_KEY absente (--cle-depuis) : rien n'est lancé.");

  // 3) L'appel /images/edits : photo, planche, masque troué.
  const formulaire = new FormData();
  formulaire.append("model", MODELE);
  formulaire.append("prompt", prompt);
  formulaire.append("size", `${meta.width}x${meta.height}`);
  formulaire.append("quality", "medium");
  formulaire.append("output_format", "jpeg");
  formulaire.append("output_compression", "90");
  formulaire.append("image[]", new Blob([new Uint8Array(cadre)], { type: "image/png" }), "room.png");
  formulaire.append("image[]", new Blob([new Uint8Array(planche)], { type: "image/png" }), "board.png");
  formulaire.append("mask", new Blob([new Uint8Array(masquePng)], { type: "image/png" }), "mask.png");
  let erreur: string | null = null;
  let usage: Usage | null = null;
  let fichier: string | null = null;
  try {
    const reponse = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${cleApi}` }, body: formulaire, signal: AbortSignal.timeout(240_000) });
    const texte = await reponse.text();
    if (!reponse.ok) erreur = `HTTP ${reponse.status} ${texte.slice(0, 200)}`;
    else {
      const d = JSON.parse(texte) as { data?: { b64_json?: string }[]; usage?: { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; input_tokens?: number; output_tokens?: number } };
      const det = d.usage?.input_tokens_details;
      usage = { texte: det?.text_tokens ?? (det ? 0 : (d.usage?.input_tokens ?? 0)), image: det?.image_tokens ?? 0, sortie: d.usage?.output_tokens ?? 0 };
      const b64 = d.data?.[0]?.b64_json;
      if (!b64) erreur = "réponse sans image";
      else {
        fichier = `${String((journal.appels.at(-1)?.n ?? 0) + 1).padStart(3, "0")}-${cle}.jpg`;
        await sharp(Buffer.from(b64, "base64")).jpeg({ quality: 92 }).toFile(path.join(RENDUS, fichier));
      }
    }
  } catch (e) {
    erreur = `réseau : ${e instanceof Error ? e.message : String(e)}`;
  }
  const cout = usage ? coutEnDollars(usage, MODELE) : 0;

  // 4) La mesure : score de la mission 24 (masque dessiné s'il existe, sinon le masque automatique), décalage restant,
  //    cible proposée pour le tour suivant ; puis la correction L3 par-dessus.
  let mesure: Record<string, unknown> | null = null;
  if (fichier) {
    const pourScore = dessine ? await masqueTroueDepuisPolygones(cadre, dessine.polygones) : troue;
    const vers255 = (m: Uint8Array) => Uint8Array.from(m, (v) => (v ? 255 : 0));
    const noter = (f: string) => scorer(cheminCadre(photo), f, vers255(pourScore.peindre), pourScore.largeur, pourScore.hauteur, ref, vers255(pourScore.zone));
    const s = await noter(path.join(RENDUS, fichier));
    const restant = decalageDe(labDeHex(s.couleur.mesure), labDeHex(ref.hex));
    const prochaine = compenser ? ajusterCible(ref.hex, cible.hex, restant) : null;
    const l3 = await corrigerTeintes({ avant: cheminCadre(photo), apres: path.join(RENDUS, fichier), zones: [{ zone, ref: ref.id }], references: [{ ref: ref.id, nom: ref.nom, hex: ref.hex, classe: classeTexture(ref) }] });
    const fichierL3 = fichier.replace(/\.jpg$/, "-l3.jpg");
    fs.writeFileSync(path.join(RENDUS, fichierL3), l3.image);
    const sL3 = await noter(path.join(RENDUS, fichierL3));
    mesure = { ref: ref.id, famille, tour, cible: cible.hex, nuancier, masque: choixMasque, scoreMasque: dessine ? "dessine" : "auto", score: s, restant, prochaineCible: prochaine?.hex ?? null, l3: { etat: l3.fidelite[0]?.etat, deltaE: sL3.couleur.deltaE, chromatique: sL3.couleur.chromatique, score: sL3.total } };
  }
  const r = inscrireAppel(lireJournalCampagne(), { le: new Date().toISOString(), phase, enveloppe, type: "rendu", modele: MODELE, cle, estimation: ESTIMATION_RENDU, cout, usage: usage ? { texte: usage.texte, image: usage.image, sortie: usage.sortie } : null, erreur, fichier, mesure });
  ecrireJournalCampagne(r.journal);
  if (erreur) console.log(`ÉCHEC ${erreur} (rejouable une fois).`);
  else {
    const m = mesure as { score: { total: number; couleur: { deltaE: number; chromatique: number; mesure: string } }; restant: { dL: number; da: number; db: number; dC: number }; prochaineCible: string | null; l3: { deltaE: number; etat: string } };
    console.log(`n°${r.appel.n} : ${cout.toFixed(4)} $ réels. Score ${m.score.total} ; ΔE ${m.score.couleur.deltaE} (à clarté égale ${m.score.couleur.chromatique}), mesuré ${m.score.couleur.mesure} ; reste dL ${m.restant.dL} da ${m.restant.da} db ${m.restant.db} dC ${m.restant.dC}${m.prochaineCible ? ` ; cible proposée au tour suivant ${m.prochaineCible}` : ""} ; après L3 (${m.l3.etat}) ΔE ${m.l3.deltaE}.`);
  }
  console.log(ligneCumul(r.journal, enveloppe));
  if (r.arret) console.log(`ARRÊT DE LA CAMPAGNE : ${r.journal.arret?.raison}.`);
}

void main().catch((e) => {
  console.error("[sunburst-23]", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
