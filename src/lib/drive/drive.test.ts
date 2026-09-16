import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";
process.env.GOOGLE_CLIENT_ID = "client-essai";
process.env.GOOGLE_CLIENT_SECRET = "secret-essai";
process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
process.env.NEXTAUTH_URL = "http://localhost:3107";

let prisma: typeof import("@/lib/prisma").default;
let google: typeof import("@/lib/google/connexion");
let miroir: typeof import("./synchronisation");
let dossiers: typeof import("@/lib/dossiers/dossiers");

/* ── Faux Google : jetons et Drive en mémoire ─────────────────────── */

type ElementFaux = { id: string; name: string; parents: string[]; trashed: boolean; dossier: boolean; contenu: string };
const drive = new Map<string, ElementFaux>();
const appels: { methode: string; url: string }[] = [];
let jetonRevoque = false;
let compteur = 0;

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json" } });
}

async function fauxGoogle(url: string, init: RequestInit = {}): Promise<Response> {
  const methode = init.method ?? "GET";
  appels.push({ methode, url });
  const adresse = new URL(url);
  if (adresse.href.startsWith("https://oauth2.googleapis.com/token")) {
    const corps = new URLSearchParams(String(init.body));
    if (corps.get("grant_type") === "authorization_code") {
      return json({ access_token: "acces-1", refresh_token: "renouvellement-secret", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send" });
    }
    return jetonRevoque ? json({ error: "invalid_grant" }, 400) : json({ access_token: `acces-${++compteur}`, expires_in: 3600 });
  }
  if (adresse.href.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "coverswap.essai@example.test" });
  if (adresse.href.startsWith("https://oauth2.googleapis.com/revoke")) return json({});

  const envoi = adresse.pathname.startsWith("/upload/drive/v3/files");
  const segments = adresse.pathname.split("/");
  const id = segments.at(-1) !== "files" ? segments.at(-1)! : null;
  let metadonnees: Record<string, unknown> = {};
  let contenu = "";
  if (envoi) {
    const texte = Buffer.from(init.body as Uint8Array).toString("utf8");
    const parties = texte.split(/--coverswap-[0-9a-f]+/);
    metadonnees = JSON.parse(parties[1].split("\r\n\r\n")[1].trim());
    contenu = parties[2].split("\r\n\r\n").slice(1).join("\r\n\r\n");
  } else if (init.body) {
    metadonnees = JSON.parse(String(init.body));
  }

  if (methode === "POST") {
    const nouveau: ElementFaux = {
      id: `f${++compteur}`,
      name: String(metadonnees.name),
      parents: (metadonnees.parents as string[] | undefined) ?? ["racine-drive"],
      trashed: false,
      dossier: metadonnees.mimeType === "application/vnd.google-apps.folder",
      contenu,
    };
    drive.set(nouveau.id, nouveau);
    return json({ id: nouveau.id });
  }
  const element = id ? drive.get(id) : undefined;
  if (!element) return json({ error: { message: "File not found" } }, 404);
  if (methode === "GET") return json({ id: element.id, name: element.name, parents: element.parents, trashed: element.trashed });
  if (methode === "PATCH") {
    if (metadonnees.name) element.name = String(metadonnees.name);
    if (envoi) element.contenu = contenu;
    const ajout = adresse.searchParams.get("addParents");
    const retrait = adresse.searchParams.get("removeParents");
    if (ajout) element.parents = [...element.parents.filter((parent) => !(retrait ?? "").split(",").includes(parent)), ajout];
    return json({ id: element.id });
  }
  return json({ error: { message: `Méthode non simulée : ${methode}` } }, 405);
}

function chemin(id: string): string {
  const element = drive.get(id);
  if (!element) return "?";
  const parent = element.parents[0];
  return parent && drive.has(parent) ? `${chemin(parent)}/${element.name}` : element.name;
}
const chemins = () => [...drive.values()].filter((element) => !element.trashed).map((element) => chemin(element.id)).sort();

const photo = (contenu: string) => new File([Buffer.from(contenu)], "photo.jpg", { type: "image/jpeg" });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  google = await import("@/lib/google/connexion");
  miroir = await import("./synchronisation");
  dossiers = await import("@/lib/dossiers/dossiers");
  await (await import("@/lib/base/preparation")).preparerBase();
  google.definirTransportGoogleEssai(fauxGoogle);
});

after(async () => {
  google.definirTransportGoogleEssai(null);
  await prisma.$disconnect();
});

