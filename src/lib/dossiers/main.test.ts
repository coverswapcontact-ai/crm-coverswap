import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-main-"));

/**
 * Mission 6 (22/09/2026) : « qui a la main » est UNE règle, la même sur la
 * carte du kanban, la fiche dossier, Espaces clients, Leads et /commercial ;
 * les coordonnées se corrigent depuis l'espace et nourrissent le devis ; les
 * points « à compléter » que le client peut fournir sont neutres, et une croix
 * les masque pour de bon.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let main: typeof import("./main");
let pilotage: typeof import("./pilotage");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let transitions: typeof import("./transitions");
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let suivi: typeof import("@/lib/espace/suivi");
let simulations: typeof import("@/lib/simulations/dossier");
let commercial: typeof import("@/lib/commercial/pilotage");
let leads: typeof import("@/lib/prospects/leads");
let controle: typeof import("@/lib/coherence/controle");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = (nom = "piece.jpg") => new File([new Uint8Array(JPEG)], nom, { type: "image/jpeg" });

async function contact(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, telephone: lead.telephone };
}
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });

/** Partout où Lucas regarde : la carte (mainDe sur le résumé), la fiche, Espaces clients, /commercial, Leads. */
async function partout(dossierId: string, leadId: string) {
  const maintenant = new Date();
  const resume = (await dossiers.listerDossiers()).find((d) => d.id === dossierId)!;
  const detail = await dossiers.chargerDetail(dossierId);
  const espace = (await suivi.listerEspaces(maintenant)).find((l) => l.dossierId === dossierId)!;
  const affaire = (await commercial.pilotageCommercial(maintenant)).affaires.find((a) => a.dossierId === dossierId);
  const ligneLead = (await leads.listerLeads({ vue: "ACTIFS", limite: 500 })).lignes.find((l) => l.id === leadId);
  const lu = (m: string) => (m === "A_RELANCER" ? "MOI" : m);
  return {
    carte: lu(pilotage.mainDe(resume, maintenant)),
    fiche: lu(pilotage.mainDe(detail, maintenant)),
    espaces: espace.attente.qui,
    commercial: affaire?.main ?? null,
    leads: ligneLead?.dossierMain ? lu(ligneLead.dossierMain.main) : null,
  };
}

