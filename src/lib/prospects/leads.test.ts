import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let leads: typeof import("./leads");

const MAINTENANT = new Date("2026-09-21T09:00:00.000Z");
const ilYA = (minutes: number) => new Date(MAINTENANT.getTime() - minutes * 60_000);

let rang = 0;
async function lead(donnees: Record<string, unknown>) {
  rang++;
  return prisma.lead.create({ data: { prenom: "Test", nom: `Lead${rang}`, telephone: `06 10 00 00 ${String(rang).padStart(2, "0")}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
}

const dossierDe = (leadId: string, clientNom: string, etape: string) =>
  prisma.dossier.create({ data: { leadId, clientNom, etape, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "", objet: "Recouvrement de cuisine", source: "ENTRANT" } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  leads = await import("./leads");
});
after(async () => {
  await prisma.$disconnect();
});

describe("section Leads", () => {
  test("ordre chronologique, le plus récent en haut — la priorité ne change pas l'ordre", async () => {
    const ancien = await lead({ createdAt: ilYA(300), priorite: "PRIORITAIRE" });
    const recent = await lead({ createdAt: ilYA(3), priorite: "SECONDAIRE" });
    const { lignes } = await leads.listerLeads({}, MAINTENANT);
    const ids = lignes.map((l) => l.id);
    assert.ok(ids.indexOf(recent.id) < ids.indexOf(ancien.id));
    const ligne = lignes.find((l) => l.id === recent.id)!;
    assert.deepEqual([ligne.telephone, ligne.telephoneLien, ligne.priorite, ligne.attendDepuis, ligne.aAppeler], [ligne.telephone, `tel:+3361000${String(rang).padStart(4, "0")}`, "SECONDAIRE", recent.createdAt.toISOString(), true]);
  });

  test("à appeler : jamais appelé depuis moins de 60 jours, ou rappel échu ; ni « à écarter », ni appelé sans rappel", async () => {
    const neuf = await lead({ createdAt: ilYA(10) });
    const vieux = await lead({ createdAt: ilYA(90 * 1440) });
    const horsZone = await lead({ createdAt: ilYA(10), priorite: "A_ECARTER" });
    const rappelEchu = await lead({ createdAt: ilYA(90 * 1440), statut: "CONTACTE", rappelLe: ilYA(30) });
    const rappelFutur = await lead({ createdAt: ilYA(60), rappelLe: new Date(MAINTENANT.getTime() + 86_400_000) });
    const appele = await lead({ createdAt: ilYA(60), statut: "CONTACTE" });
    await prisma.interaction.create({ data: { leadId: appele.id, type: "APPEL", contenu: "Appel — Intéressé" } });

    const avant = await leads.compterLeadsAAppeler(MAINTENANT);
    const { lignes, compteurs } = await leads.listerLeads({}, MAINTENANT);
    const etat = Object.fromEntries(lignes.map((l) => [l.id, l.aAppeler]));
    assert.deepEqual([etat[neuf.id], etat[vieux.id], etat[horsZone.id], etat[rappelEchu.id], etat[rappelFutur.id], etat[appele.id]], [true, false, false, true, false, false]);
    // Le compteur de la navigation compte exactement ce que la file d'appels propose.
    assert.equal(compteurs.aAppeler, lignes.filter((l) => l.aAppeler).length);
    assert.equal(avant, compteurs.aAppeler);
    // Tous restent dans la liste : seul un dossier fait sortir un lead.
    for (const l of [neuf, vieux, horsZone, rappelEchu, rappelFutur, appele]) assert.ok(l.id in etat, l.nom);
  });

  test("sans suite à part ; archivé et lead avec dossier absents", async () => {
    const perdu = await lead({ statut: "PERDU" });
    const archive = await lead({ archiveLe: new Date(), archiveMotif: "Essai" });
    const actifs = (await leads.listerLeads({}, MAINTENANT)).lignes.map((l) => l.id);
    const sansSuite = (await leads.listerLeads({ vue: "SANS_SUITE" }, MAINTENANT)).lignes.map((l) => l.id);
    assert.deepEqual([actifs.includes(perdu.id), sansSuite.includes(perdu.id), actifs.includes(archive.id), sansSuite.includes(archive.id)], [false, true, false, false]);
  });

  test("lead du simulateur : dossier ouvert, mais dans Leads et la file tant qu'il n'est pas appelé — puis il sort", async () => {
    const simule = await lead({ createdAt: ilYA(8), source: "SITE_SIMULATEUR", priorite: "PRIORITAIRE" });
    await prisma.simulation.create({ data: { leadId: simule.id, createdAt: ilYA(9), referenceChoisie: "K1", prixDevis: 1450, imageBeforePath: `${simule.id}/s/before.jpg`, imageAfterPath: `${simule.id}/s/after.png` } });
    const dossier = await dossierDe(simule.id, "Test Simulé", "QUALIFICATION");
    // Un lead ordinaire avec dossier, lui, n'est pas dans Leads.
    const ordinaire = await lead({ createdAt: ilYA(8) });
    await dossierDe(ordinaire.id, "Test Ordinaire", "QUALIFICATION");

    let liste = await leads.listerLeads({}, MAINTENANT);
    const ligne = liste.lignes.find((l) => l.id === simule.id);
    assert.ok(ligne, "le lead du simulateur est dans Leads");
    assert.deepEqual([ligne!.simulation, ligne!.dossierId, ligne!.aAppeler, ligne!.simulations.length, ligne!.simulations[0].apres], [true, dossier.id, true, 1, `/api/uploads/${simule.id}/s/after.png`]);
    assert.ok(!liste.lignes.some((l) => l.id === ordinaire.id), "un lead ordinaire avec dossier n'y est pas");
    assert.equal(liste.compteurs.aAppeler, liste.lignes.filter((l) => l.aAppeler).length);
    // Aucun doublon : un seul dossier, une seule ligne.
    assert.equal(liste.lignes.filter((l) => l.id === simule.id).length, 1);
    assert.equal(await prisma.dossier.count({ where: { leadId: simule.id } }), 1);

    // Un appel noté (sur le dossier, comme le fait la fin d'appel) : il sort de Leads et de la file, il reste dans Dossiers.
    await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "APPEL", direction: "SORTANT", contenu: "Appel — Pas de réponse" } });
    liste = await leads.listerLeads({}, MAINTENANT);
    assert.ok(!liste.lignes.some((l) => l.id === simule.id));
    assert.equal(liste.compteurs.aAppeler, liste.lignes.filter((l) => l.aAppeler).length);
    assert.equal(await prisma.dossier.count({ where: { id: dossier.id, archiveLe: null } }), 1);
  });

  test("lead du simulateur : plus de 60 jours, dossier passé au devis, ou hors zone — pas dans la file", async () => {
    const vieux = await lead({ createdAt: ilYA(70 * 1440), source: "SITE_SIMULATEUR", priorite: "PRIORITAIRE" });
    await dossierDe(vieux.id, "Vieux", "QUALIFICATION");
    const devis = await lead({ createdAt: ilYA(30), source: "SITE_SIMULATEUR", priorite: "PRIORITAIRE" });
    await dossierDe(devis.id, "Devis", "DEVIS_ENVOYE");
    const horsZone = await lead({ createdAt: ilYA(30), source: "SITE_SIMULATEUR", priorite: "A_ECARTER" });
    await dossierDe(horsZone.id, "Hors zone", "QUALIFICATION");
    // Revenu faire une simulation la semaine dernière : ses 60 jours repartent de là.
    const revenu = await lead({ createdAt: ilYA(90 * 1440), source: "META_ADS", priorite: "PRIORITAIRE" });
    await prisma.simulation.create({ data: { leadId: revenu.id, createdAt: ilYA(7 * 1440) } });
    await dossierDe(revenu.id, "Revenu", "SIMULATION");

    const { lignes, compteurs } = await leads.listerLeads({}, MAINTENANT);
    const etat = Object.fromEntries(lignes.map((l) => [l.id, l.aAppeler]));
    assert.deepEqual([vieux.id in etat, devis.id in etat, etat[horsZone.id], etat[revenu.id]], [false, false, false, true]);
    assert.equal(compteurs.aAppeler, lignes.filter((l) => l.aAppeler).length);
    assert.equal(await leads.compterLeadsAAppeler(MAINTENANT), compteurs.aAppeler);
  });
});
