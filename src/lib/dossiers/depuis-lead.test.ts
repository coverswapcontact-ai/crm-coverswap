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

describe("simulation du site → dossier", () => {
  test("une simulation terminée ouvre le dossier, avec la photo avant et le rendu dans ses photos", async () => {
    const contact = await lead({ message: "Cuisine de 2012, façades abîmées", occupation: "PROPRIETAIRE", campagne: "Cuisine septembre" });
    await simulation(contact.id, "after");
    const ouverture = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.ok(ouverture?.cree);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture!.dossierId } });
    assert.deepEqual([dossier.leadId, dossier.etape, dossier.source, dossier.clientVille, dossier.clientCp, dossier.montantEstime, dossier.prochaineAction], [contact.id, "QUALIFICATION", "ENTRANT", "Lattes", "34970", 1450, "Appeler : simulation faite sur le site"]);
    assert.equal((await photosDe(dossier.id)).length, 2, "photo avant + rendu");
    // Il a vu sa cuisine rénovée : Prioritaire d'office (sauf hors zone).
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: contact.id } })).priorite, "PRIORITAIRE");
    // Ce que la personne a dit suit dans la première note ; la simulation s'écrit dans l'histoire du dossier.
    const note = await prisma.dossierEvenement.findFirst({ where: { dossierId: dossier.id, type: "NOTE_AJOUTEE" } });
    assert.match(note?.contenu ?? "", /Cuisine septembre[\s\S]*propriétaire[\s\S]*façades abîmées/);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: dossier.id, type: "SIMULATION_SITE" } }), 1);
    // Le dossier a sa fiche client, la même que le lead.
    assert.equal(dossier.clientId, (await prisma.lead.findUniqueOrThrow({ where: { id: contact.id } })).clientId ?? dossier.clientId);
  });

  test("plusieurs simulations : le même dossier, la photo avant une seule fois, rien n'est recopié deux fois", async () => {
    const contact = await lead();
    await simulation(contact.id, "rendu-1", 11);
    const premiere = await depuisLead.assurerDossierDeSimulation(contact.id);
    await simulation(contact.id, "rendu-2", 11); // même photo avant, autre finition, une heure plus tard
    const seconde = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.deepEqual([seconde?.dossierId, seconde?.cree], [premiere?.dossierId, false]);
    assert.equal((await photosDe(premiere!.dossierId)).length, 3, "1 photo avant + 2 rendus");
    // Rejouer ne change rien.
    const rejoue = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.deepEqual([rejoue?.simulationsRangees, rejoue?.photosRangees], [0, 0]);
    assert.equal((await photosDe(premiere!.dossierId)).length, 3);
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

  test("génération échouée : la photo du visiteur suffit à ouvrir le dossier ; sans photo ni simulation, rien", async () => {
    const sansRien = await lead();
    assert.equal(await depuisLead.assurerDossierDeSimulation(sansRien.id), null);
    const echec = await lead();
    await prisma.photoLead.create({ data: { leadId: echec.id, chemin: image(`${echec.id}/photos/cuisine.jpg`, 3) } });
    const ouverture = await depuisLead.assurerDossierDeSimulation(echec.id);
    assert.deepEqual([ouverture?.cree, ouverture?.photosRangees], [true, 1]);
  });

  test("rattrapage des simulations déjà en base : dossiers ouverts, contacts archivés laissés de côté, rejouable", async () => {
    const ancien = await lead();
    await simulation(ancien.id, "after");
    const essai = await lead({ archiveLe: new Date(), archiveMotif: "Lead d'essai" });
    await simulation(essai.id, "after");
    const bilan = await depuisLead.rattraperSimulationsSansDossier();
    assert.ok(bilan.dossiersOuverts >= 1 && bilan.echecs === 0, JSON.stringify(bilan));
    assert.equal(await prisma.dossier.count({ where: { leadId: ancien.id } }), 1);
    assert.equal(await prisma.dossier.count({ where: { leadId: essai.id } }), 0);
    assert.deepEqual(await depuisLead.rattraperSimulationsSansDossier(), { contacts: 0, dossiersOuverts: 0, simulationsRangees: 0, photosRangees: 0, echecs: 0 });
  });

  test("simulation ancienne (rattrapage) : le dossier porte la date réelle de la simulation", async () => {
    const contact = await lead({ createdAt: new Date("2026-07-02T09:00:00.000Z") });
    const ancienne = await simulation(contact.id, "after");
    await prisma.simulation.update({ where: { id: ancienne.id }, data: { createdAt: new Date("2026-07-03T10:00:00.000Z") } });
    const ouverture = await depuisLead.assurerDossierDeSimulation(contact.id);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture!.dossierId } });
    assert.equal(dossier.ouvertLe?.toISOString().slice(0, 10), "2026-07-03");
  });

  test("image absente du serveur : le dossier s'ouvre quand même, l'événement le dit, et on n'y revient pas", async () => {
    const contact = await lead();
    await prisma.simulation.create({ data: { leadId: contact.id, imageBeforePath: `${contact.id}/perdue/before.jpg`, imageAfterPath: `${contact.id}/perdue/after.png` } });
    const ouverture = await depuisLead.assurerDossierDeSimulation(contact.id);
    assert.ok(ouverture?.cree);
    assert.equal((await photosDe(ouverture!.dossierId)).length, 0);
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: ouverture!.dossierId, type: "SIMULATION_SITE" } });
    assert.match(evenement?.contenu ?? "", /introuvables/);
    assert.equal((await depuisLead.rattraperSimulationsSansDossier()).contacts, 0);
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
