import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-publier-espace-"));

/**
 * Mission 18 (B9, écart 9) : « Publier » depuis le bloc Espace a les mêmes effets que le bouton « Publier »
 * (`publierSimulations`) : Qualification → Simulation, prochaine action, main, agenda, mail automatique (une fois) ;
 * masquer, repasser en brouillon ou retirer une simulation choisie (la validée, ou une zone d'un mélange) annule le
 * choix ; une simulation du client (faite sur le site, rangée dans son espace) ou un choix validé font passer
 * Qualification → Simulation. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`). Rien ne part hors du poste.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let validations: typeof import("@/lib/espace/validations");
let simulations: typeof import("@/lib/simulations/dossier");
let dossiers: typeof import("./dossiers");
let transitions: typeof import("./transitions");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = (nom = "simulation.jpg") => new File([new Uint8Array(JPEG)], nom, { type: "image/jpeg" });

async function contact(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3363${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", email: `${prenom.toLowerCase()}.essai@example.test` } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, nom: `${prenom} Essai` };
}
/** L'espace relu (son choix change sous les gestes). */
const espaceDe = (dossierId: string) => prisma.espaceClient.findFirstOrThrow({ where: { dossierId } });
/** Un brouillon déposé par Lucas (le client ne le voit pas). */
const brouillon = (dossierId: string, titre: string) => avecActeur(LUCAS, async () => (await service.deposerSimulation(dossierId, photo(), { titre })).id);
/** Le bloc Espace du dossier : « Publier », « Masquer », « Brouillon », « Retirer » d'une simulation. */
const bloc = (dossierId: string, simulationId: string, action: "masquer" | "afficher" | "brouillon" | "retirer") => avecActeur(LUCAS, () => simulations.changerStatutSimulation(dossierId, simulationId, action));
const passages = (dossierId: string) => prisma.dossierEvenement.findMany({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { contenu: true, metadata: true } });
const mails = (simulationId: string) => prisma.envoiMail.count({ where: { cle: `notif:SIMULATION_PUBLIEE:${simulationId}` } });
/** L'état des deux côtés, sans ce qui nomme le client (pour comparer deux dossiers). */
const comparable = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>) => ({ ...etat, prochaineActionDate: null, taches: etat.taches.map((t) => [t.type, t.statut]) });

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  validations = await import("@/lib/espace/validations");
  simulations = await import("@/lib/simulations/dossier");
  dossiers = await import("./dossiers");
  transitions = await import("./transitions");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("« Publier » depuis le bloc Espace (mission 18, B9)", () => {
  test("mêmes effets que le bouton « Publier » : Qualification → Simulation, « Attendre le retour », main au client, lead CONTACTE, espace en SIMULATIONS, un seul mail", async () => {
    const parBouton = await contact("Bouton");
    const parBloc = await contact("Bloc");
    const a = await brouillon(parBouton.dossierId, "Chêne clair");
    const b = await brouillon(parBloc.dossierId, "Chêne clair");
    const avant = await etatDesDeuxCotes(parBloc.dossierId);
    assert.deepEqual([avant.etape, avant.etapeEspace], ["QUALIFICATION", "PHOTOS"]);

    await avecActeur(LUCAS, () => simulations.publierSimulations(parBouton.dossierId, [a], { prevenir: false }));
    const vue = await bloc(parBloc.dossierId, b, "afficher");
    assert.equal(vue?.statut, "PUBLIEE");

    // Côté CRM et côté client : le même état par les deux chemins.
    const etat = await etatDesDeuxCotes(parBloc.dossierId);
    assert.deepEqual(comparable(etat), comparable(await etatDesDeuxCotes(parBouton.dossierId)), "le bloc Espace fait ce que fait le bouton");
    assert.equal(etat.etape, "SIMULATION");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["CLIENT", "CLIENT", "Simulation publiée : en attente de son retour"]);
    assert.equal(etat.prochaineAction, "Attendre le retour du client sur la simulation");
    assert.equal(etat.statutLead, "CONTACTE");
    assert.equal(etat.etapeEspace, "SIMULATIONS");
    assert.deepEqual(etat.relances.devis, []);
    const passage = (await passages(parBloc.dossierId)).at(-1)!;
    assert.equal(passage.contenu, "Qualification → Simulation : simulation publiée dans son espace");
    assert.deepEqual([JSON.parse(passage.metadata).nature, JSON.parse(passage.metadata).de], ["AUTOMATIQUE", "QUALIFICATION"]);
    assert.equal(await mails(b), 1, "le mail automatique « votre simulation est prête », programmé (file locale)");

    // Masquée puis republiée : rien ne recule, pas de second mail, pas de second passage.
    await bloc(parBloc.dossierId, b, "masquer");
    await bloc(parBloc.dossierId, b, "afficher");
    const remise = await etatDesDeuxCotes(parBloc.dossierId);
    assert.deepEqual([remise.etape, remise.main, remise.prochaineAction, remise.etapeEspace], ["SIMULATION", "CLIENT", "Attendre le retour du client sur la simulation", "SIMULATIONS"]);
    assert.equal(await mails(b), 1, "jamais deux mails pour la même simulation");
    assert.equal((await passages(parBloc.dossierId)).filter((p) => /Qualification → Simulation/.test(p.contenu)).length, 1);
    assert.match((await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: parBloc.dossierId, type: "ESPACE_SIMULATION_DEPOSEE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })).contenu, /^Simulation republiée dans l'espace du client : Chêne clair$/);
  });

  test("une prochaine action posée à la main est gardée (une attente du client : pas de tâche à la place)", async () => {
    const c = await contact("Gardee");
    const s = await brouillon(c.dossierId, "Noyer");
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Passer chez lui jeudi" }));
    await bloc(c.dossierId, s, "afficher");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.prochaineAction, etat.actionManuelle, etat.main], ["SIMULATION", "Passer chez lui jeudi", "Passer chez lui jeudi", "CLIENT"]);
    assert.deepEqual(etat.taches.filter((t) => t.cle.includes(":synchro:")), []);
  });
});

