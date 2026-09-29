import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let menage: typeof import("./menage");
let leads: typeof import("./leads");
let appels: typeof import("@/lib/commercial/appels");
let migration: typeof import("@/lib/base/migrations/menage-leads-de-test");

let rang = 0;
async function lead(donnees: Record<string, unknown> = {}) {
  rang++;
  return prisma.lead.create({ data: { prenom: "Menage", nom: `Lead${rang}`, telephone: `06 20 00 00 ${String(rang).padStart(2, "0")}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
}
/** Mission 14 : sans vue, les deux listes de Leads (« À appeler » puis « À rappeler »). */
const dans = async (id: string, vue?: "ARCHIVES") =>
  (vue ? (await leads.listerLeads({ vue })).lignes : [...(await leads.listerLeads({ vue: "A_APPELER" })).lignes, ...(await leads.listerLeads({ vue: "A_RAPPELER" })).lignes]).find((l) => l.id === id) ?? null;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  menage = await import("./menage");
  leads = await import("./leads");
  appels = await import("@/lib/commercial/appels");
  migration = await import("@/lib/base/migrations/menage-leads-de-test");
});
after(async () => {
  await prisma.$disconnect();
});

describe("actions rapides sur les leads", () => {
  test("archiver avec un motif : hors de Leads et de la file, visible dans Archivés ; annuler le remet", async () => {
    const a = await lead();
    assert.equal((await dans(a.id))?.aAppeler, true);
    assert.deepEqual(await menage.appliquerActionLeads({ action: "ARCHIVER", ids: [a.id], motif: "TEST" }), { ids: [a.id] });
    assert.equal(await dans(a.id), null);
    const archive = await dans(a.id, "ARCHIVES");
    assert.deepEqual([archive?.archiveMotif, archive?.aAppeler], ["Test", false]);
    // Rien n'est supprimé : la fiche existe toujours.
    assert.equal(await prisma.lead.count({ where: { id: a.id, archiveLe: { not: null } } }), 1);
    // Rejouer ne change rien ; « Annuler » = restaurer.
    assert.deepEqual(await menage.appliquerActionLeads({ action: "ARCHIVER", ids: [a.id], motif: "DOUBLON" }), { ids: [] });
    await menage.appliquerActionLeads({ action: "RESTAURER", ids: [a.id] });
    assert.equal((await dans(a.id))?.aAppeler, true);
  });

  test("archiver sans motif est refusé", () => {
    assert.equal(menage.schemaActionLeads.safeParse({ action: "ARCHIVER", ids: ["x"] }).success, false);
  });

  test("mission 14 : « traité / reprendre » n'existent plus ; un lead marqué traité autrefois reste dans les listes", async () => {
    for (const action of ["TRAITER", "REPRENDRE"]) assert.equal(menage.schemaActionLeads.safeParse({ action, ids: ["x"] }).success, false, action);
    const t = await lead({ traiteLe: new Date(Date.now() - 86_400_000) });
    assert.equal((await dans(t.id))?.aAppeler, true, "jamais appelé : « À appeler », traité ou non");
    // Un appel « à rappeler » (rappel déjà passé) : il passe dans « À rappeler », en retard. `traiteLe` n'est plus écrit.
    await appels.noterAppel({ leadId: t.id, issue: "A_RAPPELER", note: "", rappelLe: new Date(Date.now() - 60_000).toISOString() });
    const ligne = await dans(t.id);
    assert.deepEqual([ligne?.aAppeler, ligne?.enRetard], [false, true]);
    assert.ok((await prisma.lead.findUniqueOrThrow({ where: { id: t.id } })).traiteLe, "la colonne reste en base, plus lue ni écrite");
  });

  test("sélection multiple : plusieurs leads archivés ensemble, restaurés ensemble", async () => {
    const [x, y, z] = [await lead(), await lead(), await lead()];
    const { ids } = await menage.appliquerActionLeads({ action: "ARCHIVER", ids: [x.id, y.id, z.id, x.id], motif: "HORS_CIBLE" });
    assert.deepEqual(new Set(ids), new Set([x.id, y.id, z.id]));
    for (const l of [x, y, z]) assert.equal(await dans(l.id), null);
    await menage.appliquerActionLeads({ action: "RESTAURER", ids });
    for (const l of [x, y, z]) assert.ok(await dans(l.id));
  });

  test("lead du simulateur avec dossier, marqué traité autrefois : toujours dans « À appeler » tant qu'il n'est pas appelé ; son dossier reste", async () => {
    const s = await lead({ source: "SITE_SIMULATEUR", priorite: "PRIORITAIRE", traiteLe: new Date() });
    const dossier = await prisma.dossier.create({ data: { leadId: s.id, clientNom: "Simulé", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "", objet: "", source: "ENTRANT", etape: "QUALIFICATION" } });
    assert.equal((await dans(s.id))?.aAppeler, true);
    // Le premier appel noté (sur son dossier) le fait sortir de Leads, vers son dossier.
    await appels.noterAppel({ dossierId: dossier.id, issue: "PAS_DE_REPONSE", note: "" });
    assert.equal(await dans(s.id), null);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).archiveLe, null);
  });
});

describe("ménage des leads de test (migration du 21/09/2026)", () => {
  test("archive les leads de la liste avec le motif « Test », et leur dossier vide ouvert par le rattrapage ; rejouable", async () => {
    const test1 = await prisma.lead.create({ data: { id: "cmu5f6id20008jfc8bkgay56u", prenom: "AUDIT TEST", nom: "Lot C", telephone: "06 00 00 00 28", ville: "", source: "SITE_DEVIS" } });
    const test2 = await prisma.lead.create({ data: { id: "cmu73iywv00089j791ac20609", prenom: "AUDIT TEST", nom: "Panne Simulateur", telephone: "06 00 00 00 32", ville: "", source: "SITE_SIMULATEUR" } });
    const dossierVide = await prisma.dossier.create({ data: { leadId: test2.id, clientNom: "AUDIT TEST", clientAdresse: "", clientCp: "", clientVille: "", clientTelephone: "", objet: "", source: "ENTRANT", etape: "QUALIFICATION" } });
    // Un id de la liste réattribué à un vrai client n'est pas touché.
    const renomme = await prisma.lead.create({ data: { id: "cmr0nj67j00003lj8jsa8ppdb", prenom: "Martine", nom: "Roux", telephone: "06 11 11 11 11", ville: "Sète", source: "META_ADS" } });
    const autre = await lead();

    const bilan = await migration.migrationMenageLeadsDeTest.executer(prisma);
    assert.deepEqual([bilan.leadsArchives, bilan.ignores, bilan.dossiersArchives], [2, 1, 1]);
    for (const id of [test1.id, test2.id]) {
      const l = await prisma.lead.findFirstOrThrow({ where: { id, archiveLe: undefined } });
      assert.deepEqual([Boolean(l.archiveLe), l.archiveMotif], [true, "Test"]);
    }
    assert.ok((await prisma.dossier.findFirstOrThrow({ where: { id: dossierVide.id, archiveLe: undefined } })).archiveLe);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: renomme.id } })).archiveLe, null);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: autre.id } })).archiveLe, null);
    // Rejouée : rien de plus.
    const encore = await migration.migrationMenageLeadsDeTest.executer(prisma);
    assert.deepEqual([encore.leadsArchives, encore.dejaArchives], [0, 2]);
  });
});
