import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let lecture: typeof import("./lecture");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  lecture = await import("./lecture");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("lecture du journal", () => {
  test("par dossier, par auteur, par pages ; champs changés lisibles, secrets masqués", async () => {
    const dossier = await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr", origine: "POST /api/dossiers" }, () =>
      prisma.dossier.create({ data: { clientNom: "Essai Journal", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000000", objet: "Cuisine", source: "ENTRANT" } })
    );
    await avecActeur({ acteur: "AGENT:mail" }, () => prisma.dossierNote.create({ data: { dossierId: dossier.id, etape: "QUALIFICATION", contenu: "Note de l'agent" } }));
    await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, () => prisma.dossier.update({ where: { id: dossier.id }, data: { objet: "Cuisine et crédence" } }));
    await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, () => prisma.connexionGoogle.create({ data: { compte: "boite@exemple.test", portees: "x", jetonChiffre: "v1:secret" } }));

    const tout = await lecture.lireJournal({ dossierId: dossier.id });
    assert.deepEqual(tout.lignes.map((ligne) => [ligne.modele, ligne.operation]), [
      ["Dossier", "MODIFICATION"],
      ["DossierNote", "CREATION"],
      ["Dossier", "CREATION"],
    ]);
    const modification = tout.lignes[0];
    assert.deepEqual(modification.changements, [{ champ: "objet", avant: "Cuisine", apres: "Cuisine et crédence" }]);
    assert.equal(modification.lien, `/dossiers?dossier=${dossier.id}`);
    assert.equal(modification.libelleActeur, "lucas@coverswap.fr");

    const agent = await lecture.lireJournal({ dossierId: dossier.id, famille: "AGENT" });
    assert.deepEqual(agent.lignes.map((ligne) => ligne.libelleActeur), ["Agent mail"]);

    const premiere = await lecture.lireJournal({ dossierId: dossier.id, limite: 2 });
    assert.equal(premiere.lignes.length, 2);
    assert.ok(premiere.suite);
    const seconde = await lecture.lireJournal({ dossierId: dossier.id, limite: 2, suite: premiere.suite! });
    assert.deepEqual(seconde.lignes.map((ligne) => ligne.operation), ["CREATION"]);
    assert.equal(seconde.suite, null);

    const connexion = await lecture.lireJournal({ modele: "ConnexionGoogle" });
    assert.equal(connexion.lignes[0].changements.find((changement) => changement.champ === "jetonChiffre")?.apres, "•••• (chiffré)");
    assert.equal(JSON.stringify(connexion).includes("v1:secret"), false);
    await assert.rejects(() => lecture.lireJournal({ famille: "PIRATE" }), /Auteur inconnu/);
  });
});
