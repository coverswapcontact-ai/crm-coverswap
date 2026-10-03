import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-espaces-colonne-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env.
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "META_ACCESS_TOKEN", "META_PIXEL_ID"]) process.env[cle] = "";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (A1) — l'onglet Espaces clients devient une colonne et un filtre de Dossiers : chaque dossier porte l'état
 * de son espace (étape, lien et visite du projet, photos, simulations, devis relu, qui a la main, signaux) ; le filtre
 * « Espaces » est exact sur tous les dossiers qui ont un espace (pas seulement la page de 50) ; la vue par défaut ne
 * change pas ; /espaces redirige vers le filtre ; plus aucun lien vers l'écran retiré. Base d'essai, noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let dossiersLib: typeof import("@/lib/dossiers/dossiers");
let liens: typeof import("@/lib/espace/liens");
let suiviTypes: typeof import("@/lib/espace/suivi-types");
let colonne: typeof import("@/lib/espace/colonne-espace");
let NextRequestClasse: typeof import("next/server").NextRequest;
let route: typeof import("@/app/api/dossiers/route");

const J = 86_400_000;
let numero = 0;
const telephone = () => `+3367${String(1_000_000 + ++numero).padStart(7, "0")}`;
const nouveauDossier = (nom: string, donnees: Record<string, unknown> = {}) =>
  prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: telephone(), objet: "Cuisine", source: "ENTRANT", etape: "QUALIFICATION", ...donnees } });
/** Un dossier et son espace (le projet d'un espace permanent), puis la main posée telle quelle. */
async function avecEspace(nom: string, main: "MOI" | "CLIENT", donnees: Record<string, unknown> = {}) {
  const dossier = await nouveauDossier(nom, donnees);
  const ouvert = await liens.ouvrirEspace(dossier.id);
  await prisma.dossier.update({ where: { id: dossier.id }, data: { main } });
  return { dossierId: dossier.id, espaceId: ouvert.espace.id, permanentId: ouvert.permanent.id };
}
const ids = <T extends { id: string }>(liste: T[]) => liste.map((d) => d.id);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  dossiersLib = await import("@/lib/dossiers/dossiers");
  liens = await import("@/lib/espace/liens");
  suiviTypes = await import("@/lib/espace/suivi-types");
  colonne = await import("@/lib/espace/colonne-espace");
  NextRequestClasse = (await import("next/server")).NextRequest;
  route = await import("@/app/api/dossiers/route");
});
after(async () => {
  await prisma.$disconnect();
});

describe("la colonne Espace", () => {
  test("un dossier avec un espace porte son état (dates du projet, photos, simulations, devis, main) ; sans espace : null", async () => {
    const avec = await avecEspace("Colonne Avec", "CLIENT");
    const vuLe = new Date(Date.now() - 2 * J);
    await prisma.espaceClient.update({ where: { id: avec.espaceId }, data: { premierAccesLe: vuLe, dernierAccesLe: vuLe, nbAcces: 3 } });
    const sans = await nouveauDossier("Colonne Sans");
    const page = await dossiersLib.pageDossiers({ recherche: "Colonne" });
    const lu = page.dossiers.find((d) => d.id === avec.dossierId)!;
    assert.ok(lu.espace, "la colonne est remplie");
    assert.equal(lu.espace.espaceId, avec.espaceId);
    assert.equal(lu.espace.etape, "PHOTOS");
    assert.equal(lu.espace.etapeLibelle, "Photos attendues");
    assert.equal(lu.espace.dernierAccesLe, vuLe.toISOString(), "la dernière visite du PROJET");
    assert.equal(lu.espace.nbAcces, 3);
    assert.deepEqual([lu.espace.photos, lu.espace.simulations, lu.espace.devis, lu.espace.accord, lu.espace.revoque], [0, 0, null, false, false]);
    assert.equal(lu.espace.attente.qui, "CLIENT");
    assert.equal(page.dossiers.find((d) => d.id === sans.id)!.espace, null, "pas d'espace : null (la colonne dit « Pas d'espace »)");
    assert.equal(page.espaces, undefined, "sans filtre, pas de compteurs des espaces");
  });

  test("les signaux du client (projet de plus demandé) vont à son projet le plus récent, avec « à moi »", async () => {
    const client = await prisma.client.create({ data: { nom: "Signal Client-Essai", source: "AUTRE", premierContactLe: new Date() } });
    const ancien = await avecEspace("Signal Ancien", "CLIENT", { clientId: client.id });
    const recent = await avecEspace("Signal Recent", "CLIENT", { clientId: client.id });
    assert.equal(ancien.permanentId, recent.permanentId, "un client, un espace permanent, deux projets");
    await prisma.espaceClient.update({ where: { id: ancien.espaceId }, data: { createdAt: new Date(Date.now() - 10 * J) } });
    await prisma.espacePermanent.update({ where: { id: recent.permanentId }, data: { projetDemandeLe: new Date() } });
    const page = await dossiersLib.pageDossiers({ recherche: "Signal", vue: "TOUS" });
    const espaceDe = (id: string) => page.dossiers.find((d) => d.id === id)!.espace!;
    assert.equal(espaceDe(recent.dossierId).signaux[0]?.code, "PROJET_DEMANDE", "le signal du client, en tête de ceux du projet");
    assert.equal(espaceDe(recent.dossierId).attente.qui, "MOI");
    assert.match(espaceDe(recent.dossierId).attente.libelle, /projet de plus/);
    assert.ok(!espaceDe(ancien.dossierId).signaux.some((s) => s.code === "PROJET_DEMANDE"), "pas en double sur l'ancien projet");
    assert.equal(espaceDe(ancien.dossierId).attente.qui, "CLIENT");
  });
});

