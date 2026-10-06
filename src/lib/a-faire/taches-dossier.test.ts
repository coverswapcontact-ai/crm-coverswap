import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-taches-dossier-"));

/**
 * Mission 22 (A3) — les tâches d'un dossier (`tachesDuDossier`, lecture.ts) et le détail complété par
 * `GET /api/dossiers/[id]` (`espace`, `taches` : ajout de champs, le reste inchangé ; `GET /api/a-faire` tel quel).
 * Base d'essai, noms fictifs, aucune requête réseau.
 */
type DossierDetail = import("@/lib/dossiers/types").DossierDetail;

let prisma: typeof import("@/lib/prisma").default;
let lecture: typeof import("./lecture");
let route: typeof import("@/app/api/dossiers/[id]/route");
let NextRequestClasse: typeof import("next/server").NextRequest;

const J = 86_400_000;
let numero = 0;

async function unDossier(nom: string) {
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000000", objet: "Cuisine", source: "ENTRANT" } });
}

async function uneTache(p: { dossierId: string | null; titre?: string; niveau?: number; statut?: string; plusTardJusqua?: Date | null; lot?: string | null }) {
  const n = ++numero;
  return prisma.tacheAFaire.create({
    data: {
      cle: `DEVIS:essai-dossier:${n}`,
      type: "DEVIS",
      source: "DOSSIERS",
      sujetType: p.dossierId ? "DOSSIER" : "SYSTEME",
      sujetId: p.dossierId,
      dossierId: p.dossierId,
      titre: p.titre ?? `Faire le devis · Essai ${n}`,
      raison: "simulation validée hier",
      niveau: p.niveau ?? 3,
      depuis: new Date(Date.now() - J - n * 60_000),
      dureeMin: 10,
      raccourci: JSON.stringify({ genre: "DEVIS", libelle: "Faire le devis", dossierId: p.dossierId, devis: "nouveau" }),
      donnees: "{}",
      lot: p.lot ?? null,
      statut: p.statut ?? "A_FAIRE",
      plusTardJusqua: p.plusTardJusqua ?? null,
    },
  });
}

before(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  lecture = await import("./lecture");
  route = await import("@/app/api/dossiers/[id]/route");
  NextRequestClasse = (await import("next/server")).NextRequest;
});

describe("tachesDuDossier", () => {
  test("les tâches du dossier seulement, celles d'Aujourd'hui d'abord puis Plus tard, hors lot ; rien pour un dossier sans tâche", async () => {
    const [a, b] = await Promise.all([unDossier("Dossier A Essai"), unDossier("Dossier B Essai")]);
    // Onze tâches de niveau 1 ailleurs : la tâche de niveau 3 du dossier A passe au-delà des dix d'Aujourd'hui.
    for (let i = 0; i < 11; i++) await uneTache({ dossierId: b.id, niveau: 1, titre: `Argent ${i}` });
    const chaude = await uneTache({ dossierId: a.id, niveau: 1, titre: "Faire le devis · A chaud" });
    const tiede = await uneTache({ dossierId: a.id, niveau: 3, titre: "Faire le devis · A tiède" });
    const reportee = await uneTache({ dossierId: a.id, statut: "PLUS_TARD", plusTardJusqua: new Date(Date.now() + 2 * J), titre: "Faire le devis · A reportée" });
    await uneTache({ dossierId: a.id, lot: "essai", titre: "En lot" });
    await uneTache({ dossierId: a.id, statut: "FAITE", titre: "Déjà faite" });
    const maintenant = new Date();

    const liste = await lecture.listeTaches(maintenant);
    assert.equal(liste.aujourdhui.length, 10);
    assert.ok(liste.aujourdhui.some((t) => t.id === chaude.id), "la chaude est dans Aujourd'hui");
    assert.ok(!liste.aujourdhui.some((t) => t.id === tiede.id), "la tiède est au-delà des dix");

    const duA = await lecture.tachesDuDossier(a.id, maintenant);
    assert.deepEqual(
      duA.map((t) => t.id),
      [chaude.id, tiede.id, reportee.id]
    );
    assert.ok(duA.every((t) => t.dossierId === a.id));
    assert.deepEqual(duA.map((t) => t.statut), ["A_FAIRE", "A_FAIRE", "PLUS_TARD"]);
    assert.equal((await lecture.tachesDuDossier("inexistant", maintenant)).length, 0);
  });

  test("GET /api/dossiers/[id] rend le détail avec `taches` et `espace` (null sans espace) ; les autres champs restent", async () => {
    const d = await unDossier("Dossier C Essai");
    const t = await uneTache({ dossierId: d.id, niveau: 2, titre: "Faire le devis · C" });
    const reponse = await route.GET(new NextRequestClasse(`http://localhost:3001/api/dossiers/${d.id}`), { params: Promise.resolve({ id: d.id }) });
    assert.equal(reponse.status, 200);
    const detail = (await reponse.json()) as DossierDetail;
    assert.equal(detail.id, d.id);
    assert.equal(detail.clientNom, "Dossier C Essai");
    assert.equal(detail.etape, "QUALIFICATION");
    assert.equal(detail.espace, null);
    assert.deepEqual(detail.taches?.map((x) => x.id), [t.id]);
    assert.equal(detail.taches?.[0].raccourci.genre, "DEVIS");
    for (const champ of ["completude", "paiements", "documents", "evenements", "photos", "notes", "parcours", "delais"]) assert.ok(champ in detail, champ);
  });

  test("un dossier introuvable : 404, comme avant", async () => {
    const reponse = await route.GET(new NextRequestClasse("http://localhost:3001/api/dossiers/absent"), { params: Promise.resolve({ id: "absent" }) });
    assert.equal(reponse.status, 404);
  });
});
