import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 10 : la rétention des sauvegardes — 7 quotidiennes, 4 hebdomadaires,
 * le reste purgé —, pure d'abord (15 copies fictives datées), puis en vrai :
 * le travail quotidien fait la copie du jour et met la purge en file ; la tâche
 * purge et son bilan est journalisé dans Tâches de fond.
 */
const fichierBase = preparerBaseEssai();
process.env.TACHES_DESACTIVEES = "1";

type Module = typeof import("./sauvegarde.mjs");
const charger = (): Promise<Module> => import("./sauvegarde.mjs");
const nom = (jour: string, motif = "quotidienne", heure = "03-15-00-000", gz = false) => `essai-${motif}-${jour}T${heure}Z.db${gz ? ".gz" : ""}`;

/** 7 quotidiennes (16 → 22 septembre), 4 hebdomadaires plus anciennes, 4 de trop. */
const QUOTIDIENNES = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"].map((j) => nom(j));
const HEBDOMADAIRES = [nom("2026-09-11", "quotidienne", "03-15-00-000", true), nom("2026-09-04", "quotidienne", "03-15-00-000", true), nom("2026-08-28", "avant-schema", "08-00-00-000", true), nom("2026-08-21", "quotidienne", "03-15-00-000", true)];
const DE_TROP = [nom("2026-09-09", "quotidienne", "03-15-00-000", true), nom("2026-09-02", "quotidienne", "03-15-00-000", true), nom("2026-08-14", "quotidienne", "03-15-00-000", true), nom("2026-09-15", "quotidienne", "03-15-00-000", true)];
const QUINZE = [...QUOTIDIENNES, ...HEBDOMADAIRES, ...DE_TROP];

