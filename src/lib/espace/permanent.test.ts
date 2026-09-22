import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-permanent-"));

/**
 * Mission du 22/09/2026 (5) : l'espace client devient PERMANENT et
 * multi-projets, et tout le système parle de TOUTES les prestations (quatre
 * familles, leurs sous-parties). Un client = un espace, un projet = un dossier.
 */

let prisma: typeof import("@/lib/prisma").default;
let liens: typeof import("./liens");
let service: typeof import("./service");
let compte: typeof import("./compte");
let projets: typeof import("./projets");
let prestations: typeof import("@/lib/prestations/prestations");
let deduction: typeof import("@/lib/prestations/deduction");

async function contact(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espace: ouvert.espace, permanent: ouvert.permanent, lien: ouvert.lien, jeton: ouvert.lien.split("/e/")[1], telephone: lead.telephone };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  delete process.env.ESPACE_CLIENT_SECRET;
  process.env.SITE_URL = "https://coverswap.fr";
  liens = await import("./liens");
  service = await import("./service");
  compte = await import("./compte");
  projets = await import("./projets");
  prestations = await import("@/lib/prestations/prestations");
  deduction = await import("@/lib/prestations/deduction");
});
after(async () => {
  await prisma.$disconnect();
});

describe("le fichier des prestations", () => {
  test("quatre familles, leurs sous-parties, dans l'ordre ; une sélection se remet en ordre", () => {
    assert.deepEqual(prestations.FAMILLES.map((f) => f.libelle), ["Cuisine", "Salle de bain", "Mobilier", "Professionnel"]);
    assert.deepEqual(prestations.famille("SDB").sousParties.map((s) => s.libelle), ["Meuble vasque", "Plan vasque", "Crédence", "Portes de placard"]);
    const s = prestations.normaliserSelection({ MEUBLES: ["portes-dressing", "inconnu"], CUISINE: ["credence", "facades-hautes", "credence"], VOITURE: ["x"] });
    assert.deepEqual(s, { CUISINE: ["facades-hautes", "credence"], MEUBLES: ["portes-dressing"] });
    assert.equal(prestations.resumerSelection(s), "Cuisine : façades hautes, crédence · Mobilier : portes de dressing");
  });

  test("les mots de l'écran : « votre salle de bain » seulement quand c'est la seule famille ; sinon « votre projet »", () => {
    assert.equal(prestations.motsDuProjet(["SDB"]).votre, "votre salle de bain");
    assert.equal(prestations.motsDuProjet([]).votre, "votre projet");
    assert.equal(prestations.motsDuProjet(["CUISINE", "MEUBLES"]).de, "de votre projet");
  });

  test("chaque sous-partie pointe des surfaces du projet du simulateur de sa famille", () => {
    for (const f of prestations.FAMILLES) {
      const permises = new Set(f.zonesSimulateur.map((z) => z.zone));
      for (const sp of f.sousParties) for (const zone of sp.zones) assert.ok(permises.has(zone), `${f.id}.${sp.id} → ${zone}`);
    }
    // Les zones proposées au simulateur : celles des sous-parties cochées, marquées.
    const zones = prestations.zonesPourSimulation("CUISINE", { CUISINE: ["ilot"] });
    assert.deepEqual(zones.filter((z) => z.cochee).map((z) => z.zone), ["meubles-bas", "plan-de-travail"]);
  });

  test("les anciennes zones cochées (v3) deviennent des sous-parties", () => {
    assert.deepEqual(prestations.selectionDepuisZones(["meubles-hauts", "meubles-bas"]), { CUISINE: ["facades-hautes", "facades-basses"] });
    assert.deepEqual(prestations.selectionDepuisZones(["facades-cuisine", "portes-dressing"]), { CUISINE: ["facades-hautes", "facades-basses"], MEUBLES: ["portes-dressing"] });
  });

  test("déduire d'un devis : ce qui est nommé sans doute, rien de plus (« Plan » seul ne coche rien)", () => {
    assert.deepEqual(deduction.deduireSelection(["Cuisine + Dressing + Plan"]), { CUISINE: [], MEUBLES: ["portes-dressing"] });
    assert.deepEqual(deduction.deduireSelection(["Revêtement adhésif — cuisine / façades", "Plan vasque", "Crédence salle de bain"]), { CUISINE: ["facades-hautes", "facades-basses"], SDB: ["plan-vasque", "credence"] });
    assert.deepEqual(deduction.deduireSelection(["Revêtement adhésif — bar / comptoir"]), { PRO: ["comptoir"] });
  });
});

