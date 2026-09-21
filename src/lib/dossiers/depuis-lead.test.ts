import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
const TELEVERSEMENTS = mkdtempSync(path.join(tmpdir(), "coverswap-depuis-lead-"));
process.env.UPLOADS_DIR = TELEVERSEMENTS;

let prisma: typeof import("@/lib/prisma").default;
let depuisLead: typeof import("./depuis-lead");
let entrants: typeof import("@/lib/prospects/leads");
let stockage: typeof import("./stockage");

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");

/** Écrit une image dans les téléversements et rend son chemin relatif. `grain` change sa taille : deux photos différentes. */
function image(relatif: string, grain = 0): string {
  const absolu = path.join(TELEVERSEMENTS, relatif);
  mkdirSync(path.dirname(absolu), { recursive: true });
  writeFileSync(absolu, Buffer.concat([JPEG, Buffer.alloc(grain)]));
  return relatif;
}

let compteur = 0;
async function lead(donnees: Record<string, unknown> = {}) {
  compteur++;
  return prisma.lead.create({
    data: { prenom: "Marie", nom: `Essai${compteur}`, telephone: `+336120000${String(compteur).padStart(2, "0")}`, email: `marie${compteur}@exemple.fr`, ville: "Lattes", codePostal: "34970", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", ...donnees },
  });
}

async function simulation(leadId: string, nom: string, grainAvant = 0) {
  const creee = await prisma.simulation.create({ data: { leadId, referenceChoisie: "K1", prixDevis: 1450, notes: "Façades : K1 (Black mat)" } });
  return prisma.simulation.update({ where: { id: creee.id }, data: { imageBeforePath: image(`${leadId}/${creee.id}/before.jpg`, grainAvant), imageAfterPath: image(`${leadId}/${creee.id}/${nom}.png`, 7) } });
}

const photosDe = async (dossierId: string) => stockage.lirePhotos((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).photos);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  depuisLead = await import("./depuis-lead");
  entrants = await import("@/lib/prospects/leads");
  stockage = await import("./stockage");
});
after(async () => {
  await prisma.$disconnect();
});