describe("le filtre « Espaces » (l'ancien onglet)", () => {
  const moi: string[] = [];
  const chezLeClient: string[] = [];
  const signaux: string[] = [];
  const desactives: string[] = [];
  let perdu = "";

  before(async () => {
    // 56 dossiers avec un espace : au-delà d'une page de 50, le filtre et ses compteurs doivent rester exacts.
    for (let i = 1; i <= 56; i++) {
      const e = await avecEspace(`Filtre Esp ${String(i).padStart(2, "0")}`, i % 2 ? "MOI" : "CLIENT");
      if (i <= 2) {
        await prisma.espacePermanent.update({ where: { id: e.permanentId }, data: { revoqueLe: new Date() } });
        desactives.push(e.dossierId);
        continue;
      }
      if (i % 2) moi.push(e.dossierId);
      else chezLeClient.push(e.dossierId);
      if (i >= 50 && i <= 52) {
        await prisma.espaceClient.update({ where: { id: e.espaceId }, data: { simulationsDemandeesLe: new Date() } });
        signaux.push(e.dossierId);
      }
    }
    const p = await avecEspace("Filtre Esp Perdu", "MOI", { etape: "PERDU" });
    perdu = p.dossierId;
    await nouveauDossier("Filtre Esp Sans Espace");
  });

  test("À moi, Chez le client, Signaux, Désactivés, Tous : exacts au-delà de 50, compteurs sur tous les espaces", async () => {
    const tous = await dossiersLib.pageDossiers({ espace: "TOUS", recherche: "Filtre Esp" });
    assert.deepEqual(tous.espaces, { MOI: moi.length, CLIENT: chezLeClient.length, SIGNAUX: signaux.length, TOUS: moi.length + chezLeClient.length + 1, DESACTIVES: desactives.length });
    assert.equal(tous.total, moi.length + chezLeClient.length + 1, "le dossier perdu compte (projet « non réalisé »), le dossier sans espace non");
    assert.equal(tous.dossiers.length, 50);
    assert.ok(tous.dossiers.every((d) => d.espace), "chaque ligne porte son espace");

    const page1 = await dossiersLib.pageDossiers({ espace: "MOI", recherche: "Filtre Esp", parPage: 20 });
    const page2 = await dossiersLib.pageDossiers({ espace: "MOI", recherche: "Filtre Esp", parPage: 20, page: 2 });
    assert.equal(page1.total, moi.length);
    assert.deepEqual([...ids(page1.dossiers), ...ids(page2.dossiers)].sort(), [...moi].sort(), "les deux pages font tous les dossiers « à moi », sans doublon");
    assert.ok(page1.dossiers.every((d) => d.espace?.attente.qui === "MOI"));

    const client = await dossiersLib.pageDossiers({ espace: "CLIENT", recherche: "Filtre Esp" });
    assert.deepEqual(ids(client.dossiers).sort(), [...chezLeClient].sort());
    const avecSignaux = await dossiersLib.pageDossiers({ espace: "SIGNAUX", recherche: "Filtre Esp" });
    assert.deepEqual(ids(avecSignaux.dossiers).sort(), [...signaux].sort(), "un signal rouge ou ambre (le gris « lien pas encore envoyé » ne compte pas)");
    const off = await dossiersLib.pageDossiers({ espace: "DESACTIVES", recherche: "Filtre Esp" });
    assert.deepEqual(ids(off.dossiers).sort(), [...desactives].sort());
    assert.ok(off.dossiers.every((d) => d.espace?.revoque));
  });

  test("ordre : à moi d'abord, puis chez le client, puis personne (perdu) ; étape de l'espace", async () => {
    const tous = await dossiersLib.pageDossiers({ espace: "TOUS", recherche: "Filtre Esp", parPage: 200 });
    const poids = tous.dossiers.map((d) => ({ MOI: 0, CLIENT: 1, PERSONNE: 2 })[d.espace!.attente.qui]);
    assert.deepEqual(poids, [...poids].sort((a, b) => a - b));
    assert.equal(tous.dossiers.at(-1)!.id, perdu, "le projet non réalisé ferme la liste");
    assert.equal(tous.dossiers.at(-1)!.espace!.fige, "NON_REALISE");
    assert.equal((await dossiersLib.pageDossiers({ espace: "TOUS", etapeEspace: "PHOTOS", recherche: "Filtre Esp", parPage: 200 })).total, tous.total, "tous attendent leurs photos");
    const devis = await dossiersLib.pageDossiers({ espace: "TOUS", etapeEspace: "DEVIS", recherche: "Filtre Esp" });
    assert.equal(devis.total, 0);
    assert.deepEqual(devis.espaces, { MOI: 0, CLIENT: 0, SIGNAUX: 0, TOUS: 0, DESACTIVES: 0 }, "les compteurs suivent l'étape choisie");
  });

  test("la vue par défaut ne change pas : mêmes dossiers, même ordre, mêmes compteurs", async () => {
    const defaut = await dossiersLib.pageDossiers({ recherche: "Filtre Esp" });
    const attendus = await prisma.dossier.findMany({ where: { clientNom: { contains: "Filtre Esp" }, etape: { notIn: ["PERDU", "EN_PAUSE"] } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true } });
    assert.deepEqual(ids(defaut.dossiers), ids(attendus));
    assert.equal(defaut.total, 57, "56 espaces moins le perdu, plus le dossier sans espace");
    assert.ok(!defaut.dossiers.some((d) => d.id === perdu), "le perdu reste hors de « En cours »");
    const avecFiltre = await dossiersLib.pageDossiers({ espace: "TOUS", recherche: "Filtre Esp" });
    assert.deepEqual(avecFiltre.compteurs, defaut.compteurs, "les compteurs de l'en-tête ne dépendent pas du filtre");
  });

  test("la route de l'écran : ?espace=&etapeEspace= (valeurs inconnues ignorées)", async () => {
    const lire = async (requete: string) => (await (await route.GET(new NextRequestClasse(`http://localhost:3001/api/dossiers?${requete}`))).json()) as import("./dossiers").PageDossiers;
    const moiRoute = await lire("espace=MOI&q=Filtre%20Esp");
    assert.equal(moiRoute.total, moi.length);
    assert.deepEqual(moiRoute.espaces, (await dossiersLib.pageDossiers({ espace: "MOI", recherche: "Filtre Esp" })).espaces);
    assert.equal((await lire("espace=MOI&etapeEspace=DEVIS&q=Filtre%20Esp")).total, 0);
    const inconnu = await lire("espace=NIMPORTE&etapeEspace=XYZ&q=Filtre%20Esp");
    assert.equal(inconnu.espaces, undefined, "filtre inconnu : la vue par défaut");
    assert.equal(inconnu.total, 57);
  });
});

