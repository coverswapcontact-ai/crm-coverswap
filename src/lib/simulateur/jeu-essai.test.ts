import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
const UPLOADS = mkdtempSync(path.join(tmpdir(), "coverswap-jeu-essai-"));
process.env.UPLOADS_DIR = UPLOADS;
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "RESEND_API_KEY", "OPENAI_API_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";

/**
 * Mission 23 (L1) — l'export du jeu d'essai du simulateur : les simulations du site (rattachées ou non) et des espaces,
 * un doublon synchronisé compté une fois, les lignes illisibles ignorées et comptées, la pièce d'exemple marquée, le
 * plafond N, le modèle retrouvé au mieux ; le zip relu par un lecteur minimal (répertoire central, CRC) ; aucune donnée
 * de contact dans ses octets ; la route (200, en-têtes, bornes de n, trace) et l'action « agir_systeme ».
 * Images synthétiques faites par sharp, noms fictifs, base d'essai, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let jeuEssai: typeof import("./jeu-essai");
let zip: typeof import("@/lib/exports/zip");
let sharp: typeof import("sharp");
const fetchOriginal = globalThis.fetch;
const appelsReseau: string[] = [];
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const H = 3_600_000;
const MAINTENANT = new Date();
const il = (ms: number) => new Date(MAINTENANT.getTime() - ms);

// Le contact semé : aucune de ces chaînes ne doit se retrouver dans le zip.
const CONTACT = { nom: "Zephyrinessai", prenom: "Bartholomeo", email: "zephyrin.bartho@exemple-essai.fr", telephone: "0611223344", ville: "Castelnau-Essaiville", ip: "203.0.113.77", parcours: "parcours-secret-xyz", commentaire: "Commentaire tres personnel du client" };
const ids: Record<string, string> = {};

async function image(relatif: string, rouge: number, format: "jpeg" | "png" = "jpeg"): Promise<Buffer> {
  const octets = await sharp({ create: { width: 48, height: 32, channels: 3, background: { r: rouge, g: 120, b: 90 } } })[format]().toBuffer();
  const absolu = path.join(UPLOADS, relatif);
  mkdirSync(path.dirname(absolu), { recursive: true });
  writeFileSync(absolu, octets);
  return octets;
}

/** Lecteur minimal : fin de répertoire, répertoire central, en-têtes locaux, CRC recalculés par la table. */
function lireZip(octets: Buffer): { nom: string; contenu: Buffer }[] {
  const fin = octets.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fin >= 0, "fin de répertoire introuvable");
  const nombre = octets.readUInt16LE(fin + 10);
  const tailleCentral = octets.readUInt32LE(fin + 12);
  let p = octets.readUInt32LE(fin + 16);
  assert.equal(p + tailleCentral, fin, "le répertoire central finit où commence la fin de répertoire");
  const sortie: { nom: string; contenu: Buffer }[] = [];
  for (let i = 0; i < nombre; i++) {
    assert.equal(octets.readUInt32LE(p), 0x02014b50);
    assert.equal(octets.readUInt16LE(p + 10), 0, "stored");
    const crc = octets.readUInt32LE(p + 16);
    const taille = octets.readUInt32LE(p + 20);
    assert.equal(octets.readUInt32LE(p + 24), taille);
    const longueurNom = octets.readUInt16LE(p + 28);
    const local = octets.readUInt32LE(p + 42);
    const nom = octets.subarray(p + 46, p + 46 + longueurNom).toString("utf8");
    assert.equal(octets.readUInt32LE(local), 0x04034b50);
    assert.equal(octets.readUInt32LE(local + 14), crc, `CRC local = central (${nom})`);
    const debut = local + 30 + octets.readUInt16LE(local + 26) + octets.readUInt16LE(local + 28);
    const contenu = octets.subarray(debut, debut + taille);
    assert.equal(zip.crc32Table(contenu), crc, `CRC juste (${nom})`);
    sortie.push({ nom, contenu: Buffer.from(contenu) });
    p += 46 + longueurNom + octets.readUInt16LE(p + 30) + octets.readUInt16LE(p + 32);
  }
  return sortie;
}

