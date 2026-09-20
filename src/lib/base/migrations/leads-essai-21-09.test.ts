import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let migration: typeof import("./leads-essai-21-09");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  migration = await import("./leads-essai-21-09");
});
after(async () => {
  await prisma.$disconnect();
});

describe("vérification puis archivage des contacts d'essai du 21/09", () => {
  test("sans ces contacts en base (poste de développement), la migration ne fait rien et ne lève pas", async () => {
    const constat = await migration.migrationLeadsEssai2109.executer(prisma);
    assert.equal(constat.trouve, 0);
    assert.equal(constat.contactsArchives, 0);
  });

  test("le constat dit ce qui est renseigné, puis les deux contacts sont archivés, une seule fois", async () => {
    const [second, premier] = migration.LEADS_ESSAI_21_09;
    await prisma.lead.create({
      data: { id: second, prenom: "ESSAI", nom: "Zapier", telephone: "+33600000021", ville: "Ablis", codePostal: "78660", source: "META_ADS", campagne: "Cuisines", publicite: "Avant/après" },
    });
    await prisma.metaLead.create({ data: { leadgenId: "210900000000001", leadId: second, soumisLe: new Date(), statut: "TRAITE", campagneId: "1", adId: "3", adsetId: "2", adsetNom: "Yvelines" } });
    await prisma.lead.create({ data: { id: premier, prenom: "ESSAI", nom: "Premier", telephone: "+33600000020", ville: "78660", source: "META_ADS", archiveLe: new Date(), archiveMotif: "déjà archivé" } });
    const autre = await prisma.lead.create({ data: { prenom: "Vrai", nom: "Client", telephone: "+33600112299", ville: "Lattes", source: "META_ADS" } });

    const constat = await migration.migrationLeadsEssai2109.executer(prisma);
    assert.deepEqual(
      { ...constat },
      { trouve: 1, ville: 1, codePostal: 1, campagne: 1, ensemble: 1, publicite: 1, identifiantsMeta: 1, sourceMetaAds: 1, telephoneInternational: 1, clientRattache: 0, evenementsMeta: 1, contactsArchives: 1, evenementsArchives: 1 }
    );
    const rejeu = await migration.migrationLeadsEssai2109.executer(prisma);
    assert.equal(rejeu.contactsArchives, 0);
    assert.equal(rejeu.evenementsMeta, 1, "l'événement archivé reste lisible pour le constat");

    assert.ok((await prisma.lead.findUnique({ where: { id: second } }))?.archiveLe);
    assert.equal((await prisma.lead.findUnique({ where: { id: premier } }))?.archiveMotif, "déjà archivé", "un contact déjà archivé n'est pas retouché");
    assert.equal((await prisma.lead.findUnique({ where: { id: autre.id } }))?.archiveLe, null);
  });
});
