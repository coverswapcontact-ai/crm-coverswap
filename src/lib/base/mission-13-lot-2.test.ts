import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.SAUVEGARDES_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-sauvegardes-m13-"));
process.env.GOOGLE_CLIENT_ID = "client-essai";
process.env.GOOGLE_CLIENT_SECRET = "secret-essai";
process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
process.env.NEXTAUTH_URL = "http://localhost:3108";
delete process.env.TURSO_DATABASE_URL;
delete process.env.SAUVEGARDE_CLE;

/**
 * Mission 13 (26/09/2026), lot 2 — sécurité : le secret des webhooks dans
 * l'en-tête (l'adresse tolérée 30 jours), l'alerte au plafond d'écritures de
 * l'assistant, la révocation du lien d'espace 90 jours après « encaissé », la
 * sauvegarde hebdomadaire chiffrée vers Google Drive (et sa restauration).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let secret: typeof import("@/lib/acces/secret-webhook");
let chiffrement: typeof import("./chiffrement-sauvegarde.mjs");
let sauvegardeDrive: typeof import("./sauvegarde-drive");
let revocation: typeof import("@/lib/espace/revocation");
let alertes: typeof import("@/lib/synthese/alertes");
let google: typeof import("@/lib/google/connexion");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR_MS = 86_400_000;

/* ── Faux Google, au plus juste : jetons, Drive (dossier, envoi, lecture) ── */
type ElementFaux = { id: string; name: string; parents: string[]; trashed: boolean; contenu: Buffer };
const drive = new Map<string, ElementFaux>();
let compteur = 0;
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });

async function fauxGoogle(url: string, init: RequestInit = {}): Promise<Response> {
  const methode = init.method ?? "GET";
  const adresse = new URL(url);
  if (adresse.href.startsWith("https://oauth2.googleapis.com/token")) {
    const corps = new URLSearchParams(String(init.body));
    if (corps.get("grant_type") === "authorization_code") return json({ access_token: "acces-1", refresh_token: "renouvellement-secret", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive.file" });
    return json({ access_token: `acces-${++compteur}`, expires_in: 3600 });
  }
  if (adresse.href.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "coverswap.essai@example.test" });
  const segments = adresse.pathname.split("/");
  const id = segments.at(-1) !== "files" ? segments.at(-1)! : null;
  if (methode === "GET" && id) {
    const element = drive.get(id);
    return element ? json({ id: element.id, name: element.name, parents: element.parents, trashed: element.trashed }) : json({ error: { message: "File not found" } }, 404);
  }
  if (methode === "POST" && adresse.pathname.startsWith("/upload/drive/v3/files")) {
    // Envoi multipart (< 5 Mo) : métadonnées JSON, puis le contenu binaire, séparés par la frontière de l'en-tête.
    const frontiere = /boundary=(.+)$/.exec(String((init.headers as Record<string, string>)["Content-Type"]))![1];
    const texte = Buffer.from(init.body as Uint8Array).toString("latin1");
    const parties = texte.split(`--${frontiere}`);
    const metadonnees = JSON.parse(parties[1].split("\r\n\r\n")[1].trim()) as { name: string; parents?: string[] };
    const contenu = Buffer.from(parties[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""), "latin1");
    const cree: ElementFaux = { id: `f${++compteur}`, name: metadonnees.name, parents: metadonnees.parents ?? ["racine"], trashed: false, contenu };
    drive.set(cree.id, cree);
    return json({ id: cree.id });
  }
  if (methode === "POST") {
    const metadonnees = JSON.parse(String(init.body)) as { name: string; parents?: string[] };
    const cree: ElementFaux = { id: `f${++compteur}`, name: metadonnees.name, parents: metadonnees.parents ?? ["racine"], trashed: false, contenu: Buffer.alloc(0) };
    drive.set(cree.id, cree);
    return json({ id: cree.id });
  }
  return json({ error: { message: `Méthode non simulée : ${methode} ${adresse.pathname}` } }, 405);
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  secret = await import("@/lib/acces/secret-webhook");
  chiffrement = await import("./chiffrement-sauvegarde.mjs");
  sauvegardeDrive = await import("./sauvegarde-drive");
  revocation = await import("@/lib/espace/revocation");
  alertes = await import("@/lib/synthese/alertes");
  google = await import("@/lib/google/connexion");
  await (await import("@/lib/base/preparation")).preparerBase();
  google.definirTransportGoogleEssai(fauxGoogle);
});
after(async () => {
  google.definirTransportGoogleEssai(null);
  await prisma.$disconnect();
});