async function toutLire(flux: ReadableStream<Uint8Array>): Promise<Buffer> {
  const morceaux: Uint8Array[] = [];
  const lecteur = flux.getReader();
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    morceaux.push(value);
  }
  return Buffer.concat(morceaux);
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    appelsReseau.push(url);
    throw new Error(`réseau coupé pendant les essais : ${url}`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  jeuEssai = await import("./jeu-essai");
  zip = await import("@/lib/exports/zip");
  sharp = (await import("sharp")).default;

  const references = JSON.stringify([{ zone: "facades", libelle: "Façades", ref: "RM30", nom: "Vert de gris" }]);
  // 1. Site, non rattachée (il y a 1 h, 40 s de génération) ; sa génération est à 10 s de la fin, une autre bien avant.
  await image("site/p1/s1/avant.jpg", 200);
  await image("site/p1/s1/apres.png", 60, "png");
  ids.s1 = (await prisma.simulationSite.create({ data: { createdAt: il(H), parcoursId: "p1", projet: "cuisine", references, imageBeforePath: "site/p1/s1/avant.jpg", imageAfterPath: "site/p1/s1/apres.png", dureeMs: 40_000, moteur: "V1", promptTexte: "Repaint the cabinet fronts", scoreControle: 7, defautsControle: JSON.stringify([{ type: "teinte", detail: "trop vert" }]), tentatives: 1 } })).id;
  await prisma.generationImage.create({ data: { createdAt: il(H + 10_000), origine: "SITE", modele: "gpt-image-2.5-sunburst", phase: "rendu", statut: "REUSSI", dureeMs: 30_000 } });
  await prisma.generationImage.create({ data: { createdAt: il(H + 5 * 60_000), origine: "SITE", modele: "gpt-image-1", phase: "rendu", statut: "REUSSI", dureeMs: 30_000 } });

  // 2. Site, rattachée à un lead nommé : les fichiers sont sur la Simulation du lead, les chemins du site à null.
  const lead = await prisma.lead.create({ data: { nom: CONTACT.nom, prenom: CONTACT.prenom, email: CONTACT.email, telephone: CONTACT.telephone, ville: CONTACT.ville, codePostal: "34170", ipOrigine: CONTACT.ip } });
  ids.lead = lead.id;
  await image(`${lead.id}/sim/before.jpg`, 180);
  await image(`${lead.id}/sim/after.jpg`, 40);
  const simulation = await prisma.simulation.create({ data: { leadId: lead.id, imageBeforePath: `${lead.id}/sim/before.jpg`, imageAfterPath: `${lead.id}/sim/after.jpg`, notes: `Simulation de ${CONTACT.prenom} ${CONTACT.nom}` } });
  ids.simulation = simulation.id;
  ids.s2 = (await prisma.simulationSite.create({ data: { createdAt: il(2 * H), parcoursId: CONTACT.parcours, projet: "salle-de-bain", references, leadId: lead.id, simulationId: simulation.id, rattacheeLe: il(2 * H), ipOrigine: CONTACT.ip, moteur: "V2", scoreControle: 9, tentatives: 2 } })).id;

  // … et recopiée dans l'espace du dossier (synchroniserSimulationsSite) : un doublon, compté une fois.
  const dossier = await prisma.dossier.create({ data: { clientNom: `${CONTACT.prenom} ${CONTACT.nom}`, clientAdresse: "12 rue des Essais", clientCp: "34170", clientVille: CONTACT.ville, clientTelephone: CONTACT.telephone, clientEmail: CONTACT.email, objet: "Cuisine", source: "ENTRANT", leadId: lead.id } });
  ids.dossier = dossier.id;
  const espace = await prisma.espaceClient.create({ data: { code: `jeu${Date.now().toString(36)}`, dossierId: dossier.id, expireLe: new Date(MAINTENANT.getTime() + 60 * 24 * H) } });
  ids.espace = espace.id;
  ids.doublon = (await prisma.simulationEspace.create({ data: { createdAt: il(2 * H - 60_000), espaceId: espace.id, dossierId: dossier.id, chemin: simulation.imageAfterPath!, photoAvant: simulation.imageBeforePath, source: "SITE", simulationId: simulation.id, zones: references, titre: `Pour ${CONTACT.prenom}`, commentaireClient: CONTACT.commentaire } })).id;

  // 3. Espace, générée par le CRM : le modèle se retrouve par la préparation.
  await image(`dossiers/${dossier.id}/simulations/avant-e1.jpg`, 220);
  await image(`dossiers/${dossier.id}/simulations/rendu-e1.jpg`, 20);
  ids.e1 = (await prisma.simulationEspace.create({ data: { createdAt: il(3 * H), espaceId: espace.id, dossierId: dossier.id, chemin: `dossiers/${dossier.id}/simulations/rendu-e1.jpg`, photoAvant: `dossiers/${dossier.id}/simulations/avant-e1.jpg`, source: "API", typeSurface: "cuisine", zones: references, preparationId: "prep-essai-1", moteur: "V2", scoreControle: 8, tentatives: 1, commentaireClient: CONTACT.commentaire } })).id;
  await prisma.generationImage.create({ data: { createdAt: il(3 * H + 5_000), origine: "ESPACE", modele: "gpt-image-2.5-flare", phase: "rendu", statut: "REUSSI", dureeMs: 20_000, preparationId: "prep-essai-1", dossierId: dossier.id } });

  // 4. Site sans rendu (la plus récente) : ignorée, comptée.
  ids.s3 = (await prisma.simulationSite.create({ data: { createdAt: il(30 * 60_000), parcoursId: "p3", projet: "cuisine", references } })).id;

  // 5. La pièce d'exemple du site : marquée.
  await image("site/p4/s4/avant.jpg", 100);
  await image("site/p4/s4/apres.jpg", 140);
  ids.s4 = (await prisma.simulationSite.create({ data: { createdAt: il(4 * H), parcoursId: "p4", projet: "cuisine", references, imageBeforePath: "site/p4/s4/avant.jpg", imageAfterPath: "site/p4/s4/apres.jpg", exemple: "cuisine-exemple-1", moteur: "V1" } })).id;

  // 6. Espace dont la photo avant manque sur le disque : ignorée, comptée.
  await image(`dossiers/${dossier.id}/simulations/rendu-e2.jpg`, 90);
  ids.e2 = (await prisma.simulationEspace.create({ data: { createdAt: il(5 * H), espaceId: espace.id, dossierId: dossier.id, chemin: `dossiers/${dossier.id}/simulations/rendu-e2.jpg`, photoAvant: `dossiers/${dossier.id}/simulations/disparue.jpg`, source: "CHATGPT" } })).id;
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau (ni OpenAI ni autre)");
  await prisma.$disconnect();
});

