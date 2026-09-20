import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let migration: typeof import("./leads-meta-pont");
let serveur: Server;

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      const code = new URL(requete.url ?? "", "http://x").searchParams.get("codePostal");
      reponse.writeHead(200, { "Content-Type": "application/json" });
      reponse.end(JSON.stringify(code === "78660" ? [{ nom: "Ablis", population: 3913 }] : []));
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  process.env.API_COMMUNES_URL = `http://127.0.0.1:${port}`;
  prisma = (await import("@/lib/prisma")).default;
  migration = await import("./leads-meta-pont");
});
after(async () => {
  await prisma.$disconnect();
  await new Promise<void>((r) => serveur.close(() => r()));
});

describe("reprise des leads Meta du pont Zapier", () => {
  test("un lead écrit par l'ancienne route retrouve sa ligne Meta, son code postal et sa commune", async () => {
    const ancien = await prisma.lead.create({
      data: {
        prenom: "Camille",
        nom: "Martin",
        telephone: "0612345678",
        ville: "78660",
        source: "META_ADS",
        typeProjet: "CUISINE",
        formulaire: "Rénovation cuisine — Yvelines",
        metaLeadgenId: "556677889900112",
        notes: "Form: Rénovation cuisine — Yvelines | FormID: 1122334455667788 | PageID: 998877665544332 | LeadgenID: 556677889900112 | Via: Zapier",
        createdAt: new Date("2026-09-20T09:12:00Z"),
      },
    });

    const compteurs = await migration.migrationLeadsMetaPont.executer(prisma);
    assert.equal(compteurs.evenementsCrees, 1);
    assert.equal(compteurs.codesPostauxRanges, 1);
    assert.equal(compteurs.villesDeduites, 1);
    assert.equal(compteurs.telephonesNormalises, 1);

    const repare = await prisma.lead.findUnique({ where: { id: ancien.id } });
    // Le code postal est rangé où il va, la commune déduite, le numéro normalisé.
    assert.equal(repare?.codePostal, "78660");
    assert.equal(repare?.ville, "Ablis");
    assert.equal(repare?.telephone, "+33612345678");

    // La ligne Meta existe : le lead apparaît enfin dans l'écran Publicité.
    const evenement = await prisma.metaLead.findUnique({ where: { leadgenId: "556677889900112" } });
    assert.equal(evenement?.leadId, ancien.id);
    assert.equal(evenement?.statut, "TRAITE");
    assert.equal(evenement?.formId, "1122334455667788");
    assert.equal(evenement?.pageId, "998877665544332");
    assert.equal(evenement?.soumisLe.toISOString(), "2026-09-20T09:12:00.000Z");
    // Ce qui n'a jamais été écrit ne s'invente pas.
    assert.equal(evenement?.campagneId, null);
  });

  test("rejouée, la reprise ne refait rien", async () => {
    const compteurs = await migration.migrationLeadsMetaPont.executer(prisma);
    assert.deepEqual(compteurs, { evenementsCrees: 0, codesPostauxRanges: 0, villesDeduites: 0, telephonesNormalises: 0 });
  });

  test("l'archivage du contact d'essai ne touche que celui-là, et ne s'applique qu'une fois", async () => {
    const autre = await prisma.lead.create({ data: { prenom: "Vrai", nom: "Client", telephone: "+33600112233", ville: "Lattes", source: "META_ADS" } });
    await prisma.lead.create({
      data: { id: migration.LEAD_ESSAI_PONT_20_09, prenom: "ESSAI", nom: "Pont", telephone: "+33600000077", ville: "Pérols", source: "META_ADS" },
    });
    await prisma.metaLead.create({ data: { leadgenId: "556677889900500", leadId: migration.LEAD_ESSAI_PONT_20_09, soumisLe: new Date(), statut: "TRAITE" } });

    assert.deepEqual(await migration.migrationArchiverLeadEssaiPont.executer(prisma), { contactArchive: 1, evenementArchive: 1 });
    assert.deepEqual(await migration.migrationArchiverLeadEssaiPont.executer(prisma), { contactArchive: 0, evenementArchive: 0 });

    const essai = await prisma.lead.findUnique({ where: { id: migration.LEAD_ESSAI_PONT_20_09 } });
    assert.ok(essai?.archiveLe);
    assert.match(essai?.archiveMotif ?? "", /essai du pont Zapier/);
    // Le vrai contact n'a pas bougé.
    assert.equal((await prisma.lead.findUnique({ where: { id: autre.id } }))?.archiveLe, null);
  });
});