let prisma: typeof import("@/lib/prisma").default;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("Rétention des sauvegardes (7 quotidiennes + 4 hebdomadaires)", () => {
  test("la date d'une sauvegarde se lit dans son nom, compressée ou non ; sans date, on ne devine pas", async () => {
    const { dateDuNom } = await charger();
    assert.equal(dateDuNom("essai-quotidienne-2026-09-22T03-15-00-000Z.db")?.toISOString(), "2026-09-22T03:15:00.000Z");
    assert.equal(dateDuNom("essai-avant-schema-2026-09-22T08-18-49-777Z.db.gz")?.toISOString(), "2026-09-22T08:18:49.777Z");
    assert.equal(dateDuNom("copie-a-la-main.db"), null);
  });

  test("15 copies fictives datées : 7 quotidiennes + 4 hebdomadaires gardées, les 4 autres purgées ; une copie sans date reste", async () => {
    const { selectionnerAGarder } = await charger();
    const { garder, purger } = selectionnerAGarder([...QUINZE, "copie-a-la-main.db"]);
    assert.deepEqual(garder.sort(), [...QUOTIDIENNES, ...HEBDOMADAIRES, "copie-a-la-main.db"].sort());
    assert.deepEqual(purger.sort(), [...DE_TROP].sort());
    assert.equal(garder.length, 12);
  });

  test("deux copies le même jour : la plus récente compte pour la quotidienne, l'autre part", async () => {
    const { selectionnerAGarder } = await charger();
    const doublon = nom("2026-09-22", "avant-migration", "18-00-00-000");
    const { garder, purger } = selectionnerAGarder([...QUOTIDIENNES, doublon]);
    assert.ok(garder.includes(doublon));
    assert.ok(purger.includes(nom("2026-09-22")));
    assert.equal(garder.length, 7);
  });

  test("en vrai : copie du jour par le travail quotidien, purge par la tâche, bilan journalisé dans Tâches de fond", async () => {
    const dossier = process.env.SAUVEGARDES_DIR!;
    mkdirSync(dossier, { recursive: true });
    const contenu = readFileSync(fichierBase);
    for (const n of QUINZE) writeFileSync(path.join(dossier, n), n.endsWith(".gz") ? Buffer.from([0x1f, 0x8b, 0x08, 0]) : contenu);
    const { enregistrerTachesSauvegardes, NOM_SAUVEGARDE_QUOTIDIENNE, TYPE_PURGE_SAUVEGARDES, sauvegardeQuotidienne } = await import("./taches");
    const { travauxPeriodiques, traitementDe } = await import("@/lib/taches/registre");
    const { executerTour } = await import("@/lib/taches/executeur");
    enregistrerTachesSauvegardes();
    const travail = travauxPeriodiques().find((t) => t.nom === NOM_SAUVEGARDE_QUOTIDIENNE);
    assert.ok(travail, "le travail quotidien est enregistré");
    assert.ok(traitementDe(TYPE_PURGE_SAUVEGARDES), "la purge est un traitement connu (libellé dans Tâches de fond)");
    await travail.executer(new AbortController().signal);
    // Une copie du jour, une seule : un second passage le même jour n'en refait pas (les copies d'avant sont compressées au passage).
    const { dateDuNom } = await charger();
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const copies = readdirSync(dossier).filter((n) => n.includes("-quotidienne-") && dateDuNom(n)?.toISOString().slice(0, 10) === aujourdhui);
    assert.equal(copies.length, 1, copies.join(", "));
    assert.deepEqual(await sauvegardeQuotidienne(), { faite: false, raison: "déjà faite aujourd'hui" });
    // La purge : mise en file par le travail, exécutée par un tour de l'exécuteur, journalisée.
    const tache = await prisma.tache.findFirstOrThrow({ where: { type: TYPE_PURGE_SAUVEGARDES } });
    assert.equal(tache.statut, "EN_ATTENTE");
    await executerTour(new Date());
    const faite = await prisma.tache.findUniqueOrThrow({ where: { id: tache.id } });
    assert.equal(faite.statut, "TERMINEE");
    const bilan = JSON.parse(faite.resultat ?? "{}") as { gardees: number; purgees: string[]; resume: string };
    // La copie du jour prend la place de la plus ancienne quotidienne (16/09) ; les 4 de trop partent.
    // (La copie d'avant migration faite au démarrage de l'essai, du même jour et plus ancienne que la quotidienne, part aussi.)
    const sansGz = (n: string) => n.replace(/\.gz$/, "");
    const fictives = new Set(QUINZE.map(sansGz));
    assert.deepEqual(bilan.purgees.map(sansGz).filter((n) => fictives.has(n)).sort(), [...DE_TROP, nom("2026-09-16")].map(sansGz).sort());
    assert.equal(bilan.gardees, 11);
    assert.match(bilan.resume, /\d sauvegardes purgées/);
    for (const n of bilan.purgees) assert.equal(existsSync(path.join(dossier, n)), false, n);
    for (const n of HEBDOMADAIRES) assert.equal(existsSync(path.join(dossier, n)), true, n);
    // Le bilan se lit dans Tâches de fond (résumé de la tâche terminée).
    const { etatDesTaches } = await import("@/lib/taches/lecture");
    const vue = (await etatDesTaches()).taches.find((t) => t.id === tache.id);
    assert.equal(vue?.statut, "TERMINEE");
    assert.match(vue?.resume ?? "", /purgée/);
    // Un second tour le même jour : la clé d'idempotence ne rejoue pas la purge.
    await travail.executer(new AbortController().signal);
    assert.equal(await prisma.tache.count({ where: { type: TYPE_PURGE_SAUVEGARDES } }), 1);
  });

  test("la capacité du volume se lit (libre, total, pour cent), et les seuils 70 / 85 s'appliquent", async () => {
    const { capaciteVolume } = await charger();
    const c = capaciteVolume(path.dirname(fichierBase));
    assert.ok(c.total > 0 && c.libre >= 0 && c.libre <= c.total);
    assert.ok(c.pourcentUtilise >= 0 && c.pourcentUtilise <= 100);
    const { niveauDisque, SEUILS_DISQUE } = await import("@/lib/assistant/outils/lecture");
    assert.deepEqual([niveauDisque(69), niveauDisque(70), niveauDisque(84), niveauDisque(85)], ["OK", "ATTENTION", "ATTENTION", "URGENT"]);
    assert.deepEqual(SEUILS_DISQUE, { attention: 70, urgent: 85 });
  });
});