describe("zip « stored » maison", () => {
  test("CRC32 : Node et la table donnent la valeur de référence ; un zip relu rend ses fichiers à l'octet", async () => {
    assert.equal(zip.crc32Table(Buffer.from("123456789")), 0xcbf43926);
    assert.equal(zip.crc32(Buffer.from("123456789")), 0xcbf43926);
    const hasard = randomBytes(70_000);
    assert.equal(zip.crc32(hasard), zip.crc32Table(hasard));
    const octets = await zip.zipEnMemoire([
      { nom: "a.txt", contenu: Buffer.from("bonjour") },
      { nom: "dossier/é.bin", contenu: async () => hasard },
      { nom: "vide.txt", contenu: Buffer.alloc(0) },
    ]);
    const lus = lireZip(octets);
    assert.deepEqual(lus.map((f) => f.nom), ["a.txt", "dossier/é.bin", "vide.txt"]);
    assert.ok(lus[1].contenu.equals(hasard));
    assert.equal(lus[0].contenu.toString(), "bonjour");
  });
});

describe("collecterJeuEssai", () => {
  test("site non rattachée et rattachée, espace, doublon compté une fois, lignes illisibles ignorées et comptées, exemple marqué, modèle au mieux", async () => {
    const jeu = await jeuEssai.collecterJeuEssai({ maintenant: MAINTENANT });
    const m = jeu.manifeste;
    assert.equal(m.nDemande, 150);
    assert.equal(m.nExporte, 4);
    assert.deepEqual(m.parOrigine, { site: 3, espace: 1 });
    assert.deepEqual(m.ignorees, { total: 2, parRaison: { "sans-avant": 0, "avant-illisible": 1, "sans-rendu": 1, "rendu-illisible": 0 } });
    assert.equal(m.doublonsEcartes, 1);
    const parId = new Map(jeu.simulations.map((s) => [s.meta.id, s]));
    assert.deepEqual(jeu.simulations.map((s) => s.meta.id), [ids.s1, ids.s2, ids.e1, ids.s4].map(jeuEssai.idOpaque), "du plus récent au plus ancien");
    assert.match(jeuEssai.idOpaque(ids.s1), /^[0-9a-f]{12}$/);
    const s1 = parId.get(jeuEssai.idOpaque(ids.s1))!.meta;
    assert.deepEqual([s1.origine, s1.projet, s1.moteur, s1.modele, s1.modeleSource, s1.scoreControle, s1.tentatives, s1.dureeMs, s1.exemple, s1.fichiers.rendu], ["site", "cuisine", "V1", "gpt-image-2.5-sunburst", "horodatage", 7, 1, 40_000, false, "rendu.png"]);
    assert.deepEqual(s1.zones, [{ zone: "facades", libelle: "Façades", ref: "RM30", nom: "Vert de gris" }]);
    assert.deepEqual(s1.defautsControle, [{ type: "teinte", detail: "trop vert" }]);
    const s2 = parId.get(jeuEssai.idOpaque(ids.s2))!;
    assert.equal(s2.rendu, `${ids.lead}/sim/after.jpg`, "rattachée : les images se lisent sur la Simulation du lead");
    assert.deepEqual([s2.meta.modele, s2.meta.modeleSource, s2.meta.projet], [null, "inconnu", "salle-de-bain"]);
    const e1 = parId.get(jeuEssai.idOpaque(ids.e1))!.meta;
    assert.deepEqual([e1.origine, e1.typeSurface, e1.source, e1.modele, e1.modeleSource], ["espace", "cuisine", "API", "gpt-image-2.5-flare", "preparation"]);
    assert.equal(parId.get(jeuEssai.idOpaque(ids.s4))!.meta.exemple, true);
    assert.ok(!parId.has(jeuEssai.idOpaque(ids.doublon)), "le doublon synchronisé n'est pas repris");
  });

  test("le plafond N : les N plus récentes lisibles, les illisibles rencontrées avant comptées", async () => {
    const jeu = await jeuEssai.collecterJeuEssai({ n: 2, maintenant: MAINTENANT });
    assert.deepEqual(jeu.simulations.map((s) => s.meta.id), [ids.s1, ids.s2].map(jeuEssai.idOpaque));
    assert.deepEqual([jeu.manifeste.nDemande, jeu.manifeste.nExporte, jeu.manifeste.ignorees.total], [2, 2, 1]);
    assert.equal((await jeuEssai.collecterJeuEssai({ n: 1, maintenant: il(90 * 60_000) })).simulations[0].meta.id, jeuEssai.idOpaque(ids.s2), "rien d'après « maintenant »");
  });

  test("le zip : manifest.json puis avant, rendu, meta.json par simulation ; CRC justes ; aucune donnée de contact dans les octets", async () => {
    const jeu = await jeuEssai.collecterJeuEssai({ maintenant: MAINTENANT });
    const octets = await toutLire(jeuEssai.fluxJeuEssai(jeu));
    const fichiers = lireZip(octets);
    const noms = fichiers.map((f) => f.nom);
    assert.equal(noms[0], "manifest.json");
    assert.equal(noms.length, 1 + 3 * 4);
    const i1 = jeuEssai.idOpaque(ids.s1);
    assert.deepEqual(noms.slice(1, 4), [`${i1}/avant.jpg`, `${i1}/rendu.png`, `${i1}/meta.json`]);
    assert.ok(fichiers[1].contenu.equals(readFileSync(path.join(UPLOADS, "site/p1/s1/avant.jpg"))));
    assert.ok(fichiers[2].contenu.equals(readFileSync(path.join(UPLOADS, "site/p1/s1/apres.png"))));
    const manifeste = JSON.parse(fichiers[0].contenu.toString("utf8")) as { format: number; nExporte: number };
    assert.deepEqual([manifeste.format, manifeste.nExporte], [1, 4]);
    const meta = JSON.parse(fichiers[3].contenu.toString("utf8")) as Record<string, unknown>;
    for (const cle of ["leadId", "parcoursId", "dossierId", "espaceId", "ipOrigine", "commentaireClient", "simulationId", "preparationId", "imageBeforePath", "chemin"]) assert.ok(!(cle in meta), cle);

    const interdites = [CONTACT.nom, CONTACT.prenom, CONTACT.email, CONTACT.telephone, CONTACT.ville, CONTACT.ip, CONTACT.parcours, CONTACT.commentaire, ids.lead, ids.dossier, ids.espace, ids.simulation, ids.s1, ids.s2, ids.e1, ids.s4, "prep-essai-1", UPLOADS, "site/p1/s1", "/sim/", "simulations/rendu-e1"];
    for (const chaine of interdites) {
      for (const codage of ["utf8", "utf16le"] as const) assert.equal(octets.indexOf(Buffer.from(chaine, codage)), -1, `« ${chaine} » (${codage}) ne doit pas être dans le zip`);
    }
  });
});

