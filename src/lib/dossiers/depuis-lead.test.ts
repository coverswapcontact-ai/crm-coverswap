import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { ACTIONS_OUVERTURE_AUTO } from "./constants";
import { jourParis } from "./dates";

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
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  depuisLead = await import("./depuis-lead");
  entrants = await import("@/lib/prospects/leads");
  stockage = await import("./stockage");
});
after(async () => {
  await prisma.$disconnect();
});

describe("mission 18 (A2) : le dossier s'ouvre tout seul (simulation, photos, demande de devis du site)", () => {
  test("une simulation terminée ouvre le dossier : Qualification, « Appeler » pour aujourd'hui, images rangées, Prioritaire ; aucun envoi", async () => {
    const mails = await prisma.envoiMail.count();
    const sms = await prisma.sms.count();
    const contact = await lead({ message: "Cuisine de 2012, façades abîmées", occupation: "PROPRIETAIRE", campagne: "Cuisine septembre" });
    await simulation(contact.id, "after");
    const ouverture = await depuisLead.ouvrirDossierAutomatique(contact.id);
    assert.ok(ouverture?.cree, "dossier ouvert tout seul");
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture.dossierId } });
    assert.deepEqual(
      [dossier.leadId, dossier.etape, dossier.prochaineAction, dossier.prochaineActionDate?.toISOString()],
      [contact.id, "QUALIFICATION", ACTIONS_OUVERTURE_AUTO.SIMULATION, `${jourParis(new Date())}T12:00:00.000Z`]
    );
    assert.deepEqual([ouverture.simulationsRangees, (await photosDe(dossier.id)).length], [1, 2], "photo avant et rendu dans les photos du dossier");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: contact.id } })).priorite, "PRIORITAIRE");
    // Il sort des leads sans dossier, mais reste dans « À appeler » tant qu'il n'est pas appelé (la file des appels le garde).
    assert.equal(await prisma.lead.count({ where: { AND: [entrants.LEAD_SANS_DOSSIER, { id: contact.id }] } }), 0);
    assert.ok((await entrants.listerLeads({ vue: "A_APPELER", limite: 500 })).lignes.some((l) => l.id === contact.id && l.dossierId === dossier.id));
    assert.deepEqual([await prisma.envoiMail.count(), await prisma.sms.count()], [mails, sms], "aucun mail ni SMS de plus");
    // Rejouer ne change rien : même dossier, rien de recopié.
    const rejoue = await depuisLead.ouvrirDossierAutomatique(contact.id);
    assert.deepEqual([rejoue?.dossierId, rejoue?.cree, rejoue?.simulationsRangees, rejoue?.photosRangees], [dossier.id, false, 0, 0]);
    assert.equal(await prisma.dossier.count({ where: { leadId: contact.id } }), 1);
  });

  test("demande de devis sans photo : le dossier s'ouvre, « Appeler : demande de devis » ; le formulaire seul, des photos seules aussi", async () => {
    const demande = await lead({ source: "SITE_DEVIS", message: "Devis pour ma cuisine" });
    const ouverture = await depuisLead.ouvrirDossierAutomatique(demande.id, { demande: true });
    assert.ok(ouverture?.cree);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture.dossierId } });
    assert.deepEqual([dossier.etape, dossier.prochaineAction, dossier.source], ["QUALIFICATION", "Appeler : demande de devis", "ENTRANT"]);
    // Le formulaire du site qui a créé le lead suffit (le filet n'a pas l'information « demande » du webhook).
    const formulaire = await lead({ source: "SITE_CONTACT", typeProjet: "SDB" });
    assert.equal((await depuisLead.ouvrirDossierAutomatique(formulaire.id))?.cree, true);
    // Des photos jointes, sans simulation : ouvert, photos rangées.
    const photos = await lead({ source: "SITE_CONTACT", typeProjet: "AUTRE" });
    await prisma.photoLead.create({ data: { leadId: photos.id, chemin: image(`${photos.id}/photos/p.jpg`, 3) } });
    const avecPhotos = await depuisLead.ouvrirDossierAutomatique(photos.id);
    assert.deepEqual([avecPhotos?.cree, avecPhotos?.photosRangees], [true, 1]);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: avecPhotos!.dossierId } })).prochaineAction, "Appeler : demande de devis");
  });

  test("rien de nouveau, rien n'ouvre : ancien lead (avant la règle), simple message, hors zone, contact archivé", async () => {
    const avant = new Date(depuisLead.DEBUT_OUVERTURE_AUTO.getTime() - 10 * 86_400_000);
    const ancien = await lead({ createdAt: avant });
    const vieille = await simulation(ancien.id, "after");
    await prisma.simulation.update({ where: { id: vieille.id }, data: { createdAt: avant } });
    assert.equal(await depuisLead.ouvrirDossierAutomatique(ancien.id), null, "le stock d'avant la règle reste dans Leads");
    const message = await lead({ source: "SITE_CONTACT", typeProjet: "AUTRE" });
    assert.equal(await depuisLead.ouvrirDossierAutomatique(message.id), null, "un simple message n'est pas une demande de devis");
    const horsZone = await lead({ priorite: "A_ECARTER", prioriteManuelle: true });
    await simulation(horsZone.id, "after");
    assert.equal(await depuisLead.ouvrirDossierAutomatique(horsZone.id), null, "hors zone : il reste à classer dans Leads");
    const archive = await lead({ archiveLe: new Date(), archiveMotif: "Essai" });
    await simulation(archive.id, "after");
    assert.equal(await depuisLead.ouvrirDossierAutomatique(archive.id), null);
    assert.equal(await prisma.dossier.count({ where: { leadId: { in: [ancien.id, message.id, horsZone.id, archive.id] } } }), 0);
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
    const suite = await depuisLead.ouvrirDossierAutomatique(contact.id);
    assert.deepEqual([suite?.dossierId, suite?.cree, suite?.simulationsRangees], [dossier.id, false, 1]);
    const rejoue = await depuisLead.ouvrirDossierAutomatique(contact.id);
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
    const ouverture = await depuisLead.ouvrirDossierAutomatique(retour.id);
    assert.deepEqual([ouverture?.dossierId, ouverture?.cree, ouverture?.simulationsRangees], [existant.dossierId, false, 1]);
  });

  test("le filet : un fait récent sans dossier l'ouvre, un dossier vivant reçoit ses images ; ni le stock, ni plus de deux jours, ni un dossier archivé ; rejouable", async () => {
    const sansDossier = await lead();
    await simulation(sansDossier.id, "after");
    const avecDossier = await lead();
    const ouvert = await depuisLead.ouvrirDossierDuLead(avecDossier.id, { motif: "BOUTON" });
    await simulation(avecDossier.id, "after");
    const stock = await lead({ createdAt: new Date(depuisLead.DEBUT_OUVERTURE_AUTO.getTime() - 5 * 86_400_000), source: "SITE_DEVIS" });
    // Un dossier ouvert puis archivé par Lucas ne se rouvre pas tout seul.
    const archiveParLucas = await lead();
    await simulation(archiveParLucas.id, "after");
    const { archiverDossier } = await import("./archivage");
    await archiverDossier((await depuisLead.ouvrirDossierDuLead(archiveParLucas.id, { motif: "BOUTON" })).dossierId, "Essai : doublon");
    // Trois jours plus tard, la simulation d'aujourd'hui est hors de la fenêtre du filet : rien ne s'ouvre (le dossier vivant,
    // lui, reçoit sa simulation, à toute date).
    const plusTard = await depuisLead.rattraperSimulationsSansDossier(200, new Date(Date.now() + 3 * 86_400_000));
    assert.deepEqual([plusTard.dossiersOuverts, plusTard.simulationsRangees], [0, 1], JSON.stringify(plusTard));
    const bilan = await depuisLead.rattraperSimulationsSansDossier();
    assert.deepEqual([bilan.dossiersOuverts, bilan.echecs], [1, 0], JSON.stringify(bilan));
    assert.ok(bilan.simulationsRangees >= 1);
    assert.equal(await prisma.dossier.count({ where: { leadId: sansDossier.id } }), 1);
    assert.equal(await prisma.simulation.count({ where: { leadId: avecDossier.id, dossierId: ouvert.dossierId } }), 1);
    assert.equal(await prisma.dossier.count({ where: { leadId: { in: [stock.id, archiveParLucas.id] } } }), 0);
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
    const filet = await depuisLead.rattraperSimulationsSansDossier();
    assert.equal(filet.contacts, 0, JSON.stringify(filet));
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
    // Mission 14 : un rappel daté le place dans « À rappeler ».
    const dansLeads = async () => (await Promise.all([entrants.listerLeads({ vue: "A_APPELER" }), entrants.listerLeads({ vue: "A_RAPPELER" })])).some((liste) => liste.lignes.some((ligne) => ligne.id === contact.id));
    assert.ok((await entrants.listerLeads({ vue: "A_RAPPELER" })).lignes.some((ligne) => ligne.id === contact.id), "avant : dans Leads, « À rappeler »");

    const ouverture = await depuisLead.ouvrirDossierDuLead(contact.id, { motif: "BOUTON" });
    assert.deepEqual([ouverture.cree, ouverture.photosRangees], [true, 1]);
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: ouverture.dossierId } });
    assert.deepEqual([dossier.clientNom, dossier.clientTelephone, dossier.clientEmail, dossier.objet, dossier.prochaineAction], [`Marie ${contact.nom}`, contact.telephone, contact.email, "Recouvrement de cuisine", "Rappeler"]);
    // Mission 14 (partie 7) : le rappel passe sur le dossier à son heure exacte (plus seulement son jour).
    assert.equal(dossier.prochaineActionDate?.toISOString(), rappel.toISOString());
    const note = await prisma.dossierEvenement.findFirst({ where: { dossierId: dossier.id, type: "NOTE_AJOUTEE" } });
    assert.match(note?.contenu ?? "", /Meta[\s\S]*Cuisine septembre[\s\S]*Avant-après[\s\S]*cuisine moyenne[\s\S]*Dans le mois[\s\S]*Hérault/);

    assert.ok(!(await dansLeads()), "après : sorti de Leads");
    // Un second clic rend le même dossier.
    assert.deepEqual([(await depuisLead.ouvrirDossierDuLead(contact.id)).dossierId, await prisma.dossier.count({ where: { leadId: contact.id } })], [dossier.id, 1]);
  });

  test("contact archivé : refus clair", async () => {
    const contact = await lead({ archiveLe: new Date(), archiveMotif: "Doublon" });
    await assert.rejects(() => depuisLead.ouvrirDossierDuLead(contact.id), /archivé/);
  });
});