describe("secret des webhooks : en-tête d'abord, adresse tolérée jusqu'au 26/10/2026", () => {
  const requete = (options: { entete?: string; adresse?: string }) => new Request(`https://crm.coverswap.fr/api/webhook/zapier${options.adresse ? `?secret=${options.adresse}` : ""}`, { headers: options.entete ? { "X-Webhook-Secret": options.entete } : {} });
  const avant = new Date("2026-09-27T12:00:00Z");
  const apres = new Date("2026-10-26T00:00:00Z");

  test("l'en-tête passe ; l'adresse passe avant la date et plus après ; un en-tête faux n'est pas rattrapé par l'adresse", () => {
    const secrets = ["secret-essai"];
    assert.deepEqual(secret.secretDeLaRequete(requete({ entete: "secret-essai" })), { valeur: "secret-essai", source: "en-tete" });
    assert.deepEqual(secret.secretDeLaRequete(requete({ adresse: "secret-essai" })), { valeur: "secret-essai", source: "adresse" });
    assert.deepEqual(secret.secretDeLaRequete(requete({})), { valeur: null, source: null });
    assert.equal(secret.secretRequeteValide(requete({ entete: "secret-essai" }), "essai", secrets, avant), true);
    assert.equal(secret.secretRequeteValide(requete({ entete: "secret-essai" }), "essai", secrets, apres), true, "l'en-tête ne se périme pas");
    assert.equal(secret.secretRequeteValide(requete({ adresse: "secret-essai" }), "essai", secrets, avant), true, "toléré jusqu'au 26/10/2026");
    assert.equal(secret.secretRequeteValide(requete({ adresse: "secret-essai" }), "essai", secrets, apres), false, "refusé à partir du 26/10/2026");
    assert.equal(secret.secretRequeteValide(requete({ entete: "faux", adresse: "secret-essai" }), "essai", secrets, avant), false);
    assert.equal(secret.secretRequeteValide(requete({ entete: "faux" }), "essai", secrets, avant), false);
    assert.equal(secret.secretRequeteValide(requete({}), "essai", secrets, avant), false);
  });
});