describe("relecture de la mission 18 : une simulation masquée puis remise", () => {
  test("ni la prochaine action ni la main ne bougent (comme avant la mission 18) : seul l'historique le dit, aucun second mail", async () => {
    const c = await contact("Remise");
    const s = await brouillon(c.dossierId, "Béton ciré");
    await bloc(c.dossierId, s, "afficher");
    // Plus tard dans le dossier : Lucas a posé une action (la main lui revient), puis une action automatique l'a remplacée.
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Passer chez lui jeudi" }));
    const AUTO = "Appeler le client : fixer la date du chantier, suivre l'acompte";
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: AUTO } });
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.prochaineAction, avant.actionManuelle, avant.main, avant.mainCalculee], [AUTO, null, "MOI", "MOI"]);

    await bloc(c.dossierId, s, "masquer");
    await bloc(c.dossierId, s, "afficher");
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.equal(apres.prochaineAction, AUTO, "avant la relecture : écrasée par « Attendre le retour du client sur la simulation »");
    assert.deepEqual([apres.main, apres.mainCalculee, apres.mainMotif], ["MOI", "MOI", avant.mainMotif], "avant la relecture : la main passait au client");
    assert.deepEqual([apres.etape, apres.etapeEspace, apres.statutLead], [avant.etape, avant.etapeEspace, avant.statutLead]);
    assert.deepEqual(apres.taches.filter((t) => t.cle.includes(":synchro:")), [], "rien de rangé à la place");
    assert.equal(await mails(s), 1);
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_SIMULATION_DEPOSEE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.equal(trace.contenu, "Simulation republiée dans l'espace du client : Béton ciré");
  });
});

