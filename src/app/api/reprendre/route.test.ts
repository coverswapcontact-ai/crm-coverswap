import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 22 (A2) — `POST /api/reprendre` et la mémoire serveur de « Reprendre » (paramètre DERNIER_DOSSIER_OUVERT) :
 * une ligne par ouverture, pas deux dans le quart d'heure, le dossier nommé pendant 48 h, rien pour un dossier archivé
 * ou inconnu. Noms fictifs, base d'essai.
 */
let POST: typeof import("./route").POST;
let prisma: typeof import("@/lib/prisma").default;
let serveur: typeof import("@/lib/v2/reprendre-serveur");
let dossierId = "";
const H = 3_600_000;

const poster = (corps: unknown) => POST(new NextRequest("http://localhost:3001/api/reprendre", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) }));

before(async () => {
  ({ POST } = await import("./route"));
  prisma = (await import("@/lib/prisma")).default;
  serveur = await import("@/lib/v2/reprendre-serveur");
  const dossier = await prisma.dossier.create({ data: { clientNom: "Rose Essaireprendre", clientAdresse: "4 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000031", objet: "Cuisine en chêne", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
  dossierId = dossier.id;
});

describe("POST /api/reprendre", () => {
  test("note le dossier (une ligne de paramètre) ; le même dossier dans le quart d'heure n'écrit rien de plus", async () => {
    const premiere = await poster({ dossierId });
    assert.equal(premiere.status, 200);
    assert.deepEqual(await premiere.json(), { note: true });
    const seconde = await poster({ dossierId });
    assert.deepEqual(await seconde.json(), { note: false });
    const lignes = await prisma.parametre.findMany({ where: { cle: serveur.CLE_DERNIER_DOSSIER } });
    assert.equal(lignes.length, 1);
    assert.match(JSON.parse(lignes[0].valeur) as string, new RegExp(`^${dossierId}\\|\\d{4}-\\d{2}-\\d{2}T`));
    assert.equal(lignes[0].source, "Reprendre (Aujourd'hui)");
  });

  test("un corps sans dossierId est refusé (400)", async () => {
    const reponse = await poster({});
    assert.equal(reponse.status, 400);
  });

  test("lireReprendre : le dossier nommé, son chemin inchangé, l'instant ; plus rien après 48 h ; rien pour un inconnu", async () => {
    const maintenant = new Date();
    const lu = await serveur.lireReprendre(maintenant);
    assert.ok(lu);
    assert.equal(lu.chemin, `/dossiers?dossier=${dossierId}`);
    assert.equal(lu.titre, "dossier Rose Essaireprendre · cuisine en chêne");
    assert.equal(lu.dossierId, dossierId);
    assert.ok(maintenant.getTime() - Date.parse(lu.le) < 60_000);
    assert.equal(await serveur.lireReprendre(new Date(maintenant.getTime() + 49 * H)), null, "après 48 h");
    // Un autre dossier, inconnu : noté (un quart d'heure plus tard), mais rien à reprendre.
    const plusTard = new Date(maintenant.getTime() + 20 * 60_000);
    assert.equal(await serveur.noterDossierOuvert("inconnu", plusTard), true);
    assert.equal(await serveur.lireReprendre(plusTard), null);
    assert.equal(await prisma.parametre.count({ where: { cle: serveur.CLE_DERNIER_DOSSIER } }), 2);
  });

  test("un dossier archivé ne se reprend pas", async () => {
    const archive = await prisma.dossier.create({ data: { clientNom: "Jean Essaiarchive", clientAdresse: "5 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000032", objet: "Salle de bain", source: "ENTRANT", etape: "PERDU", archiveLe: new Date() } });
    const dans = new Date(Date.now() + 40 * 60_000);
    assert.equal(await serveur.noterDossierOuvert(archive.id, dans), true);
    assert.equal(await serveur.lireReprendre(dans), null);
  });
});
