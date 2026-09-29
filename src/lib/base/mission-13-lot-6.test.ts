import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { SOURCES_CLIENT } from "@/lib/clients/constantes";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 13 (26/09/2026), lot 6 — photos en trois versions (original hors
 * ligne, 1 600 px servie, vignette 320 px) et leur reprise par lots ; listes
 * chargées une page à la fois ; les doublons cherchés sans balayer la base.
 */

let prisma: typeof import("@/lib/prisma").default;
let dossiersLib: typeof import("@/lib/dossiers/dossiers");
let stockage: typeof import("@/lib/dossiers/stockage");
let images: typeof import("@/lib/fichiers/images");
let redimensionnement: typeof import("@/lib/fichiers/redimensionnement");
let leadsLib: typeof import("@/lib/prospects/leads");
let fiches: typeof import("@/lib/clients/fiches");
let suivi: typeof import("@/lib/espace/suivi");
let liens: typeof import("@/lib/espace/liens");
let creation: typeof import("@/lib/prospects/creation-assistant");
let racine: string;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.UPLOADS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "coverswap-lot6-"));
  dossiersLib = await import("@/lib/dossiers/dossiers");
  stockage = await import("@/lib/dossiers/stockage");
  images = await import("@/lib/fichiers/images");
  redimensionnement = await import("@/lib/fichiers/redimensionnement");
  leadsLib = await import("@/lib/prospects/leads");
  fiches = await import("@/lib/clients/fiches");
  suivi = await import("@/lib/espace/suivi");
  liens = await import("@/lib/espace/liens");
  creation = await import("@/lib/prospects/creation-assistant");
  racine = path.resolve((await import("@/lib/uploads")).resolveUploadsDir());
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

const jpegGrand = () => sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({ quality: 90 }).toBuffer();
const dimensions = async (contenu: Buffer) => {
  const meta = await sharp(contenu).metadata();
  return [meta.width, meta.height];
};
const nouveauDossier = (nom: string, donnees: Record<string, unknown> = {}) =>
  prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue", clientCp: "34970", clientVille: "Lattes", clientTelephone: `+3363${Math.floor(Math.random() * 9e7 + 1e7)}`, objet: "Cuisine", source: "ENTRANT", etape: "QUALIFICATION", ...donnees } });

describe("dates", () => {
  test("debutDuJourParis : minuit à Paris, en septembre (UTC+2) comme en janvier (UTC+1)", async () => {
    const dates = await import("@/lib/dossiers/dates");
    assert.equal(dates.debutDuJourParis(new Date("2026-09-29T10:00:00.000Z")).toISOString(), "2026-09-28T22:00:00.000Z");
    assert.equal(dates.debutDuJourParis(new Date("2026-01-15T10:00:00.000Z")).toISOString(), "2026-01-14T23:00:00.000Z");
    assert.equal(dates.debutDuJourParis(new Date("2026-09-29T23:30:00.000Z")).toISOString(), "2026-09-29T22:00:00.000Z", "23 h 30 UTC : déjà le 30 à Paris");
  });
});

describe("photos : trois versions", () => {
  test("au dépôt : servie ≤ 1 600 px, vignette ≤ 320 px, original hors ligne ; une image illisible est servie telle quelle ; retirée, tout part aux archives", async () => {
    const dossier = await nouveauDossier("Photo Versions");
    const contenu = await jpegGrand();
    const vue = await dossiersLib.ajouterPhoto(dossier.id, new File([new Uint8Array(contenu)], "cuisine.jpg", { type: "image/jpeg" }));
    assert.match(vue.vignette, /\?taille=vignette$/);
    assert.deepEqual(await dimensions((await dossiersLib.lirePhoto(dossier.id, vue.id)).contenu), [1600, 1067]);
    assert.deepEqual(await dimensions((await dossiersLib.lirePhoto(dossier.id, vue.id, "vignette")).contenu), [320, 213]);
    const chemin = stockage.lirePhotos((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).photos)[0];
    const original = await fs.readFile(path.join(racine, images.cheminOriginal(chemin)));
    assert.equal(original.length, contenu.length, "l'original est gardé tel quel, hors ligne");
    assert.ok((await fs.stat(path.join(racine, chemin))).size < contenu.length, "la version servie est plus légère");

    const illisible = await dossiersLib.ajouterPhoto(dossier.id, new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], "vide.jpg", { type: "image/jpeg" }));
    assert.equal((await dossiersLib.lirePhoto(dossier.id, illisible.id, "vignette")).contenu.length, 4, "pas de vignette : la version servie prend le relais");

    await dossiersLib.supprimerPhoto(dossier.id, vue.id);
    await assert.rejects(fs.access(path.join(racine, chemin)));
    await assert.rejects(fs.access(path.join(racine, images.cheminOriginal(chemin))));
    await assert.rejects(fs.access(path.join(racine, images.cheminVignette(chemin))));
  });

  test("photos d'avant : la reprise par lots met l'original hors ligne et écrit les versions, une seule fois", async () => {
    const dossier = await nouveauDossier("Photo Ancienne");
    const chemin = `dossiers/${dossier.id}/photos/ancienne.jpg`;
    await fs.mkdir(path.dirname(path.join(racine, chemin)), { recursive: true });
    await fs.writeFile(path.join(racine, chemin), await jpegGrand());
    await prisma.dossier.update({ where: { id: dossier.id }, data: { photos: JSON.stringify([chemin]) } });
    const bilan = await redimensionnement.redimensionnerUnLot(1, 100, racine);
    assert.ok(bilan.faites >= 1);
    assert.equal(bilan.restantes, 0);
    assert.deepEqual(await dimensions(await fs.readFile(path.join(racine, chemin))), [1600, 1067]);
    assert.deepEqual(await dimensions(await fs.readFile(path.join(racine, images.cheminVignette(chemin)))), [320, 213]);
    assert.ok(await images.estDejaTraitee(racine, chemin));
    const encore = await redimensionnement.redimensionnerUnLot(2, 100, racine);
    assert.equal(encore.faites, 0, "rejouée : rien à refaire");
    assert.ok(encore.dejaFaites >= 1);
  });
});