describe("un client = un espace, pour toujours", () => {
  test("un deuxième dossier du même client rejoint son espace : même lien, deux projets ; un lien de projet ouvre son projet", async () => {
    const a = await contact("Aline");
    const clientId = (await prisma.dossier.findUniqueOrThrow({ where: { id: a.dossierId } })).clientId!;
    // Un second chantier, ouvert par Lucas sur la même fiche client.
    const second = await prisma.dossier.create({ data: { clientId, clientNom: "Aline Essai", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: a.telephone, objet: "Dressing", source: "ENTRANT" } });
    const ouvert = await liens.ouvrirEspace(second.id);
    assert.equal(ouvert.permanent.id, a.permanent.id, "le même espace permanent");
    assert.equal(ouvert.lien, a.lien, "le même lien");
    assert.notEqual(ouvert.espace.code, a.espace.code, "chaque projet a son code");
    const visibles = await projets.projetsVisibles(prisma, a.permanent.id);
    assert.equal(visibles.length, 2);
    // Le lien du client ne choisit rien quand deux projets sont en cours : l'accueil « Mes projets ».
    const acces = await liens.accesDuJeton(a.jeton);
    assert.equal(await compte.projetDemande(acces.permanent, null, acces.projetDuLien), null);
    // Un lien de projet (ancien lien, SMS « vos simulations ») ouvre son projet, et seulement le sien.
    const jetonProjet = liens.jetonEspace(ouvert.espace);
    const parProjet = await liens.accesDuJeton(jetonProjet);
    assert.equal(parProjet.permanent.id, a.permanent.id);
    assert.equal((await compte.projetDemande(parProjet.permanent, null, parProjet.projetDuLien))?.id, ouvert.espace.id);
    // Un projet d'un autre client ne s'ouvre jamais par ce lien.
    const b = await contact("Bastien");
    await assert.rejects(compte.projetDemande(acces.permanent, b.espace.code, null), /pas dans votre espace/);
    // Régénérer : l'ancien lien du client ET les liens de ses projets meurent.
    await liens.renouvelerEspace(a.permanent.id);
    await assert.rejects(liens.accesDuJeton(a.jeton), /n'est pas valide/);
    await assert.rejects(liens.accesDuJeton(jetonProjet), /n'est pas valide/);
  });

  test("90 jours sans visite : le téléphone d'abord (4 derniers chiffres), rien d'autre ne sort ; 5 essais manqués bloquent", async () => {
    const c = await contact("Chantal");
    const il_y_a_100_jours = new Date(Date.now() - 100 * 86_400_000);
    await prisma.espacePermanent.update({ where: { id: c.permanent.id }, data: { dernierAccesLe: il_y_a_100_jours, lienEmisLe: il_y_a_100_jours } });
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanent.id } });
    assert.equal(liens.confirmationRequise(permanent), true);
    const verrouille = await compte.compteEspace(permanent);
    assert.deepEqual([verrouille.confirmation?.requise, verrouille.projets.length, verrouille.documents.length], [true, 0, 0], "ni projets ni documents avant la confirmation");
    // Manqué : compté ; bon : ouvert, et plus rien à confirmer.
    const faux = await liens.confirmerTelephone(permanent, "0000");
    assert.deepEqual(faux, { ok: false, restants: 4, bloque: false });
    const bons = c.telephone.replace(/\D/g, "").slice(-4);
    assert.deepEqual(await liens.confirmerTelephone(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanent.id } }), bons), { ok: true });
    assert.equal(liens.confirmationRequise(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanent.id } })), false);
    // Cinq essais manqués dans la journée : bloqué, même avec les bons chiffres.
    await prisma.espacePermanent.update({ where: { id: c.permanent.id }, data: { confirmeLe: null, dernierAccesLe: il_y_a_100_jours, lienEmisLe: il_y_a_100_jours } });
    for (let i = 0; i < 5; i++) await liens.confirmerTelephone(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanent.id } }), "1111");
    assert.deepEqual(await liens.confirmerTelephone(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanent.id } }), bons), { ok: false, restants: 0, bloque: true });
  });

  test("nouveau projet créé par le client : un dossier sur SA fiche, sans lead, en Qualification, « appeler : nouveau projet »", async () => {
    const d = await contact("Denise");
    const avantLeads = await prisma.lead.count();
    const { projet, dossierId } = await projets.creerProjetClient(d.permanent, { nom: "La salle de bain du haut", familles: ["SDB"] });
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    const ancien = await prisma.dossier.findUniqueOrThrow({ where: { id: d.dossierId } });
    assert.deepEqual([dossier.etape, dossier.source, dossier.leadId, dossier.clientId, dossier.prochaineAction, dossier.clientTelephone], ["QUALIFICATION", "ESPACE_CLIENT", null, ancien.clientId, "Appeler : nouveau projet", ancien.clientTelephone]);
    assert.equal(await prisma.lead.count(), avantLeads, "ce n'est pas un lead");
    assert.deepEqual(prestations.lireSelection(dossier.prestations), { SDB: [] });
    assert.equal(projet.permanentId, d.permanent.id);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_NOUVEAU_PROJET" } }), 1);
    // Son état parle de salle de bain, jamais de cuisine.
    const etat = await service.etatEspace(projet);
    assert.deepEqual([etat.nomProjet, etat.mots.votre, etat.familles, etat.creation.pieces[0].piece], ["La salle de bain du haut", "votre salle de bain", ["SDB"], "SDB"]);
    assert.doesNotMatch(JSON.stringify({ mots: etat.mots, nom: etat.nomProjet, projet: etat.projet }), /cuisine/i);
  });

  test("au plus deux projets en cours : le troisième se demande, Lucas l'accorde", async () => {
    const e = await contact("Émile");
    await projets.creerProjetClient(e.permanent, { nom: "Dressing", familles: ["MEUBLES"] });
    await assert.rejects(projets.creerProjetClient(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: e.permanent.id } }), { nom: "Bureau", familles: ["MEUBLES"] }), (err: Error & { details?: { raison?: string } }) => /demandez-le à CoverSwap/.test(err.message));
    await projets.demanderProjetDePlus(e.permanent);
    assert.ok((await prisma.espacePermanent.findUniqueOrThrow({ where: { id: e.permanent.id } })).projetDemandeLe);
    await projets.accorderProjets(e.permanent.id, 1);
    const apres = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: e.permanent.id } });
    assert.deepEqual([apres.projetsAccordes, apres.projetDemandeLe], [1, null]);
    await projets.creerProjetClient(apres, { nom: "Bureau", familles: ["MEUBLES"] });
    assert.equal(await projets.projetsEnCours(prisma, e.permanent.id), 3);
  });

  test("un projet encaissé se fige (terminé), un projet perdu est « non réalisé » ; ses documents restent consultables", async () => {
    const f = await contact("Fanny");
    await prisma.dossier.update({ where: { id: f.dossierId }, data: { etape: "ENCAISSE" } });
    const devis = await prisma.document.create({ data: { dossierId: f.dossierId, type: "DEVIS", numero: `2026-9${Math.floor(Math.random() * 900 + 100)}`, dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 2000, acomptePct: 30, statut: "ACCEPTE", origine: "REPRISE" } });
    const etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: f.espace.id } }));
    assert.deepEqual([etat.fige, etat.projetModifiable.ok, etat.choixModifiable], ["TERMINE", false, false]);
    const c = await compte.compteEspace(await prisma.espacePermanent.findUniqueOrThrow({ where: { id: f.permanent.id } }));
    assert.equal(c.projets[0].pastille, "TERMINE");
    assert.equal(c.nouveauProjet.enCours, 0, "un projet terminé n'est plus en cours");
    assert.deepEqual(c.documents.map((d) => [d.numero, d.montant, d.statut]), [[devis.numero, 2000, "Signé"]]);
    // Le PDF d'un document d'un autre client : jamais.
    const g = await contact("Gilles");
    await assert.rejects(compte.pdfPourLeClient(g.permanent, devis.id), /introuvable/);
    await prisma.dossier.update({ where: { id: f.dossierId }, data: { etape: "PERDU" } });
    assert.equal(projets.figeDuProjet("PERDU"), "NON_REALISE");
  });
});

