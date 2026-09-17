import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-site-"));

let prisma: typeof import("@/lib/prisma").default;
let simulations: typeof import("./simulations");
let evenements: typeof import("./evenements");

// 1 pixel PNG / JPEG : assez pour écrire un fichier
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PARCOURS = "2da1e0ba-6768-44d0-bf46-24f28a50136a";

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  simulations = await import("./simulations");
  evenements = await import("./evenements");
});
after(async () => {
  await prisma.$disconnect();
});

describe("simulations du site avant coordonnées", () => {
  test("gardée avec ses images, puis rattachée au lead du parcours avec images déplacées", async () => {
    const gardee = await simulations.enregistrerSimulationSite({
      parcoursId: PARCOURS,
      projet: "cuisine",
      references: [{ zone: "zone1", libelle: "Crédence", ref: "A4", nom: "Orangey Wenge" }],
      imageAvantBase64: PIXEL,
      imageApresBase64: PIXEL,
      page: "/simulateur",
      source: "instagram",
    });
    assert.ok(gardee.imageBeforePath && gardee.imageAfterPath);
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, gardee.imageBeforePath!)));

    const lead = await prisma.lead.create({ data: { nom: "Essai", prenom: "Parcours", telephone: "0600000099", ville: "Pérols", source: "SITE_SIMULATEUR" } });
    const creees = await simulations.rattacherSimulationsSite(lead.id, PARCOURS, []);
    assert.equal(creees.length, 1);
    const simulation = await prisma.simulation.findUnique({ where: { id: creees[0] } });
    assert.ok(simulation?.imageBeforePath?.startsWith(`${lead.id}/`), "image déplacée sous le lead");
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, simulation!.imageAfterPath!)));
    assert.equal(simulation?.referenceChoisie, "A4");
    const site = await prisma.simulationSite.findUnique({ where: { id: gardee.id } });
    assert.equal(site?.leadId, lead.id);
    assert.equal(site?.imageBeforePath, null, "plus d'image côté parcours");

    // Un second rattachement ne recrée rien
    assert.deepEqual(await simulations.rattacherSimulationsSite(lead.id, PARCOURS, [gardee.id]), []);
  });

  test("purge : sans demande après 30 jours, images effacées et ligne archivée ; les récentes restent", async () => {
    const vieille = await simulations.enregistrerSimulationSite({ parcoursId: "aaaaaaaa-0000-0000-0000-000000000001", projet: "meubles", references: [], imageAvantBase64: PIXEL, imageApresBase64: PIXEL });
    const recente = await simulations.enregistrerSimulationSite({ parcoursId: "aaaaaaaa-0000-0000-0000-000000000002", projet: "meubles", references: [], imageAvantBase64: PIXEL, imageApresBase64: PIXEL });
    await prisma.simulationSite.update({ where: { id: vieille.id }, data: { createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) } });
    const n = await simulations.purgerSimulationsSite();
    assert.equal(n, 1);
    assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, vieille.imageBeforePath!)), false);
    const archivee = await prisma.simulationSite.findFirst({ where: { archiveLe: { not: null }, id: vieille.id } });
    assert.ok(archivee && archivee.imageBeforePath === null && archivee.ipOrigine === null);
    assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, recente.imageBeforePath!)), "la récente garde ses images");
  });
});

describe("événements du site", () => {
  test("synthèse : parcours, entonnoir, par source et par page", async () => {
    const jour = new Date().toISOString().slice(0, 10);
    const envoyer = (parcoursId: string, type: (typeof evenements.TYPES_EVENEMENT_SITE)[number], page: string, source?: string) =>
      evenements.enregistrerEvenementSite({ parcoursId, type, page, source: source ?? null });
    await envoyer("p1", "PAGE_VUE", "/", "instagram");
    await envoyer("p1", "SIMULATION_LANCEE", "/simulateur", "instagram");
    await envoyer("p1", "SIMULATION_RESULTAT", "/simulateur", "instagram");
    await envoyer("p1", "DEVIS_DEMANDE", "/simulateur", "instagram");
    await envoyer("p2", "PAGE_VUE", "/prestations/cuisine");
    await envoyer("p2", "SIMULATION_LANCEE", "/simulateur");
    await envoyer("p3", "PAGE_VUE", "/");
    const s = await evenements.syntheseSite(jour, jour);
    assert.equal(s.parcours, 3);
    assert.equal(s.parType.find((l) => l.cle === "SIMULATION_LANCEE")?.valeur, 2);
    assert.equal(s.tauxCompletionSimulateur, 50);
    assert.equal(s.tauxDevisApresResultat, 100);
    assert.deepEqual(s.parSource.map((l) => [l.cle, l.parcours, l.simulations, l.devis]), [["direct", 2, 1, 0], ["instagram", 1, 1, 1]]);
    assert.ok(s.parPage.some((l) => l.cle === "/simulateur" && l.simulations === 2));
    assert.equal(evenements.estTypeEvenementSite("N'IMPORTE_QUOI"), false);
  });
});