describe("connexion Google", () => {
  test("état vérifié, jeton gardé chiffré, compte affiché", async () => {
    const { url, etat } = google.debuterConnexion();
    assert.match(url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.match(decodeURIComponent(url), /drive\.file/);
    assert.match(url, /access_type=offline/);

    await assert.rejects(() => google.terminerConnexion({ code: "code", etat: "autre", etatAttendu: etat, erreur: null }), /invalide ou expiré/);
    await assert.rejects(() => google.terminerConnexion({ code: null, etat, etatAttendu: etat, erreur: "access_denied" }), /Accès refusé/);
    assert.deepEqual(await google.terminerConnexion({ code: "code", etat, etatAttendu: etat, erreur: null }), { compte: "coverswap.essai@example.test" });

    const ligne = await prisma.connexionGoogle.findFirstOrThrow();
    assert.equal(ligne.jetonChiffre.includes("renouvellement-secret"), false);
    const journal = await prisma.$queryRawUnsafe<{ apres: string }[]>(`SELECT "apres" FROM "JournalModification" WHERE "modele" = 'ConnexionGoogle'`);
    assert.ok(journal.every((ligneJournal) => !ligneJournal.apres.includes("renouvellement-secret")));
    const etatConnexion = await google.etatConnexionGoogle();
    assert.equal(etatConnexion.connexion?.compte, "coverswap.essai@example.test");
  });
});

describe("miroir Drive", () => {
  let dossierId: string;
  let clientId: string;

  test("un arbre lisible par client ; rejoué, rien n'est recréé", async () => {
    const client = await prisma.client.create({ data: { nom: "Alice Durand", source: "ENTRANT", premierContactLe: new Date() } });
    clientId = client.id;
    dossierId = await dossiers.creerDossier(
      { clientNom: "Alice Durand", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000012", clientEmail: null, objet: "Cuisine chêne", source: "ENTRANT", montantEstime: null, prochaineAction: null, prochaineActionDate: null, leadId: null, prospectId: null, clientId },
      [photo("avant-1")]
    );
    await dossiers.ajouterPhoto(dossierId, photo("apres-1"), true);

    const premier = await miroir.synchroniserMiroir();
    assert.equal(premier.erreurs, 0);
    const code = (await import("@/lib/synthese/references")).pseudonyme(clientId);
    const mois = new Date().toISOString().slice(0, 7);
    const attendus = [
      "CoverSwap CRM",
      "CoverSwap CRM/Archives (retirés du CRM)",
      "CoverSwap CRM/Clients",
      `CoverSwap CRM/Clients/Alice Durand · ${code}`,
      `CoverSwap CRM/Clients/Alice Durand · ${code}/${mois} Cuisine chêne/Fiche du dossier.txt`,
      `CoverSwap CRM/Clients/Alice Durand · ${code}/${mois} Cuisine chêne/Photos après/Photo 01.jpg`,
      `CoverSwap CRM/Clients/Alice Durand · ${code}/${mois} Cuisine chêne/Photos avant/Photo 01.jpg`,
    ];
    for (const attendu of attendus) assert.ok(chemins().includes(attendu), attendu);

    const second = await miroir.synchroniserMiroir();
    assert.deepEqual({ ...second }, { crees: 0, renommes: 0, deplaces: 0, renvoyes: 0, archives: 0, reconstruits: 0, erreurs: 0 });
  });

  test("renommer le client renomme son dossier Drive ; une photo retirée part aux archives", async () => {
    await prisma.client.update({ where: { id: clientId }, data: { nom: "Alice Martin" } });
    const apres = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).photos;
    const photoApres = JSON.parse(apres).find((chemin: string) => chemin.includes("photos-apres"));
    const { idPhoto } = await import("@/lib/dossiers/stockage");
    await dossiers.supprimerPhoto(dossierId, idPhoto(photoApres));

    const resume = await miroir.synchroniserMiroir();
    assert.equal(resume.renommes, 1);
    assert.equal(resume.archives, 1);
    assert.equal(resume.crees, 0);
    assert.ok(chemins().some((chemin) => chemin.startsWith("CoverSwap CRM/Clients/Alice Martin · ")));
    assert.ok(chemins().includes("CoverSwap CRM/Archives (retirés du CRM)/Photo 01.jpg"));
  });

  test("supprimé à la main dans Drive : reconstruit à la vérification", async () => {
    const fiche = [...drive.values()].find((element) => element.name === "Fiche du dossier.txt")!;
    fiche.trashed = true;
    const resume = await miroir.synchroniserMiroir({ verifier: true });
    assert.equal(resume.reconstruits, 1);
    assert.equal([...drive.values()].filter((element) => element.name === "Fiche du dossier.txt" && !element.trashed).length, 1);
  });

  test("accès révoqué : arrêt net, dit sur la connexion ; jamais de suppression envoyée à Drive", async () => {
    jetonRevoque = true;
    await prisma.client.update({ where: { id: clientId }, data: { nom: "Alice Durand" } });
    // Le jeton en cache expirerait tôt ou tard : on force son renouvellement.
    google.definirTransportGoogleEssai(async (url, init) => {
      const reponse = await fauxGoogle(url, init);
      return url.includes("/drive/v3/") ? new Response("{}", { status: 401 }) : reponse;
    });
    await assert.rejects(() => miroir.synchroniserMiroir(), (erreur: unknown) => erreur instanceof Error && erreur.name === "ErreurDefinitive" && /révoqué/.test(erreur.message));
    assert.match((await prisma.connexionGoogle.findFirstOrThrow({ where: { deconnecteLe: null } })).derniereErreur ?? "", /reconnecter/);
    google.definirTransportGoogleEssai(fauxGoogle);

    // Ni suppression, ni corbeille, ni vidage de corbeille.
    assert.equal(appels.some((appel) => appel.methode === "DELETE" || /\/trash|emptyTrash/.test(appel.url)), false);
  });
});
