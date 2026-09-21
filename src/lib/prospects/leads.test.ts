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
});