describe("simulation du site → lead (règle du 22/09/2026 : une simulation seule n'ouvre plus de dossier)", () => {
  test("une simulation terminée reste sur la fiche du lead : aucun dossier, mais Prioritaire d'office", async () => {
    const contact = await lead({ message: "Cuisine de 2012, façades abîmées", occupation: "PROPRIETAIRE", campagne: "Cuisine septembre" });
    await simulation(contact.id, "after");
    assert.equal(await depuisLead.assurerDossierDeSimulation(contact.id), null);
    assert.equal(await prisma.dossier.count({ where: { leadId: contact.id } }), 0);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: contact.id } })).priorite, "PRIORITAIRE");
    // Ses simulations l'attendent sur sa fiche : rien n'est rangé ailleurs.
    assert.equal(await prisma.simulation.count({ where: { leadId: contact.id, dossierId: null } }), 1);
  });

  test("Lucas ouvre le dossier depuis Leads : photo avant et rendu suivent, la photo avant une seule fois, rien n'est recopié deux fois", async () => {
    const contact = await lead({ message: "Cuisine de 2012, façades abîmées", occupation: "PROPRIETAIRE", campagne: "Cuisine septembre" });
    await simulation(contact.id, "rendu-1", 11);
    await simulation(contact.id, "rendu-2", 11); // même photo avant, autre finition
    const ouverture = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    assert.ok(ouverture.cree);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture.dossierId } });
    assert.deepEqual([dossier.leadId, dossier.etape, dossier.source, dossier.clientVille, dossier.clientCp, dossier.montantEstime], [contact.id, "QUALIFICATION", "ENTRANT", "Lattes", "34970", 1450]);
    assert.equal((await photosDe(dossier.id)).length, 3, "1 photo avant + 2 rendus");
    const note = await prisma.dossierEvenement.findFirst({ where: { dossierId: dossier.id, type: "NOTE_AJOUTEE" } });
    assert.match(note?.contenu ?? "", /Cuisine septembre[\s\S]*propriétaire[\s\S]*façades abîmées/);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: dossier.id, type: "SIMULATION_SITE" } }), 2);
    // Une nouvelle simulation, maintenant qu'il a un dossier : elle s'y range toute seule ; rejouer ne change rien.
    await simulation(contact.id, "rendu-3", 11);
    const suite = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.deepEqual([suite?.dossierId, suite?.cree, suite?.simulationsRangees], [dossier.id, false, 1]);
    const rejoue = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.deepEqual([rejoue?.simulationsRangees, rejoue?.photosRangees], [0, 0]);
    assert.equal((await photosDe(dossier.id)).length, 4);
    assert.equal(await prisma.dossier.count({ where: { leadId: contact.id } }), 1);
  });

  test("un dossier vivant existe déjà pour ce client : la simulation s'y range, aucun second dossier", async () => {
    const contact = await lead();
    const existant = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    // La même personne revient par le simulateur : nouveau lead, même fiche client.
    const clientId = (await prisma.lead.findUniqueOrThrow({ where: { id: contact.id } })).clientId ?? (await prisma.dossier.findUniqueOrThrow({ where: { id: existant.dossierId } })).clientId;
    const retour = await lead({ clientId });
    await simulation(retour.id, "after");
    const ouverture = await depuisLead.assurerDossierDeSimulation(retour.id);
    assert.deepEqual([ouverture?.dossierId, ouverture?.cree, ouverture?.simulationsRangees], [existant.dossierId, false, 1]);
  });

  test("le filet ne touche que les contacts qui ont un dossier : les autres restent des leads, rejouable", async () => {
    const sansDossier = await lead();
    await simulation(sansDossier.id, "after");
    const avecDossier = await lead();
    const ouvert = await depuisLead.ouvrirDossierDuLead(avecDossier.id, { motif: "BOUTON" });
    await simulation(avecDossier.id, "after");
    const bilan = await depuisLead.rattraperSimulationsSansDossier();
    assert.deepEqual([bilan.dossiersOuverts, bilan.echecs], [0, 0], JSON.stringify(bilan));
    assert.ok(bilan.simulationsRangees >= 1);
    assert.equal(await prisma.dossier.count({ where: { leadId: sansDossier.id } }), 0);
    assert.equal(await prisma.simulation.count({ where: { leadId: avecDossier.id, dossierId: ouvert.dossierId } }), 1);
    assert.deepEqual(await depuisLead.rattraperSimulationsSansDossier(), { contacts: 0, dossiersOuverts: 0, simulationsRangees: 0, photosRangees: 0, echecs: 0 });
  });

  test("image absente du serveur : le dossier ouvert par Lucas le dit dans son historique, et on n'y revient pas", async () => {
    const contact = await lead();
    await prisma.simulation.create({ data: { leadId: contact.id, imageBeforePath: `${contact.id}/perdue/before.jpg`, imageAfterPath: `${contact.id}/perdue/after.png` } });
    const ouverture = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    assert.ok(ouverture.cree);
    assert.equal((await photosDe(ouverture.dossierId)).length, 0);
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: ouverture.dossierId, type: "SIMULATION_SITE" } });
    assert.match(evenement?.contenu ?? "", /introuvables/);
    assert.equal((await depuisLead.rattraperSimulationsSansDossier()).contacts, 0);
  });
});