async function simulationPubliee(dossierId: string, titre: string) {
  const vue = await simulations.deposerSimulationDossier(dossierId, photo(`${titre}.jpg`), { titre, preparationId: null });
  await prisma.simulationEspace.update({ where: { id: vue.id }, data: { zones: JSON.stringify([{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "NE31", nom: "Chêne clair" }]) } });
  await avecActeur(LUCAS, () => simulations.publierSimulations(dossierId, [vue.id], { prevenir: false }));
  return vue.id;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  main = await import("./main");
  pilotage = await import("./pilotage");
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  transitions = await import("./transitions");
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  suivi = await import("@/lib/espace/suivi");
  simulations = await import("@/lib/simulations/dossier");
  commercial = await import("@/lib/commercial/pilotage");
  leads = await import("@/lib/prospects/leads");
  controle = await import("@/lib/coherence/controle");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("qui a la main : la règle", () => {
  const le = (minutes: number) => new Date(Date.UTC(2026, 8, 22, 10, minutes));
  const evt = (type: string, minutes: number, direction = "ENTRANT", metadata = "{}") => ({ type, direction, metadata, contenu: "", le: le(minutes) });

  test("sans geste, l'étape décide ; le geste le plus récent l'emporte ensuite", () => {
    assert.equal(main.mainSelonFaits({ etape: "SIMULATION", evenements: [] }).qui, "MOI");
    assert.equal(main.mainSelonFaits({ etape: "DEVIS_ENVOYE", evenements: [] }).qui, "CLIENT");
    const publie = main.mainSelonFaits({ etape: "SIMULATION", evenements: [evt("CHANGEMENT_ETAPE", 0, "INTERNE"), evt("ESPACE_SIMULATION_DEPOSEE", 5, "SORTANT")] });
    assert.deepEqual([publie.qui, publie.motif], ["CLIENT", "Simulation publiée : en attente de son retour"]);
    const repondu = main.mainSelonFaits({ etape: "SIMULATION", evenements: [evt("ESPACE_SIMULATION_DEPOSEE", 5, "SORTANT"), evt("ESPACE_SIMULATION_CHOISIE", 9)] });
    assert.equal(repondu.qui, "MOI");
  });

  test("ce que Lucas fait à la place du client ne rend pas la main ; un changement d'étape plus tard la redonne à l'étape", () => {
    assert.equal(main.mainSelonFaits({ etape: "SIMULATION", evenements: [evt("ESPACE_SIMULATION_DEPOSEE", 5, "SORTANT"), evt("ESPACE_SIMULATION_CHOISIE", 9, "INTERNE")] }).qui, "CLIENT");
    assert.equal(main.mainSelonFaits({ etape: "PLANIFIE", evenements: [evt("ESPACE_SIMULATION_DEPOSEE", 5, "SORTANT"), evt("CHANGEMENT_ETAPE", 30, "INTERNE")] }).qui, "MOI");
  });

  test("un geste à moins d'une minute d'un changement d'étape l'a causé : il l'emporte (bon pour accord → Signé)", () => {
    const accord = main.mainSelonFaits({ etape: "SIGNE", evenements: [evt("ESPACE_DEVIS_ACCEPTE", 10), { ...evt("CHANGEMENT_ETAPE", 10, "INTERNE"), le: new Date(le(10).getTime() + 2000) }] });
    assert.deepEqual([accord.qui, accord.motif], ["MOI", "Bon pour accord reçu : fixer la date du chantier"]);
  });

  test("lien envoyé par SMS : chez le client ; SMS ordinaire : rien ne change ; perdu ou encaissé : personne", () => {
    assert.equal(main.mainSelonFaits({ etape: "QUALIFICATION", evenements: [evt("SMS_ENVOYE", 3, "SORTANT", JSON.stringify({ modele: "LIEN_ESPACE" }))] }).qui, "CLIENT");
    assert.equal(main.mainSelonFaits({ etape: "QUALIFICATION", evenements: [evt("SMS_ENVOYE", 3, "SORTANT", JSON.stringify({ origine: "MANUEL" }))] }).qui, "MOI");
    assert.equal(main.mainSelonFaits({ etape: "PERDU", evenements: [evt("ESPACE_PHOTOS", 3)] }).qui, null);
    assert.equal(main.mainSelonFaits({ etape: "ENCAISSE", evenements: [] }).qui, null);
  });
});

describe("qui a la main : la même partout, à chaque geste", () => {
  test("je publie une simulation → « chez le client » partout ; il valide → elle me revient partout ; j'émets le devis → chez lui", async () => {
    const c = await contact("Main");
    // L'espace vient de s'ouvrir : il attend ses photos et son projet.
    const avant = await partout(c.dossierId, c.leadId);
    assert.deepEqual([avant.carte, avant.fiche, avant.espaces], ["CLIENT", "CLIENT", "CLIENT"], JSON.stringify(avant));

    const simulationId = await simulationPubliee(c.dossierId, "Chêne clair");
    const d = await dossierDe(c.dossierId);
    assert.equal(d.etape, "SIMULATION", "publier fait passer en Simulation");
    assert.deepEqual([d.main, d.mainMotif], ["CLIENT", "Simulation publiée : en attente de son retour"]);
    const publie = await partout(c.dossierId, c.leadId);
    assert.deepEqual([publie.carte, publie.fiche, publie.espaces, publie.commercial], ["CLIENT", "CLIENT", "CLIENT", "CLIENT"], JSON.stringify(publie));
    if (publie.leads !== null) assert.equal(publie.leads, "CLIENT");

    // Le client valide la simulation depuis son espace (le geste passe par la route, qui relit la main).
    await service.choisirSimulation(await espaceDe(c.espaceId), simulationId, "Parfait");
    await main.recalculerMain(c.dossierId);
    const valide = await partout(c.dossierId, c.leadId);
    assert.deepEqual([valide.carte, valide.fiche, valide.espaces, valide.commercial], ["MOI", "MOI", "MOI", "MOI"], JSON.stringify(valide));
    assert.equal((await dossierDe(c.dossierId)).mainMotif, "Simulation validée : faire le devis");

    await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, { type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", sousDesignation: undefined, quantite: 6, unite: "ml", prixUnitaire: 120 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null })
    );
    const devis = await partout(c.dossierId, c.leadId);
    assert.deepEqual([devis.carte, devis.fiche, devis.espaces, devis.commercial], ["CLIENT", "CLIENT", "CLIENT", "CLIENT"], JSON.stringify(devis));
  });

  test("contrôle de cohérence : une main décalée est signalée, « Corriger » la remet", async () => {
    const c = await contact("Decalee");
    await simulationPubliee(c.dossierId, "Béton");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { main: "MOI", mainMotif: "écrite à la main" } });
    const rapport = await controle.controlerCoherence();
    const incoherence = rapport.incoherences.find((i) => i.code === "MAIN_DECALEE" && i.dossierId === c.dossierId);
    assert.ok(incoherence, "signalée");
    assert.match(incoherence!.constat, /affiche « à moi » alors que ses derniers gestes le mettent « chez le client »/);
    await controle.corrigerIncoherence(incoherence!.cle);
    assert.equal((await dossierDe(c.dossierId)).main, "CLIENT");
    assert.ok(!(await controle.controlerCoherence()).incoherences.some((i) => i.code === "MAIN_DECALEE" && i.dossierId === c.dossierId));
  });

  test("Lucas recule le dossier à la main : l'étape redonne la main à son responsable", async () => {
    const c = await contact("Recul");
    await simulationPubliee(c.dossierId, "Noyer");
    assert.equal((await dossierDe(c.dossierId)).main, "CLIENT");
    await new Promise((r) => setTimeout(r, 5));
    // Un changement d'étape bien plus tard qu'un geste : la règle de l'étape. (Simulé : on vieillit la publication.)
    await prisma.dossierEvenement.updateMany({ where: { dossierId: c.dossierId, type: "ESPACE_SIMULATION_DEPOSEE" }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "QUALIFICATION" }));
    assert.equal((await dossierDe(c.dossierId)).main, "MOI");
  });
});

