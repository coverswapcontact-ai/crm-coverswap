import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-publications-"));

let prisma: typeof import("@/lib/prisma").default;
let publications: typeof import("./publications");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  publications = await import("./publications");
});
after(async () => {
  await prisma.$disconnect();
});

describe("publications du CRM vers le site", () => {
  test("une réalisation vient d'un dossier, se publie avec accord et photo après, puis se retire", async () => {
    const client = await prisma.client.create({ data: { nom: "Camille Essai", categorie: "PARTICULIER", prenom: "Camille", nomFamille: "Essai", source: "SITE", premierContactLe: new Date() } });
    const dossier = await prisma.dossier.create({
      data: { clientId: client.id, clientNom: "Camille Essai", clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: "0600000000", objet: "Façades de cuisine", source: "SITE", photos: JSON.stringify(["dossiers/d1/photos/a-11111111.jpg", "dossiers/d1/photos-apres/b-22222222.jpg"]) },
    });
    for (const chemin of ["dossiers/d1/photos/a-11111111.jpg", "dossiers/d1/photos-apres/b-22222222.jpg"]) {
      mkdirSync(path.dirname(path.join(process.env.UPLOADS_DIR!, chemin)), { recursive: true });
      writeFileSync(path.join(process.env.UPLOADS_DIR!, chemin), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    const dispo = await publications.photosDuDossierPourPublication(dossier.id);
    assert.deepEqual(dispo.map((p) => p.apres), [false, true]);

    const brouillon = await publications.creerPublication({ type: "REALISATION", titre: "Cuisine chêne clair", dossierId: dossier.id, clientId: client.id, ville: "Lattes", typeProjet: "CUISINE", photoApres: "dossiers/d1/photos-apres/b-22222222.jpg" });
    assert.equal(brouillon.publieLe, null);
    assert.deepEqual(await publications.publicationsPubliees(), [], "un brouillon n'est pas visible");

    await assert.rejects(() => publications.publierPublication(brouillon.id), /accord écrit/);
    await publications.modifierPublication(brouillon.id, { type: "REALISATION", titre: "Cuisine chêne clair", dossierId: dossier.id, photoApres: "dossiers/d1/photos-apres/b-22222222.jpg", accordClientLe: "2026-09-17" });
    const publiee = await publications.publierPublication(brouillon.id);
    assert.ok(publiee.publieLe);

    const visibles = await publications.publicationsPubliees("https://crm.coverswap.fr");
    assert.equal(visibles.length, 1);
    assert.equal(visibles[0].photoApres, `https://crm.coverswap.fr/api/site/photos/${brouillon.id}/apres`);
    assert.equal(visibles[0].photoAvant, null);
    assert.ok(!("clientId" in visibles[0]), "aucun identifiant de client côté site");
    const photo = await publications.lirePhotoPublique(brouillon.id, "apres");
    assert.equal(photo?.type, "image/jpeg");
    assert.equal(await publications.lirePhotoPublique(brouillon.id, "avant"), null);

    await publications.retirerPublication(brouillon.id);
    assert.deepEqual(await publications.publicationsPubliees(), []);
    assert.equal(await publications.lirePhotoPublique(brouillon.id, "apres"), null, "photo retirée : plus servie");
  });

  test("une photo étrangère au dossier est refusée ; un avis exige son texte", async () => {
    await assert.rejects(() => publications.creerPublication({ type: "REALISATION", titre: "Test", dossierId: "inconnu", photoApres: "x/y.jpg" }), /introuvable|n'appartient/);
    const avis = await publications.creerPublication({ type: "AVIS", titre: "Avis de Julie", auteur: "Julie", note: 5, accordClientLe: "2026-09-17" });
    await assert.rejects(() => publications.publierPublication(avis.id), /texte/);
    const dossiers = await publications.dossiersAvecPhotosApres();
    assert.ok(dossiers.some((d) => d.nbApres === 1));
  });
});