describe("GET /api/simulateur/jeu-essai et « agir_systeme » EXPORTER_JEU_ESSAI", () => {
  test("la route : 200, zip en pièce jointe, no-store ; n hors bornes → 400 ; chaque export tracé (qui, quand, combien)", async () => {
    const { GET } = await import("@/app/api/simulateur/jeu-essai/route");
    const { NextRequest } = await import("next/server");
    const { avecActeur } = await import("@/lib/journal/contexte");
    const appeler = (requete: string) => avecActeur(LUCAS, () => GET(new NextRequest(`http://localhost:3001/api/simulateur/jeu-essai${requete}`)));
    const reponse = await appeler("?n=3");
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("content-type"), "application/zip");
    assert.match(reponse.headers.get("content-disposition") ?? "", /^attachment; filename="jeu-essai-simulateur-\d{4}-\d{2}-\d{2}\.zip"$/);
    assert.equal(reponse.headers.get("cache-control"), "no-store");
    const fichiers = lireZip(Buffer.from(await reponse.arrayBuffer()));
    assert.equal(fichiers.length, 1 + 3 * 3);
    for (const n of ["0", "301", "abc", "2.5"]) assert.equal((await appeler(`?n=${n}`)).status, 400, `n=${n}`);
    const traces = await prisma.appelOutil.findMany({ where: { sessionId: "ECRAN", outil: "export_jeu_essai" } });
    assert.equal(traces.length, 1, "seul l'export réussi est tracé");
    assert.equal(traces[0].commande, LUCAS.acteur);
    assert.match(traces[0].resume ?? "", /^export de 3 simulations \(site 2, espace 1\) sur 3 demandées, 1 ignorée$/);
    assert.equal((await appeler("")).status, 200, "sans n : 150 par défaut");
  });

  test("l'action rend les simulations disponibles par origine, le lien absolu de la route et les derniers exports ; elle ne rend pas le zip ; l'empreinte ne bouge pas", async () => {
    const execution = await import("@/lib/assistant/execution");
    const { outilAgirSysteme } = await import("@/lib/assistant/outils/gestes");
    const session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
    const r: ResultatOutil = await execution.executerOutil(outilAgirSysteme as unknown as DefinitionOutil, { action: "EXPORTER_JEU_ESSAI" }, session, new Date());
    assert.ok(!r.confirmation, r.texte);
    assert.equal(r.liens?.[0].href, "http://localhost:3001/api/simulateur/jeu-essai?n=150");
    const d = r.donnees as { disponibles: { site: number; espace: number }; derniersExports: { par: string | null }[] };
    assert.deepEqual(d.disponibles, { site: 4, espace: 2 });
    assert.equal(d.derniersExports[0]?.par, LUCAS.acteur);
    assert.match(r.texte, /4 du site, 2 des espaces/);
    assert.ok(!r.images?.length, "pas de zip dans le résultat");
    const { registreOutils } = await import("@/lib/assistant/couverture");
    const registre = registreOutils();
    assert.deepEqual([registre.nombre, registre.empreinte], [53, "6665a6b457fe"]);
  });
});