describe("mes coordonnées, depuis l'espace", () => {
  test("préremplies ; le client corrige son prénom et ajoute l'adresse → fiche, dossier, historique, et le devis généré les reprend", async () => {
    const c = await contact("Jaen", { email: "jean.essai@exemple.test" });
    const etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(etat.coordonnees.prenom, "Jaen");
    assert.equal(etat.coordonnees.nomFamille, "Essai");
    assert.equal(etat.coordonnees.email, "jean.essai@exemple.test");
    assert.ok(etat.coordonnees.telephone.startsWith("06"));
    assert.equal(etat.coordonnees.completes, false);
    assert.deepEqual(etat.coordonnees.manque, ["l'adresse du chantier"]);

    await service.completerCoordonnees(await espaceDe(c.espaceId), { prenom: "Jean", adresse: "12 rue des Lilas", codePostal: "34970", ville: "Lattes" });
    const apres = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(apres.coordonnees.completes, true);
    assert.equal(apres.prenom, "Jean", "l'espace le salue par son prénom corrigé");
    const d = await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId }, include: { client: true } });
    assert.deepEqual([d.clientNom, d.clientAdresse, d.clientCp, d.clientVille], ["Jean Essai", "12 rue des Lilas", "34970", "Lattes"]);
    assert.deepEqual([d.client!.prenom, d.client!.nom], ["Jean", "Jean Essai"]);
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_COORDONNEES" } });
    assert.match(trace.contenu, /prénom « Jaen » → « Jean »/);
    assert.match(trace.contenu, /adresse du chantier ajoutée : « 12 rue des Lilas »/);
    assert.deepEqual(JSON.parse(trace.metadata).changements[0], { champ: "prenom", libelle: "prénom", avant: "Jaen", apres: "Jean" });

    const { document } = await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, { type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", sousDesignation: undefined, quantite: 5, unite: "ml", prixUnitaire: 100 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null })
    );
    const imprime = documents.lireDestinataire((await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).destinataire);
    assert.deepEqual([imprime?.nom, imprime?.adresse, imprime?.codePostal, imprime?.ville], ["Jean Essai", "12 rue des Lilas", "34970", "Lattes"]);
  });

  test("rien n'est exigé ; un e-mail ou un téléphone faux est refusé avec un exemple ; un champ vidé garde l'ancienne valeur", async () => {
    const c = await contact("Vide");
    const { schemaCoordonnees } = await import("@/lib/espace/coordonnees");
    assert.equal(schemaCoordonnees.safeParse({}).success, true);
    assert.match(schemaCoordonnees.safeParse({ email: "jean@" }).error!.issues[0].message, /prenom\.nom@gmail\.com/);
    assert.match(schemaCoordonnees.safeParse({ telephone: "12" }).error!.issues[0].message, /06 12 34 56 78/);
    await service.completerCoordonnees(await espaceDe(c.espaceId), { prenom: "", email: "" });
    const d = await dossierDe(c.dossierId);
    assert.equal(d.clientNom, "Vide Essai");
  });

  test("un téléphone changé : nouveau principal, l'ancien gardé sur la fiche, Lucas prévenu, et les 4 chiffres du nouveau ouvrent l'espace", async () => {
    const c = await contact("Tel");
    await service.completerCoordonnees(await espaceDe(c.espaceId), { telephone: "07 11 22 33 44" });
    const d = await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId }, include: { client: { include: { telephones: true } } } });
    assert.equal(d.clientTelephone, "+33711223344");
    const principal = d.client!.telephones.find((t) => t.principal);
    assert.equal(principal?.numero, "+33711223344");
    assert.ok(d.client!.telephones.some((t) => t.numero === c.telephone && !t.principal && !t.archiveLe), "l'ancien numéro reste sur la fiche");
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_COORDONNEES" } });
    assert.match(trace.contenu, /téléphone « 06 [0-9 ]+ » → « 07 11 22 33 44 »/);
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { clientId: d.clientId! } });
    assert.equal((await liens.confirmerTelephone(permanent, "3344")).ok, true);
  });
});

