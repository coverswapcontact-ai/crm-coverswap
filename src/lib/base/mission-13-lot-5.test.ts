import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 13 (26/09/2026), lot 5 — finition : accords calculés, titre du
 * dossier sans tiret orphelin, un compteur de lectures par devis (B6) et sa
 * migration de recopie.
 */

let prisma: typeof import("@/lib/prisma").default;
let format: typeof import("@/lib/commun/format");
let service: typeof import("@/lib/espace/service");
let liens: typeof import("@/lib/espace/liens");
let vueCrm: typeof import("@/lib/espace/vue-crm");
let migration: typeof import("@/lib/base/migrations/mission-13-lot-5");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  format = await import("@/lib/commun/format");
  service = await import("@/lib/espace/service");
  liens = await import("@/lib/espace/liens");
  vueCrm = await import("@/lib/espace/vue-crm");
  migration = await import("@/lib/base/migrations/mission-13-lot-5");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("formats partagés", () => {
  test("les accords se calculent : 0 et 1 au singulier, au-delà au pluriel, forme donnée quand un « s » ne suffit pas", () => {
    assert.equal(format.pluriel(0, "relance"), "0 relance");
    assert.equal(format.pluriel(1, "lead"), "1 lead");
    assert.equal(format.pluriel(3, "lead"), "3 leads");
    assert.equal(format.pluriel(2, "photo reçue", "photos reçues"), "2 photos reçues");
    assert.equal(format.accord(1, "ouvert"), "ouvert");
    assert.equal(format.accord(4, "ouvert"), "ouverts");
  });
  test("le titre d'un dossier sans objet est le nom seul (plus de « Nom —  »)", () => {
    assert.equal(format.titreDossier({ clientNom: "Beites Marie", objet: "Recouvrement de cuisine" }), "Beites Marie — Recouvrement de cuisine");
    assert.equal(format.titreDossier({ clientNom: "Beites Marie", objet: "" }), "Beites Marie");
    assert.equal(format.titreDossier({ clientNom: "Beites Marie", objet: "  " }), "Beites Marie");
    assert.equal(format.titreDossier({ clientNom: "Beites Marie" }), "Beites Marie");
  });
});

describe("B6 : un compteur de lectures par devis", () => {
  const lignes = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement des façades", quantite: 6, unite: "ml", prixUnitaire: 120 }]);

  async function espaceAvecDeuxDevis(prenom: string) {
    const lead = await prisma.lead.create({ data: { prenom, nom: "Lecture", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
    const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
    const premier = await prisma.document.create({ data: { dossierId: ouvert.dossierId, type: "DEVIS", numero: `D-${prenom}-1`, dateEmission: new Date(Date.now() - 60_000), objet: "Façades seules", libelleVariante: "façades seules", lignes, totalHt: 720, acomptePct: 30, statut: "ENVOYE" } });
    const second = await prisma.document.create({ data: { dossierId: ouvert.dossierId, type: "DEVIS", numero: `D-${prenom}-2`, dateEmission: new Date(), objet: "Façades et plan", libelleVariante: "façades + plan de travail", lignes, totalHt: 980, acomptePct: 30, statut: "ENVOYE" } });
    return { ...ouvert, premier, second };
  }
  const relire = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
  const lectures = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id }, select: { consultations: true } })).consultations;

  test("chaque devis compte ses propres lectures ; l'espace garde la trace du dernier lu ; la vue CRM les porte par devis", async () => {
    const { espace, dossierId, premier, second } = await espaceAvecDeuxDevis("Yael");
    assert.deepEqual(await service.noterConsultationDevis(espace, second.id), { consultations: 1 });
    assert.deepEqual(await service.noterConsultationDevis(await relire(espace.id), premier.id), { consultations: 1 });
    assert.deepEqual([await lectures(premier.id), await lectures(second.id)], [1, 1]);
    // Une demi-heure plus tard, il rouvre le premier : 2 ; le second n'a pas bougé.
    await prisma.document.update({ where: { id: premier.id }, data: { consulteLe: new Date(Date.now() - 3_600_000) } });
    assert.deepEqual(await service.noterConsultationDevis(await relire(espace.id), premier.id), { consultations: 2 });
    assert.deepEqual([await lectures(premier.id), await lectures(second.id)], [2, 1]);
    const trace = await relire(espace.id);
    assert.deepEqual([trace.devisConsulteId, trace.devisConsultations], [premier.id, 2]);
    const vue = await vueCrm.vueEspaceCrm(dossierId);
    assert.ok(vue);
    assert.deepEqual(
      vue.devisProposes.map((d) => [d.numero, d.consultations, d.consulteLe !== null]),
      [
        ["D-Yael-1", 2, true],
        ["D-Yael-2", 1, true],
      ]
    );
    assert.equal(vue.devis?.consultations, 1, "le devis en vigueur est le dernier émis : ses propres lectures");
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "ESPACE_DEVIS_CONSULTE" }, orderBy: { createdAt: "asc" } });
    assert.equal(evenements.length, 2, "un événement par devis, mis à jour");
    assert.match(evenements.find((e) => e.metadata?.includes(premier.id))?.contenu ?? "", /2 fois/);
  });

  test("migration : le compteur de l'espace est recopié une fois sur le devis, jamais écrasé", async () => {
    const { espace, premier } = await espaceAvecDeuxDevis("Zoe");
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { devisConsulteId: premier.id, devisConsultations: 5, devisConsulteLe: new Date("2026-09-20T10:00:00.000Z") } });
    const premiere = await migration.migrationConsultationsParDevis13.executer(prisma);
    assert.ok(premiere.recopies >= 1);
    assert.equal(await lectures(premier.id), 5);
    await prisma.document.update({ where: { id: premier.id }, data: { consultations: 7 } });
    await migration.migrationConsultationsParDevis13.executer(prisma);
    assert.equal(await lectures(premier.id), 7, "rejouée : rien d'écrasé");
  });
});
