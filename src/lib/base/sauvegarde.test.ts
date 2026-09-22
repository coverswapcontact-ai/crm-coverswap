import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

const fichierBase = preparerBaseEssai();

/**
 * 22/09/2026 : les sauvegardes accumulées ont rempli le volume de production
 * (500 Mo) ; la copie d'avant migration a échoué, le démarrage s'est arrêté.
 * Désormais les anciennes sont archivées compressées (jamais perdues), une copie
 * inachevée est retirée, et sans la place d'une copie on s'arrête sans rien toucher.
 */

type Module = typeof import("./sauvegarde.mjs");
const charger = (): Promise<Module> => import("./sauvegarde.mjs");
const sha = (octets: Buffer) => createHash("sha256").update(octets).digest("hex");
const dossierSauvegardes = () => process.env.SAUVEGARDES_DIR!;

describe("Sauvegardes : la place du volume", () => {
  test("une sauvegarde archivée se relit à l'octet près, l'original ne part qu'après vérification", async () => {
    const { compresserSauvegarde } = await charger();
    const dossier = mkdtempSync(path.join(tmpdir(), "coverswap-archive-"));
    const original = path.join(dossier, "base-avant-x.db");
    const contenu = readFileSync(fichierBase);
    writeFileSync(original, contenu);
    const archive = await compresserSauvegarde(original);
    assert.equal(archive, `${original}.gz`);
    assert.equal(existsSync(original), false);
    assert.equal(sha(gunzipSync(readFileSync(archive))), sha(contenu));
    assert.ok(readFileSync(archive).length < contenu.length / 2, "une base SQLite se compresse bien");
    assert.deepEqual(readdirSync(dossier), ["base-avant-x.db.gz"], "aucun fichier provisoire ne reste");
  });

  test("la place manque : les plus anciennes sont compressées d'abord, et seulement ce qu'il faut", async () => {
    const { assurerPlace } = await charger();
    const dossier = mkdtempSync(path.join(tmpdir(), "coverswap-place-"));
    const contenu = readFileSync(fichierBase);
    ["a", "b", "c"].forEach((nom, i) => {
      const chemin = path.join(dossier, `base-avant-${nom}.db`);
      writeFileSync(chemin, contenu);
      utimesSync(chemin, new Date(2026, 8, 10 + i), new Date(2026, 8, 10 + i));
    });
    // Place libre simulée : suffisante dès que deux archives existent.
    const libre = (d: string) => (readdirSync(d).filter((n) => n.endsWith(".gz")).length >= 2 ? 1e12 : 0);
    await assurerPlace(dossier, 1000, libre);
    assert.deepEqual(readdirSync(dossier).sort(), ["base-avant-a.db.gz", "base-avant-b.db.gz", "base-avant-c.db"]);
  });

  test("les copies inachevées sont retirées ; une copie de l'échec du 22/09 qui s'ouvre intègre est gardée", async () => {
    const { assurerPlace } = await charger();
    const dossier = mkdtempSync(path.join(tmpdir(), "coverswap-inachevees-"));
    writeFileSync(path.join(dossier, "base-avant-y.db.partiel"), "moitié de copie");
    writeFileSync(path.join(dossier, "base-avant-schema-2026-09-22T08-18-41-482Z.db"), Buffer.concat([readFileSync(fichierBase).subarray(0, 8192), Buffer.alloc(100)]));
    writeFileSync(path.join(dossier, "base-avant-schema-2026-09-22T08-18-45-001Z.db"), "");
    writeFileSync(path.join(dossier, "base-avant-schema-2026-09-22T08-18-49-777Z.db"), readFileSync(fichierBase));
    writeFileSync(path.join(dossier, "base-avant-schema-2026-09-16T08-18-41-482Z.db"), "une vieille copie d'un autre jour : jamais touchée ici");
    await assurerPlace(dossier, 1000, () => 1e12);
    assert.deepEqual(readdirSync(dossier).sort(), ["base-avant-schema-2026-09-16T08-18-41-482Z.db", "base-avant-schema-2026-09-22T08-18-49-777Z.db"]);
  });

  test("sans la place d'une copie, arrêt : rien de retiré, aucune copie à moitié écrite", async () => {
    const { sauvegarderBase } = await charger();
    mkdirSync(dossierSauvegardes(), { recursive: true });
    const avant = readdirSync(dossierSauvegardes());
    await assert.rejects(sauvegarderBase({ raison: "essai-plein", libre: () => 0 }), /place insuffisante/);
    const apres = readdirSync(dossierSauvegardes());
    assert.equal(apres.filter((n) => n.endsWith(".partiel")).length, 0);
    assert.equal(apres.filter((n) => n.endsWith(".db") || n.endsWith(".gz")).length, avant.length);
  });

  test("chaque sauvegarde archive la précédente : une copie en clair, les autres compressées et intactes", async () => {
    const { sauvegarderBase } = await charger();
    const premiere = await sauvegarderBase({ raison: "essai-1" });
    assert.ok("fichier" in premiere);
    const contenuPremiere = readFileSync(premiere.fichier);
    const seconde = await sauvegarderBase({ raison: "essai-2" });
    assert.ok("fichier" in seconde);
    const noms = readdirSync(dossierSauvegardes());
    assert.deepEqual(noms.filter((n) => n.endsWith(".db")), [path.basename(seconde.fichier)]);
    assert.ok(noms.includes(`${path.basename(premiere.fichier)}.gz`));
    assert.equal(sha(gunzipSync(readFileSync(`${premiere.fichier}.gz`))), sha(contenuPremiere));
    assert.equal(noms.filter((n) => n.endsWith(".partiel")).length, 0);
  });
});
