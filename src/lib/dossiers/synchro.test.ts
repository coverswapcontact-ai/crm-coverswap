import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-synchro-"));

/**
 * Mission 18 (B0) : le point d'entrée unique (dossiers/synchro.ts). Une prochaine action posée à la main n'est jamais
 * écrasée par un événement automatique (une tâche à la place, une seule même si l'événement est rejoué) ; la main est
 * écrite dans la transaction de l'événement ; un changement d'étape écrit la main et le statut du lead dans la sienne.
 * Chaque cas se lit des deux côtés (`etatDesDeuxCotes`, src/test/etat-dossier.ts) : étape, main, prochaine action,
 * étape de l'espace, relances, tâches.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let transitions: typeof import("./transitions");
let synchro: typeof import("./synchro");
let auto: typeof import("./prochaine-action-auto");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = (nom = "cuisine.jpg") => new File([new Uint8Array(JPEG)], nom, { type: "image/jpeg" });
const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
const devisDe = (objet: string, notifier = false) => documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier });

async function contact(prenom: string, email?: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...(email ? { email } : {}) } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espace: ouvert.espace, nom: `${prenom} Essai` };
}
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const tachesSynchro = (dossierId: string) => prisma.tacheAFaire.findMany({ where: { cle: { startsWith: `${auto.PREFIXE_TACHE_SYNCHRO}${dossierId}:` } } });
/** Lucas pose la prochaine action à la main (écran du dossier). */
const poserALaMain = (dossierId: string, prochaineAction: string) => avecActeur(LUCAS, () => dossiers.modifierDossier(dossierId, { prochaineAction }));

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  transitions = await import("./transitions");
  synchro = await import("./synchro");
  auto = await import("./prochaine-action-auto");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("prochaine action automatique (mission 18, B0)", () => {
  test("photos du client, rien de posé à la main : la prochaine action suit, la main me revient — des deux côtés", async () => {
    const c = await contact("Sans");
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([avant.etape, avant.prochaineAction, avant.etapeEspace], ["QUALIFICATION", "Attendre les photos du client", "PHOTOS"]);

    await service.deposerPhotos(c.espace, [photo()]);
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.equal(apres.etape, "QUALIFICATION");
    assert.deepEqual([apres.main, apres.mainCalculee, apres.mainMotif], ["MOI", "MOI", "Photos reçues dans son espace"]);
    assert.equal(apres.prochaineAction, "Préparer la simulation (photos reçues)");
    assert.equal(apres.actionManuelle, null);
    assert.equal(apres.statutLead, "CONTACTE");
    assert.notEqual(apres.etapeEspace, "PHOTOS", "l'espace passe à l'étape suivante");
    assert.deepEqual(apres.relances, { proposables: [], devis: [] });
    assert.equal(apres.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)).length, 0, "rien de gardé : pas de tâche à la place");
  });

  test("action posée à la main puis photos du client : le texte est gardé, UNE tâche le dit, même si l'événement est rejoué", async () => {
    const c = await contact("Gardee");
    const ecrite = "Attendre les photos du client : il les envoie ce soir";
    await poserALaMain(c.dossierId, ecrite);
    assert.equal((await dossierDe(c.dossierId)).prochaineActionManuelle, ecrite);

    await service.deposerPhotos(c.espace, [photo("une.jpg")]);
    await service.deposerPhotos(c.espace, [photo("deux.jpg")]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "QUALIFICATION");
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], [ecrite, ecrite], "jamais écrasée");
    assert.deepEqual([etat.main, etat.mainCalculee], ["MOI", "MOI"], "les photos sont plus récentes que l'action posée : la main me revient");
    assert.notEqual(etat.etapeEspace, "PHOTOS");
    assert.deepEqual(etat.relances.proposables, []);
    const gardees = etat.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO));
    assert.equal(gardees.length, 1, "une seule tâche, l'événement rejoué n'en crée pas d'autre");
    assert.deepEqual(
      [gardees[0].cle, gardees[0].type, gardees[0].titre, gardees[0].raison, gardees[0].statut, gardees[0].niveau],
      [auto.cleTacheSynchro(c.dossierId, "photos"), "MANUELLE", `Préparer la simulation (photos reçues) · ${c.nom}`, `ta prochaine action « ${ecrite} » est gardée`, "A_FAIRE", 2]
    );

    // Une seconde passe ne la coche pas (une tâche à moi n'est jamais cochée par absence).
    assert.equal((await etatDesDeuxCotes(c.dossierId)).taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)).length, 1);

    // Faite par Lucas, puis de nouvelles photos : c'est un nouveau besoin, la même tâche revient (toujours une seule).
    await prisma.tacheAFaire.update({ where: { cle: gardees[0].cle }, data: { statut: "FAITE", reponse: "FAIT", reponduLe: new Date(), reponduPar: LUCAS.acteur } });
    await service.deposerPhotos(c.espace, [photo("trois.jpg")]);
    const lignes = await tachesSynchro(c.dossierId);
    assert.deepEqual(lignes.map((t) => [t.statut, t.reponse]), [["A_FAIRE", null]]);
    assert.equal((await dossierDe(c.dossierId)).prochaineAction, ecrite);
  });

  test("devis émis : « Préparer le devis » posé par l'espace devient « Attendre l'accord » ; posé à la main, il reste, sans tâche (une attente du client)", async () => {
    // Mission 18 (B1) : devis annoncés (adresse, espace ouvert, notification) : ils sont envoyés.
    const parLEspace = await contact("Espace", "espace.synchro@example.test");
    await prisma.dossier.update({ where: { id: parLEspace.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
    await avecActeur(LUCAS, () => documents.genererDocument(parLEspace.dossierId, devisDe("Recouvrement cuisine", true)));
    const remplacee = await etatDesDeuxCotes(parLEspace.dossierId);
    assert.equal(remplacee.prochaineAction, "Attendre l'accord du client sur le devis");
    assert.equal(remplacee.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)).length, 0);
    assert.equal(remplacee.main, remplacee.mainCalculee, "la main écrite est celle de la règle");

    const alaMain = await contact("Main", "main.synchro@example.test");
    const ecrite = "Préparer le devis avec le plan de travail en option";
    await poserALaMain(alaMain.dossierId, ecrite);
    await avecActeur(LUCAS, () => documents.genererDocument(alaMain.dossierId, devisDe("Recouvrement cuisine", true)));
    const gardee = await etatDesDeuxCotes(alaMain.dossierId);
    assert.deepEqual([gardee.prochaineAction, gardee.actionManuelle], [ecrite, ecrite]);
    assert.equal(gardee.main, gardee.mainCalculee);
    // Relecture : « Attendre l'accord » n'a rien à faire de mon côté (la main passe au client) — aucune tâche rangée à la place.
    assert.deepEqual(gardee.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)), []);
    // L'étape et l'espace suivent le devis envoyé, action posée à la main ou non : les deux dossiers sont au même point.
    assert.deepEqual([gardee.etape, gardee.etapeEspace], [remplacee.etape, remplacee.etapeEspace]);
    assert.equal(gardee.etape, "DEVIS_ENVOYE");
  });

  test("ce qui ne pose rien : condition non remplie, effacement ou même texte sur une action posée à la main ; une tâche archivée ou reportée n'est pas forcée", async () => {
    const c = await contact("Regles");
    const ecrite = "Rappeler pour le coloris";
    await poserALaMain(c.dossierId, ecrite);
    const ecrire = (voulu: import("./prochaine-action-auto").ProchaineActionAuto) => prisma.$transaction((tx) => auto.ecrireProchaineActionAuto(tx, c.dossierId, voulu));
    assert.equal(await ecrire({ code: "essai", texte: "Autre chose", si: () => false }), "SANS_OBJET");
    assert.equal(await ecrire({ code: "essai", texte: null }), "INCHANGEE", "une action posée à la main ne s'efface pas toute seule");
    assert.equal(await ecrire({ code: "essai", texte: ecrite }), "INCHANGEE");
    assert.equal((await tachesSynchro(c.dossierId)).length, 0);

    assert.equal(await ecrire({ code: "essai", texte: "Préparer la simulation" }), "GARDEE");
    const cle = auto.cleTacheSynchro(c.dossierId, "essai");
    await prisma.tacheAFaire.update({ where: { cle }, data: { statut: "PLUS_TARD", reponse: "PLUS_TARD", plusTardJusqua: new Date(Date.now() + 86_400_000), reponduLe: new Date(), reponduPar: LUCAS.acteur } });
    assert.equal(await ecrire({ code: "essai", texte: "Préparer la simulation" }), "GARDEE");
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } })).statut, "PLUS_TARD", "le report de Lucas tient");
    await prisma.tacheAFaire.update({ where: { cle }, data: { statut: "FAITE", archiveLe: new Date() } });
    assert.equal(await ecrire({ code: "essai", texte: "Préparer la simulation" }), "GARDEE");
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } })).statut, "FAITE", "archivée : plus touchée");
    assert.equal((await dossierDe(c.dossierId)).prochaineAction, ecrite);

    // Sans action posée à la main, le texte s'écrit (et s'efface).
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineActionManuelle: null, prochaineActionManuelleLe: null, prochaineActionPar: null } });
    assert.equal(await ecrire({ code: "essai", texte: null, date: null }), "ECRITE");
    assert.equal((await dossierDe(c.dossierId)).prochaineAction, null);
  });
});