describe("assistant : le plafond d'écritures atteint est une alerte", () => {
  test("un refus « Plafond … » dans l'heure → alerte PLAFOND_ASSISTANT ; un refus plus vieux, non", async () => {
    const session = await prisma.sessionAssistant.create({ data: { jour: "2026-09-26", jetonId: "jeton-essai-m13", clientNom: "Claude" } });
    const refus = (createdAt: Date) => prisma.appelOutil.create({ data: { sessionId: session.id, outil: "noter_appel", niveau: "REVERSIBLE", parametres: "{}", statut: "REFUSE", erreur: "Plafond de sécurité : plus de 60 écritures en une heure.", dureeMs: 3, createdAt } });
    await refus(new Date(Date.now() - 3 * 3_600_000));
    assert.equal((await alertes.calculerAlertes()).some((a) => a.code === "PLAFOND_ASSISTANT"), false, "un refus d'il y a trois heures ne compte plus");
    await refus(new Date(Date.now() - 5 * 60_000));
    const alerte = (await alertes.calculerAlertes()).find((a) => a.code === "PLAFOND_ASSISTANT");
    assert.ok(alerte, "alerte attendue");
    assert.equal(alerte.gravite, "ATTENTION");
    assert.match(alerte.detail, /^1 action refusée dans l'heure : plus de 60 écritures en une heure/);
  });
});

describe("espace client : lien désactivé 90 jours après « encaissé »", () => {
  async function espace(nom: string, etape: string, encaisseIlYaJours: number | null, code: string) {
    const client = await prisma.client.create({ data: { nom, source: "ENTRANT", premierContactLe: new Date() } });
    const dossier = await prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000020", objet: "Cuisine", source: "ENTRANT", etape, clientId: client.id } });
    const permanent = await prisma.espacePermanent.create({ data: { code, clientId: client.id } });
    await prisma.espaceClient.create({ data: { code: `${code}-P1`, dossierId: dossier.id, expireLe: new Date("2099-01-01T00:00:00Z"), permanentId: permanent.id } });
    if (encaisseIlYaJours !== null) {
      await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Facturé → Encaissé", metadata: JSON.stringify({ de: "FACTURE", vers: "ENCAISSE", nature: "AUTOMATIQUE" }), createdAt: new Date(Date.now() - encaisseIlYaJours * JOUR_MS) } });
    }
    return { permanentId: permanent.id, dossierId: dossier.id };
  }

  test("encaissé depuis 100 jours : révoqué avec le motif ; encaissé depuis 10 jours ou encore signé : non ; rejoué : rien", async () => {
    const vieux = await espace("Client Terminé", "ENCAISSE", 100, "ESSAI-M13-A");
    const recent = await espace("Client Récent", "ENCAISSE", 10, "ESSAI-M13-B");
    const enCours = await espace("Client En Cours", "SIGNE", null, "ESSAI-M13-C");

    const candidats = await revocation.espacesARevoquer();
    assert.deepEqual(candidats.map((c) => c.permanentId), [vieux.permanentId]);
    const bilan = await avecActeur(LUCAS, () => revocation.revoquerEspacesTermines());
    assert.deepEqual(bilan.revoques.map((r) => r.clientNom), ["Client Terminé"]);
    assert.ok(bilan.examines >= 3);
    const permanents = await prisma.espacePermanent.findMany({ where: { id: { in: [vieux.permanentId, recent.permanentId, enCours.permanentId] } }, select: { id: true, revoqueLe: true } });
    assert.deepEqual(permanents.map((p) => [p.id, p.revoqueLe !== null]).sort(), [[vieux.permanentId, true], [recent.permanentId, false], [enCours.permanentId, false]].sort());
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: vieux.dossierId, type: "ESPACE_LIEN_DESACTIVE" } });
    assert.match(evenement?.contenu ?? "", /désactivé \(automatique : 90 jours après l'encaissement du dernier chantier/);
    assert.deepEqual((await avecActeur(LUCAS, () => revocation.revoquerEspacesTermines())).revoques, []);
  });
});

describe("sauvegarde chiffrée : format, clé, restauration", () => {
  test("chiffré puis déchiffré à l'identique ; mauvaise clé ou mauvais fichier refusés ; sans variable, pas de clé", () => {
    const cle = chiffrement.cleSauvegarde()!;
    assert.equal(cle.length, 32);
    const clair = Buffer.from("SQLite format 3\u0000 — contenu d'essai —");
    const chiffre = chiffrement.chiffrerTampon(clair, cle);
    assert.equal(chiffre.subarray(0, 5).toString("latin1"), "CSWB1");
    assert.ok(!chiffre.includes(Buffer.from("contenu d'essai")), "rien en clair");
    assert.deepEqual(chiffrement.dechiffrerTampon(chiffre, cle), clair);
    assert.throws(() => chiffrement.dechiffrerTampon(chiffre, chiffrement.cleSauvegarde(randomBytes(32).toString("base64"))!));
    assert.throws(() => chiffrement.dechiffrerTampon(Buffer.from("pas une sauvegarde"), cle), /CSWB1/);
    assert.equal(chiffrement.cleSauvegarde(""), null);
    assert.equal(chiffrement.cleSauvegarde("trop-court"), null);
    // La clé dérivée n'est pas la clé des jetons Google.
    assert.notDeepEqual(cle, Buffer.from(process.env.GOOGLE_TOKEN_KEY!, "base64"));
  });
});