describe("retirer une simulation choisie annule le choix (mission 18, B9)", () => {
  test("mode UNE : masquer la simulation validée la dévalide d'un bloc ; « Préparer le devis » redevient une attente, l'espace revient aux simulations", async () => {
    const c = await contact("Une");
    const [s1, s2] = [await brouillon(c.dossierId, "Chêne"), await brouillon(c.dossierId, "Marbre")];
    await avecActeur(LUCAS, () => simulations.publierSimulations(c.dossierId, [s1, s2], { prevenir: false }));
    await service.choisir(await espaceDe(c.dossierId), { simulationId: s1, commentaire: "" });
    const choisi = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([choisi.etape, choisi.main, choisi.prochaineAction, choisi.etapeEspace], ["SIMULATION", "MOI", "Préparer le devis (simulation choisie)", "ATTENTE_DEVIS"]);

    // Masquer l'autre ne touche pas au choix.
    await bloc(c.dossierId, s2, "masquer");
    assert.ok((await espaceDe(c.dossierId)).choixLe, "choix gardé");

    await bloc(c.dossierId, s1, "masquer");
    const espace = await espaceDe(c.dossierId);
    assert.deepEqual([espace.choix, espace.choixLe], [null, null]);
    assert.equal(await prisma.simulationEspace.count({ where: { espaceId: espace.id, choisieLe: { not: null } } }), 0);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "SIMULATION");
    assert.equal(etat.prochaineAction, "Attendre qu'il valide une simulation (il a dévalidé la sienne)");
    assert.equal(etat.mainCalculee, etat.main);
    assert.notEqual(etat.etapeEspace, "ATTENTE_DEVIS", "le client ne voit plus « devis en préparation »");
    const devalidee = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_SIMULATION_DEVALIDEE" } });
    assert.equal(devalidee.contenu, "Simulation dévalidée par Lucas, à la place du client (simulation masquée : Chêne) : plus aucune simulation n'est validée");
  });

  test("mode COMPOSITE : retirer (ancien retrait de l'écran) la simulation d'une seule zone du mélange annule tout le choix", async () => {
    const c = await contact("Melange");
    const [s1, s2] = [await brouillon(c.dossierId, "Façades"), await brouillon(c.dossierId, "Plan")];
    await prisma.simulationEspace.update({ where: { id: s1 }, data: { zones: JSON.stringify([{ zone: "facades", libelle: "Façades", ref: "D1", nom: "Chêne" }]) } });
    await prisma.simulationEspace.update({ where: { id: s2 }, data: { zones: JSON.stringify([{ zone: "plan", libelle: "Plan de travail", ref: "AL23", nom: "Béton" }]) } });
    await avecActeur(LUCAS, () => simulations.publierSimulations(c.dossierId, [s1, s2], { prevenir: false }));
    await service.choisir(await espaceDe(c.dossierId), { zones: [{ zone: "facades", simulationId: s1 }, { zone: "plan", simulationId: s2 }], commentaire: "" });
    assert.equal(JSON.parse((await espaceDe(c.dossierId)).choix!).mode, "COMPOSITE");
    assert.equal(validations.simulationDansLeChoix((await espaceDe(c.dossierId)).choix, s2), true);

    await avecActeur(LUCAS, () => service.retirerSimulation(s2));
    const espace = await espaceDe(c.dossierId);
    assert.deepEqual([espace.choix, espace.choixLe], [null, null], "un mélange sans une de ses zones n'est plus un choix");
    const { AVEC_ARCHIVES } = await import("@/lib/journal/extension");
    assert.ok((await prisma.simulationEspace.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, id: s2 } })).archiveLe, "retirée (archivée, rien ne se supprime)");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.prochaineAction], ["SIMULATION", "Attendre qu'il valide une simulation (il a dévalidé la sienne)"]);
    assert.notEqual(etat.etapeEspace, "ATTENTE_DEVIS");
  });

  test("simulationDansLeChoix : la validée, une zone d'un mélange ; rien d'autre", () => {
    const une = JSON.stringify({ mode: "UNE", simulationId: "a" });
    const melange = JSON.stringify({ mode: "COMPOSITE", zones: [{ zone: "facades", simulationId: "a" }, { zone: "plan", simulationId: "b" }] });
    assert.deepEqual(
      [validations.simulationDansLeChoix(une, "a"), validations.simulationDansLeChoix(une, "b"), validations.simulationDansLeChoix(melange, "b"), validations.simulationDansLeChoix(melange, "c"), validations.simulationDansLeChoix(null, "a"), validations.simulationDansLeChoix("{illisible", "a")],
      [true, false, true, false, false, false]
    );
  });
});

describe("simulation du client ou choix validé → Simulation (mission 18, B9)", () => {
  test("une simulation faite sur le site, rangée dans son espace à la lecture : Qualification → Simulation d'un bloc, lead CONTACTE ; relue, rien ne bouge", async () => {
    const c = await contact("Site");
    await prisma.simulation.create({ data: { leadId: c.leadId, dossierId: c.dossierId, imageAfterPath: "dossiers/essai/rendu.jpg", imageBeforePath: "dossiers/essai/avant.jpg", referenceChoisie: "D1" } });
    await prisma.lead.update({ where: { id: c.leadId }, data: { statut: "NOUVEAU" } });
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "QUALIFICATION");

    const lu = await service.etatEspace(await espaceDe(c.dossierId));
    assert.equal(lu.simulations.length, 1, "elle est dans sa galerie");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.mainCalculee], ["SIMULATION", "CONTACTE", etat.main]);
    assert.notEqual(etat.etapeEspace, "PHOTOS");
    assert.equal((await passages(c.dossierId)).at(-1)!.contenu, "Qualification → Simulation : simulation faite sur coverswap.fr, rangée dans son espace");

    await service.etatEspace(await espaceDe(c.dossierId));
    assert.equal((await passages(c.dossierId)).filter((p) => /Qualification → Simulation/.test(p.contenu)).length, 1, "rejouée : rien de plus");
    assert.equal(await prisma.simulationEspace.count({ where: { dossierId: c.dossierId } }), 1);
  });

  test("un choix validé sur un dossier revenu en Qualification le fait passer en Simulation (« Préparer le devis », main à moi, espace en attente du devis)", async () => {
    const c = await contact("Choix");
    const s = await brouillon(c.dossierId, "Chêne");
    await avecActeur(LUCAS, () => simulations.publierSimulations(c.dossierId, [s], { prevenir: false }));
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "QUALIFICATION" }));
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "QUALIFICATION");

    await service.choisir(await espaceDe(c.dossierId), { simulationId: s, commentaire: "Celle-ci" });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.mainMotif], ["SIMULATION", "MOI", "MOI", "Simulation validée : faire le devis"]);
    assert.equal(etat.prochaineAction, "Préparer le devis (simulation choisie)");
    assert.deepEqual([etat.statutLead, etat.etapeEspace], ["CONTACTE", "ATTENTE_DEVIS"]);
    assert.equal((await passages(c.dossierId)).at(-1)!.contenu, "Qualification → Simulation : simulation validée dans l'espace client");
  });
});