describe("règles pures et textes de la colonne", () => {
  const base = { espaceId: "e", etape: "DEVIS" as const, etapeLibelle: "Devis à signer", fige: null, revoque: false, lienEnvoyeLe: "2026-09-20T08:00:00.000Z", premierAccesLe: null, dernierAccesLe: null, nbAcces: 0, creeLe: "2026-09-19T08:00:00.000Z", derniereActivite: null, photos: 3, simulations: 2, devis: { numero: "D-2026-001", consultations: 2 }, accord: false, attente: { qui: "CLIENT" as const, libelle: "Devis à signer" }, signaux: [] };
  const maintenant = new Date("2026-10-01T10:00:00.000Z");

  test("espaceDansLeFiltre : désactivés à part, qui a la main, signaux (pas le gris), étape", () => {
    const f = suiviTypes.espaceDansLeFiltre;
    assert.ok(f(base, "TOUS") && f(base, "CLIENT") && !f(base, "MOI") && !f(base, "DESACTIVES"));
    assert.ok(!f({ ...base, signaux: [{ code: "NON_ENVOYE", libelle: "Lien pas encore envoyé", ton: "gris" }] }, "SIGNAUX"));
    assert.ok(f({ ...base, signaux: [{ code: "HESITE", libelle: "Devis relu 2 fois sans signer", ton: "ambre" }] }, "SIGNAUX"));
    assert.ok(f({ ...base, revoque: true }, "DESACTIVES") && !f({ ...base, revoque: true }, "TOUS"));
    assert.ok(f(base, "TOUS", "DEVIS") && !f(base, "TOUS", "PHOTOS"));
    assert.ok(suiviTypes.estFiltreEspace("SIGNAUX") && !suiviTypes.estFiltreEspace("signaux"));
  });

  test("lien et visite, faits, signal principal, phrase complète", () => {
    assert.equal(colonne.visiteEspace(base, maintenant), "lien envoyé 20 sept., jamais ouvert");
    assert.equal(colonne.visiteEspace({ ...base, dernierAccesLe: "2026-09-30T09:00:00.000Z", nbAcces: 4 }, maintenant), "vu hier (4 visites)");
    assert.equal(colonne.visiteEspace({ ...base, lienEnvoyeLe: null }, maintenant), "lien pas encore envoyé");
    assert.equal(colonne.visiteEspace({ ...base, revoque: true }, maintenant), "lien désactivé");
    assert.deepEqual(colonne.faitsEspace(base), ["3 photos", "2 simulations", "devis lu 2 fois"]);
    assert.deepEqual(colonne.faitsEspace({ ...base, photos: 1, simulations: 0, accord: true }), ["1 photo", "accord donné"]);
    const ambre = { code: "HESITE" as const, libelle: "Devis relu 2 fois sans signer", ton: "ambre" as const };
    const rouge = { code: "DATE_A_FIXER" as const, libelle: "Accord donné : date du chantier à fixer", ton: "rouge" as const };
    assert.equal(colonne.signalPrincipal({ signaux: [ambre, rouge] }), rouge);
    assert.equal(colonne.signalPrincipal({ signaux: [{ code: "NON_ENVOYE", libelle: "Lien pas encore envoyé", ton: "gris" }] }), null);
    assert.equal(colonne.descriptionEspace({ ...base, signaux: [ambre] }, maintenant), "Devis à signer · lien envoyé 20 sept., jamais ouvert · 3 photos · 2 simulations · devis lu 2 fois · chez le client : Devis à signer · signaux : Devis relu 2 fois sans signer");
  });
});