describe("sauvegarde hebdomadaire vers Google Drive", () => {
  test("sans clé : définitif ; sans Google : attend ; connecté : copie vérifiée, gzip, chiffrée, envoyée dans le dossier Drive, relisible", async () => {
    const cleAvant = process.env.GOOGLE_TOKEN_KEY;
    delete process.env.GOOGLE_TOKEN_KEY;
    await assert.rejects(sauvegardeDrive.sauvegardeVersDrive(), (e: Error) => e.name === "ErreurDefinitive" && /Clé de chiffrement absente/.test(e.message));
    process.env.GOOGLE_TOKEN_KEY = cleAvant;
    assert.match((await sauvegardeDrive.empechementSauvegardeDrive()) ?? "", /Google Drive non connecté/);
    await assert.rejects(sauvegardeDrive.sauvegardeVersDrive(), (e: Error) => e.name === "AttenteExterne");

    const { etat } = google.debuterConnexion();
    await google.terminerConnexion({ code: "code", etat, etatAttendu: etat, erreur: null });
    assert.equal(await sauvegardeDrive.empechementSauvegardeDrive(), null);

    const maintenant = new Date("2026-09-26T12:00:00Z");
    const bilan = await avecActeur(LUCAS, () => sauvegardeDrive.sauvegardeVersDrive(maintenant));
    assert.equal(bilan.nom, "crm-coverswap-2026-09-26-2026-S39.db.gz.chiffre");
    assert.equal(bilan.semaine, "2026-S39");
    assert.ok(bilan.octetsBase > 0 && bilan.octetsEnvoyes > 0);
    const dossier = drive.get(bilan.dossierDriveId)!;
    assert.equal(dossier.name, sauvegardeDrive.NOM_DOSSIER_DRIVE);
    const fichier = drive.get(bilan.driveId)!;
    assert.deepEqual([fichier.name, fichier.parents], [bilan.nom, [bilan.dossierDriveId]]);
    assert.equal(fichier.contenu.length, bilan.octetsEnvoyes);
    // Restauration : déchiffrer avec la clé dérivée, décompresser, une base SQLite entière.
    const clair = gunzipSync(chiffrement.dechiffrerTampon(fichier.contenu, chiffrement.cleSauvegarde()!));
    assert.equal(clair.subarray(0, 15).toString("latin1"), "SQLite format 3");
    assert.equal(clair.length, bilan.octetsBase);
    // Le dossier Drive est retrouvé, pas recréé ; la semaine suivante donne un autre nom.
    const bis = await avecActeur(LUCAS, () => sauvegardeDrive.sauvegardeVersDrive(new Date("2026-10-03T12:00:00Z")));
    assert.deepEqual([bis.dossierDriveId, bis.nom], [bilan.dossierDriveId, "crm-coverswap-2026-10-03-2026-S40.db.gz.chiffre"]);
    assert.equal([...drive.values()].filter((e) => e.name === sauvegardeDrive.NOM_DOSSIER_DRIVE).length, 1);
    assert.equal((await prisma.reglageTexte.findUnique({ where: { cle: "SAUVEGARDE_DRIVE_DOSSIER_ID" } }))?.valeur, bilan.dossierDriveId);
  });

  test("semaine ISO", () => {
    assert.equal(sauvegardeDrive.semaineIso(new Date("2026-01-01T12:00:00Z")), "2026-S01");
    assert.equal(sauvegardeDrive.semaineIso(new Date("2026-09-26T12:00:00Z")), "2026-S39");
    assert.equal(sauvegardeDrive.semaineIso(new Date("2027-01-03T12:00:00Z")), "2026-S53");
  });
});