describe("le projet par familles", () => {
  test("le client coche des familles et des sous-parties : elles vont au DOSSIER ; la taille dépend de la famille", async () => {
    const h = await contact("Hugo");
    await service.enregistrerProjetOuSouhaits(h.espace, { familles: { CUISINE: ["facades-hautes", "plan-de-travail", "credence"], MEUBLES: ["portes-dressing"], SDB: ["plan-vasque", "credence"] }, tailles: { CUISINE: { repere: "en-l", valeur: 5 }, MEUBLES: { repere: null, valeur: 6 } }, precisions: "Garder les poignées" });
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: h.dossierId } });
    assert.deepEqual(prestations.lireSelection(dossier.prestations), { CUISINE: ["facades-hautes", "plan-de-travail", "credence"], SDB: ["plan-vasque", "credence"], MEUBLES: ["portes-dressing"] });
    assert.equal(dossier.prestationsPar, "CLIENT");
    const etat = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: h.espace.id } }));
    assert.deepEqual(etat.familles, ["CUISINE", "SDB", "MEUBLES"]);
    assert.equal(etat.mots.votre, "votre projet", "trois familles : « votre projet »");
    assert.equal(etat.projetManque, null, "complet : validable");
    // Le devis prérempli : une ligne par tarif, la taille de la cuisine sur ses façades, les portes du dressing dans le détail.
    const { devisProposeDuDossier } = await import("./devis-propose");
    await prisma.presetTarif.createMany({ data: [{ designation: "Revêtement adhésif — cuisine / façades", unite: "ml", prixUnitaire: 110 }, { designation: "Revêtement adhésif — portes de dressing", unite: "ml", prixUnitaire: 50 }] });
    const propose = await devisProposeDuDossier(h.dossierId);
    const lignes = propose!.lignes.map((l) => [l.designation, l.quantite, l.prixUnitaire, l.sousDesignation]);
    assert.deepEqual(lignes[0], ["Revêtement adhésif — cuisine / façades", 5, 110, "Façades hautes"]);
    assert.deepEqual(lignes.find((l) => String(l[0]).includes("dressing")), ["Revêtement adhésif — portes de dressing", null, 50, "≈ 6 portes (estimation du client)"]);
    assert.ok(lignes.some((l) => l[0] === "Revêtement adhésif — plan vasque" && l[2] === null), "sans tarif : prix à saisir, rien d'inventé");
  });

  test("un tarif attribué par Lucas à une sous-partie l'emporte sur les mots-clés", async () => {
    const { attribuerTarif, tarifDeLaSousPartie } = await import("@/lib/prestations/tarifs");
    const { listerPresets } = await import("@/lib/dossiers/presets");
    const special = await prisma.presetTarif.create({ data: { designation: "Plan de travail stratifié (recouvrement)", unite: "ml", prixUnitaire: 90 } });
    assert.equal(tarifDeLaSousPartie("CUISINE.plan-de-travail", await listerPresets()).preset, null, "aucun tarif ne contient « revêtement … plan de travail »");
    await attribuerTarif("CUISINE.plan-de-travail", special.id);
    const trouve = tarifDeLaSousPartie("CUISINE.plan-de-travail", await listerPresets());
    assert.deepEqual([trouve.preset?.id, trouve.explicite], [special.id, true]);
    await attribuerTarif("CUISINE.plan-de-travail", null);
    assert.equal(tarifDeLaSousPartie("CUISINE.plan-de-travail", await listerPresets()).explicite, false);
  });
});

