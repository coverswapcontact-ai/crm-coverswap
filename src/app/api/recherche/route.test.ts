import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 22 (lot A0b) — `GET /api/recherche?q=` : refuse moins de deux caractères, rend les candidats de
 * `chercherContacts` avec leur chemin (client, lead, dossier), huit au plus. Noms fictifs.
 */
let GET: typeof import("./route").GET;
let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;

const appel = (q: string) => GET(new NextRequest(`http://localhost:3001/api/recherche?q=${encodeURIComponent(q)}`));

before(async () => {
  ({ GET } = await import("./route"));
  prisma = (await import("@/lib/prisma")).default;
  ({ avecActeur } = await import("@/lib/journal/contexte"));
  await avecActeur({ acteur: "SCRIPT:essai-recherche" }, async () => {
    await prisma.client.create({ data: { nom: "Zoé Essairecherche", ville: "Lattes", source: "SITE", premierContactLe: new Date() } });
    await prisma.lead.create({ data: { prenom: "Yann", nom: "Essairecherche", telephone: "+33612345678", ville: "Pérols", source: "META_ADS" } });
    await prisma.dossier.create({ data: { clientNom: "Xavier Essairecherche", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33698765432", objet: "Cuisine", source: "ENTRANT" } });
  });
});

describe("GET /api/recherche", () => {
  test("moins de deux caractères : 400 avec un message en français", async () => {
    for (const q of ["", " ", "a"]) {
      const reponse = await appel(q);
      assert.equal(reponse.status, 400, q);
      assert.match(((await reponse.json()) as { error: string }).error, /2 caractères/);
    }
  });

  test("un nom : le client, le lead et le dossier, chacun avec son chemin", async () => {
    const reponse = await appel("Essairecherche");
    assert.equal(reponse.status, 200);
    const { resultats } = (await reponse.json()) as { resultats: { type: string; nom: string; chemin: string; etat: string }[] };
    const types = resultats.map((r) => r.type).sort();
    assert.deepEqual(types, ["CLIENT", "DOSSIER", "LEAD"]);
    for (const r of resultats) assert.match(r.chemin, /^\/(clients\/|leads\?lead=|dossiers\?dossier=)/, r.type);
    assert.ok(resultats.every((r) => r.etat.length > 0));
    assert.ok(resultats.length <= 8);
  });

  test("un téléphone : le lead qui le porte", async () => {
    const { resultats } = (await (await appel("06 12 34 56 78")).json()) as { resultats: { type: string; nom: string }[] };
    assert.deepEqual(resultats.map((r) => [r.type, r.nom]), [["LEAD", "Yann Essairecherche"]]);
  });

  test("rien ne correspond : une liste vide, pas une erreur", async () => {
    const reponse = await appel("Introuvable Nulle-Part");
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { resultats: [] });
  });
});
