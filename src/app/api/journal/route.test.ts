import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 22 (A1) — `GET /api/journal` et `POST /api/journal/vu` : sans `depuis`, les 48 dernières heures (puis depuis
 * le dernier « Tout vu ») ; `filtres`, `page`, `par_page` ; « Tout vu » pose JOURNAL_VU_LE et vide la lecture suivante.
 * Noms fictifs, base d'essai.
 */
let GET: typeof import("./route").GET;
let POST: typeof import("./vu/route").POST;
let prisma: typeof import("@/lib/prisma").default;
const H = 3_600_000;

type Corps = { entrees: { id: string; filtre: string; titre: string }[]; total: number; page: number; pages: number; compteurs: Record<string, number>; depuis: string; jusqua: string; vuLe: string | null };
const lire = async (requete = "") => {
  const reponse = await GET(new NextRequest(`http://localhost:3001/api/journal${requete}`));
  assert.equal(reponse.status, 200);
  return (await reponse.json()) as Corps;
};

before(async () => {
  ({ GET } = await import("./route"));
  ({ POST } = await import("./vu/route"));
  prisma = (await import("@/lib/prisma")).default;
  const dossier = await prisma.dossier.create({ data: { clientNom: "Rose Essaijournal", clientAdresse: "4 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0611000030", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE" } });
  await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu: "Le client a déposé 3 photos", createdAt: new Date(Date.now() - 2 * H) } });
  await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "DEVIS_ENVOYE", direction: "SORTANT", contenu: "Devis 2026-050 envoyé", createdAt: new Date(Date.now() - 3 * H) } });
  await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Note d'il y a trois jours", createdAt: new Date(Date.now() - 72 * H) } });
});

describe("GET /api/journal", () => {
  test("sans paramètre : les 48 dernières heures, en phrases, avec les compteurs ; vuLe null tant que rien n'est vu", async () => {
    const corps = await lire();
    assert.equal(corps.vuLe, null);
    assert.ok(Math.abs(new Date(corps.depuis).getTime() - (Date.now() - 48 * H)) < 5_000);
    assert.deepEqual(corps.entrees.map((e) => e.titre).sort(), ["Devis envoyé", "Photos déposées par le client"]);
    assert.deepEqual([corps.total, corps.compteurs.CLIENTS, corps.compteurs.ARGENT, corps.compteurs.SYSTEME], [2, 1, 1, 0]);
  });

  test("depuis explicite (trois jours), filtres=ARGENT, page et par_page", async () => {
    const depuis = encodeURIComponent(new Date(Date.now() - 80 * H).toISOString());
    const tout = await lire(`?depuis=${depuis}`);
    assert.equal(tout.total, 3);
    const argent = await lire(`?depuis=${depuis}&filtres=ARGENT`);
    assert.deepEqual([argent.total, argent.entrees[0].filtre, argent.compteurs.CLIENTS], [1, "ARGENT", 2]);
    const page2 = await lire(`?depuis=${depuis}&par_page=2&page=2`);
    assert.deepEqual([page2.page, page2.pages, page2.entrees.length, page2.total], [2, 2, 1, 3]);
    const inconnu = await lire(`?depuis=${depuis}&filtres=NIMPORTE`);
    assert.equal(inconnu.total, 3, "un filtre inconnu est ignoré");
  });

  test("POST /api/journal/vu pose JOURNAL_VU_LE ; la lecture suivante part de là et ne rend plus rien", async () => {
    const reponse = await POST();
    assert.equal(reponse.status, 200);
    const { vuLe } = (await reponse.json()) as { vuLe: string };
    assert.ok(Date.now() - new Date(vuLe).getTime() < 5_000);
    const lignes = await prisma.parametre.findMany({ where: { cle: "JOURNAL_VU_LE" } });
    assert.deepEqual([lignes.length, JSON.parse(lignes[0].valeur)], [1, vuLe]);
    const apres = await lire();
    assert.deepEqual([apres.vuLe, apres.depuis, apres.total], [vuLe, vuLe, 0]);
  });
});