describe("migration : chaque espace devient l'espace permanent de son client", () => {
  test("même code, même version : le lien déjà envoyé continue de marcher ; ses zones deviennent ses familles", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Irène", nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", source: "META_ADS" } });
    const { dossierDuContact, jetonEspace } = liens;
    const dossierId = await dossierDuContact(lead.id);
    // Un espace d'avant le 22/09 : pas d'espace permanent, un lien de 90 jours, des zones cochées.
    const ancien = await prisma.espaceClient.create({ data: { code: "irene234", version: 2, dossierId, expireLe: new Date(Date.now() + 30 * 86_400_000), nbAcces: 3, dernierAccesLe: new Date(), souhaits: JSON.stringify({ zones: ["meubles-hauts", "meubles-bas"], metres: 4, repere: null, precisions: "" }), favoris: JSON.stringify(["NE31"]) } });
    const jeton = jetonEspace(ancien);
    const { migrationEspacesPermanents } = await import("@/lib/base/migrations/espaces-permanents");
    const compteurs = await migrationEspacesPermanents.executer(prisma);
    assert.ok(compteurs.permanents >= 1);
    const projet = await prisma.espaceClient.findUniqueOrThrow({ where: { id: ancien.id } });
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: projet.permanentId! } });
    assert.deepEqual([permanent.code, permanent.version, permanent.nbAcces, permanent.favoris], ["irene234", 2, 3, JSON.stringify(["NE31"])]);
    assert.equal((await liens.accesDuJeton(jeton)).permanent.id, permanent.id, "le lien envoyé EST le lien permanent");
    assert.deepEqual(prestations.lireSelection((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).prestations), { CUISINE: ["facades-hautes", "facades-basses"] });
    // Rejouable : rien ne bouge au second passage.
    const encore = await migrationEspacesPermanents.executer(prisma);
    assert.deepEqual([encore.permanents, encore.projets], [0, 0]);
  });
});