describe("archiver un dossier : son lead revient dans Leads, avec ses simulations", () => {
  test("archivé puis restauré : rien n'est perdu, jamais de doublon", async () => {
    const archivage = await import("./archivage");
    const contact = await lead({ source: "SITE_SIMULATEUR" });
    await simulation(contact.id, "after");
    const ouvert = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    assert.equal(await prisma.simulation.count({ where: { leadId: contact.id, dossierId: ouvert.dossierId } }), 1);
    await archivage.archiverDossier(ouvert.dossierId, "Ouvert par le rattrapage, jamais traité");
    // Le dossier sort des listes, le lead n'a plus de dossier vivant, ses simulations sont de nouveau les siennes.
    assert.equal(await prisma.dossier.count({ where: { leadId: contact.id } }), 0);
    assert.equal(await prisma.simulation.count({ where: { leadId: contact.id, dossierId: null } }), 1);
    const liste = await entrants.listerLeads({ limite: 500 });
    assert.ok(JSON.stringify(liste).includes(contact.id), "le lead est revenu dans Leads");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: ouvert.dossierId, type: "DOSSIER_ARCHIVE" } }), 1);
    // Restauré : ses simulations lui reviennent, le lead ressort de Leads.
    await archivage.restaurerDossier(ouvert.dossierId);
    assert.equal(await prisma.dossier.count({ where: { leadId: contact.id } }), 1);
    assert.equal(await prisma.simulation.count({ where: { leadId: contact.id, dossierId: ouvert.dossierId } }), 1);
  });

  test("un dossier qui porte de l'argent ne s'archive pas", async () => {
    const archivage = await import("./archivage");
    const contact = await lead();
    const ouvert = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    await prisma.encaissement.create({ data: { dossierId: ouvert.dossierId, payeur: "Essai", montant: 100, moyen: "VIREMENT", recuLe: new Date() } });
    await assert.rejects(() => archivage.archiverDossier(ouvert.dossierId, "essai"), /paiement/);
  });
});

describe("ouvrir un dossier depuis un lead, en un bouton", () => {
  test("tout est repris, le rappel passe sur le dossier, et le lead sort de la liste Leads", async () => {
    const rappel = new Date(Date.now() + 2 * 86_400_000);
    const contact = await lead({ source: "META_ADS", campagne: "Cuisine septembre", publicite: "Avant-après", delaiProjetTexte: "Dans le mois", tailleCuisine: "MOYENNE", rappelLe: rappel, priorite: "PRIORITAIRE", prioriteMotif: "propriétaire, projet sous un mois, Hérault" });
    await prisma.photoLead.create({ data: { leadId: contact.id, chemin: image(`${contact.id}/photos/a.jpg`, 5) } });
    assert.ok((await entrants.listerLeads()).lignes.some((ligne) => ligne.id === contact.id), "avant : dans Leads");

    const ouverture = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    assert.deepEqual([ouverture.cree, ouverture.photosRangees], [true, 1]);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture.dossierId } });
    assert.deepEqual([dossier.clientNom, dossier.clientTelephone, dossier.clientEmail, dossier.objet, dossier.prochaineAction], [`Marie ${contact.nom}`, contact.telephone, contact.email, "Recouvrement de cuisine", "Rappeler"]);
    assert.equal(dossier.prochaineActionDate?.toISOString().slice(0, 10), new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(rappel));
    const note = await prisma.dossierEvenement.findFirst({ where: { dossierId: dossier.id, type: "NOTE_AJOUTEE" } });
    assert.match(note?.contenu ?? "", /Meta[\s\S]*Cuisine septembre[\s\S]*Avant-après[\s\S]*cuisine moyenne[\s\S]*Dans le mois[\s\S]*Hérault/);

    assert.ok(!(await entrants.listerLeads()).lignes.some((ligne) => ligne.id === contact.id), "après : sorti de Leads");
    // Un second clic rend le même dossier.
    assert.deepEqual([(await depuisLead.ouvrirDossierDuLead(contact.id)).dossierId, await prisma.dossier.count({ where: { leadId: contact.id } })], [dossier.id, 1]);
  });

  test("contact archivé : refus clair", async () => {
    const contact = await lead({ archiveLe: new Date(), archiveMotif: "Doublon" });
    await assert.rejects(() => depuisLead.ouvrirDossierDuLead(contact.id), /archivé/);
  });
});