describe("listes : une page à la fois", () => {
  test("dossiers : 50 par page, total et compteurs, filtres serveur (recherche, à faire)", async () => {
    for (let i = 1; i <= 55; i++) await nouveauDossier(`Page Essai ${String(i).padStart(2, "0")}`, { main: i % 2 ? "MOI" : "CLIENT" });
    const premiere = await dossiersLib.pageDossiers({ page: 1, recherche: "Page Essai" });
    assert.equal(premiere.dossiers.length, 50);
    assert.equal(premiere.total, 55);
    assert.equal(premiere.parPage, 50);
    const seconde = await dossiersLib.pageDossiers({ page: 2, recherche: "Page Essai" });
    assert.equal(seconde.dossiers.length, 5);
    assert.equal((await dossiersLib.pageDossiers({ recherche: "Page Essai 07" })).total, 1);
    const aFaire = await dossiersLib.pageDossiers({ vue: "A_FAIRE", recherche: "Page Essai" });
    assert.equal(aFaire.total, 28, "la main à moi : les impairs");
    assert.ok(premiere.compteurs.enCours >= 55);
    assert.ok(premiere.compteurs.aFaire >= 28);
  });

  test("leads, clients, espaces : la page demandée et le total", async () => {
    for (const prenom of ["Paul", "Pia", "Pam"]) await prisma.lead.create({ data: { prenom, nom: "Pagination", telephone: `+3364${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", source: "AUTRE" } });
    const leads = await leadsLib.listerLeads({ page: 1, parPage: 2, recherche: "Pagination" });
    assert.equal(leads.lignes.length, 2);
    assert.equal(leads.total, 3);
    assert.equal((await leadsLib.listerLeads({ page: 2, parPage: 2, recherche: "Pagination" })).lignes.length, 1);

    for (const nom of ["Client Page A", "Client Page B", "Client Page C"]) await prisma.client.create({ data: { nom, source: SOURCES_CLIENT[0], premierContactLe: new Date() } });
    const clients = await fiches.pageClients({ page: 1, parPage: 2, recherche: "Client Page" });
    assert.equal(clients.clients.length, 2);
    assert.equal(clients.total, 3);
    assert.equal((await fiches.pageClients({ page: 2, parPage: 2, recherche: "Client Page" })).clients.length, 1);

    const avant = (await suivi.pageClientsEspaces(new Date(), { page: 1, parPage: 100 })).total;
    for (const prenom of ["Esp1", "Esp2"]) {
      const lead = await prisma.lead.create({ data: { prenom, nom: "Espace", telephone: `+3365${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
      await liens.ouvrirEspaceDuContact(lead.id);
    }
    const page = await suivi.pageClientsEspaces(new Date(), { page: 1, parPage: 1 });
    assert.equal(page.clients.length, 1);
    assert.equal(page.total, avant + 2);
    assert.equal((await suivi.pageClientsEspaces(new Date(), { page: 2, parPage: 1 })).clients.length, 1);
  });
});

describe("plus de N+1", () => {
  test("les doublons se cherchent par numéro, e-mail ou mot du nom, sans charger tous les leads", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Zora", nom: "Doublon-Essai", telephone: "+33612121299", email: "zora@exemple.fr", ville: "Lattes", source: "AUTRE" } });
    const parTelephone = await creation.reperDoublonsContact({ telephone: "06 12 12 12 99" });
    assert.ok(parTelephone.some((d) => d.type === "LEAD" && d.id === lead.id), "par téléphone");
    const parEmail = await creation.reperDoublonsContact({ email: "Zora@Exemple.fr" });
    assert.ok(parEmail.some((d) => d.id === lead.id), "par e-mail");
    const parNom = await creation.reperDoublonsContact({ prenom: "Zora", nom: "Doublon-Essai", ville: "Lattes" });
    assert.ok(parNom.some((d) => d.id === lead.id), "par nom et ville");
    assert.equal((await creation.reperDoublonsContact({ prenom: "Personne", nom: "Inconnue-Essai" })).length, 0);
  });
});