describe("à compléter : neutre quand le client peut le donner, une croix pour masquer", () => {
  test("adresse et photos attendues du client : neutres (pas comptées) ; masquée : ne revient pas ; remplie : disparaît", async () => {
    const c = await contact("Alerte");
    let detail = await dossiers.chargerDetail(c.dossierId);
    const adresse = detail.completude.find((p) => p.code === "ADRESSE")!;
    assert.equal(adresse.attenteClient, true, "le client peut la donner depuis son espace");
    assert.equal(detail.completude.find((p) => p.code === "PHOTO")?.attenteClient, true);
    const alertes = detail.completude.filter((p) => !p.attenteClient && !p.masque).map((p) => p.code);
    assert.equal(detail.aCompleter, alertes.length);
    assert.ok(!alertes.includes("ADRESSE"));

    // Sans espace actif, l'adresse redevient une alerte ; Lucas la masque : elle ne revient pas.
    await prisma.espacePermanent.updateMany({ where: { client: { dossiers: { some: { id: c.dossierId } } } }, data: { revoqueLe: new Date() } });
    detail = await dossiers.chargerDetail(c.dossierId);
    assert.equal(detail.completude.find((p) => p.code === "ADRESSE")!.attenteClient, false);
    const compte = detail.aCompleter;
    await avecActeur(LUCAS, () => dossiers.masquerPointACompleter(c.dossierId, "ADRESSE", true));
    detail = await dossiers.chargerDetail(c.dossierId);
    assert.equal(detail.completude.find((p) => p.code === "ADRESSE")!.masque, true);
    assert.equal(detail.aCompleter, compte - 1);
    // Rechargé, recalculé, un autre geste : toujours masquée.
    await main.recalculerMain(c.dossierId);
    assert.equal((await dossiers.listerDossiers()).find((d) => d.id === c.dossierId)!.aCompleter, compte - 1);
    // Remplie : le point disparaît de lui-même.
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { clientAdresse: "3 rue Haute", clientCp: "34970", clientVille: "Lattes" } });
    assert.ok(!(await dossiers.chargerDetail(c.dossierId)).completude.some((p) => p.code === "ADRESSE"));
    // Réafficher reste possible (tracé).
    await avecActeur(LUCAS, () => dossiers.masquerPointACompleter(c.dossierId, "ADRESSE", false));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, contenu: { startsWith: "Point « à compléter »" } } }), 2);
  });
});