describe("la main et le statut du lead dans la transaction (mission 18, B0)", () => {
  test("un changement d'étape écrit la main et le statut du lead AVANT la fin de sa transaction", async () => {
    const c = await contact("Etape");
    await prisma.lead.update({ where: { id: c.leadId }, data: { statut: "CONTACTE" } });
    const vu = await prisma.$transaction(async (tx) => {
      await transitions.changerEtapeDansTransaction(tx, c.dossierId, { vers: "PERDU", motifPerte: "PRIX" });
      const dossier = await tx.dossier.findUniqueOrThrow({ where: { id: c.dossierId } });
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: c.leadId } });
      return { main: dossier.main, motif: dossier.mainMotif, statut: lead.statut };
    });
    assert.deepEqual(vu, { main: null, motif: "Dossier perdu", statut: "PERDU" });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.statutLead], ["PERDU", null, null, "PERDU"]);
    assert.deepEqual(etat.relances.proposables, []);

    // Le chemin de l'écran (changerEtape) : même résultat, et ses effets d'après ne réécrivent rien de faux.
    const d = await contact("Ecran");
    await transitions.changerEtape(d.dossierId, { vers: "SIMULATION" });
    const ecran = await etatDesDeuxCotes(d.dossierId, { taches: false });
    assert.deepEqual([ecran.etape, ecran.main, ecran.statutLead], ["SIMULATION", ecran.mainCalculee, "CONTACTE"]);
  });

  test("evenementDossier : la prochaine action et la main dans une seule transaction, l'agenda et les tâches après", async () => {
    const c = await contact("Accord");
    const suites = await synchro.evenementDossier(c.dossierId, { type: "ACCORD_RETIRE", auteur: "CLIENT" });
    assert.equal(suites.prochaineAction, "ECRITE");
    assert.ok(suites.main, "la main est écrite dans la transaction");
    const dossier = await dossierDe(c.dossierId);
    assert.deepEqual([dossier.prochaineAction, dossier.main, dossier.mainMotif], ["Appeler : il a retiré son bon pour accord", suites.main!.qui, suites.main!.motif]);
  });
});

describe("docs/SYNCHRO.md", () => {
  test("chaque événement du point d'entrée a sa ligne dans la matrice", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs", "SYNCHRO.md"), "utf8");
    for (const type of synchro.TYPES_EVENEMENT_DOSSIER) assert.ok(doc.includes(`\`${type}\``), `${type} absent de docs/SYNCHRO.md`);
  });
});