describe("l'adresse /espaces et les liens", () => {
  test("/espaces redirige vers le filtre « Espaces » de Dossiers, sans chaîne, en 307 comme les autres", async () => {
    const config = (await import("../../../next.config")).default;
    const regles = await config.redirects!();
    const regle = regles.find((r) => r.source === "/espaces");
    assert.ok(regle);
    assert.equal(regle.destination, suiviTypes.ADRESSE_ESPACES);
    assert.equal(regle.permanent, false);
    assert.ok(!regles.some((r) => r.source === "/dossiers"), "la destination ne redirige pas");
  });

  test("plus aucun lien vers l'écran retiré dans le code (les routes /api/espaces restent)", () => {
    const racine = path.resolve(__dirname, "..", "..");
    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = path.join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(nom) && !nom.endsWith(".test.ts")) {
          const lignes = readFileSync(chemin, "utf8").split("\n");
          lignes.forEach((ligne, i) => {
            if (/["'`]\/espaces(?![\w/-])/.test(ligne)) fautifs.push(`${path.relative(racine, chemin)}:${i + 1}`);
          });
        }
      }
    };
    parcourir(racine);
    assert.deepEqual(fautifs, []);
    assert.ok(statSync(path.join(racine, "app", "api", "espaces")).isDirectory(), "les routes /api/espaces restent (fiche client, panneau)");
  });
});
