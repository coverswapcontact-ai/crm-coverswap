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
const sessionsEnvoi = new Map<string, { methode: string; cible: string | null; metadonnees: Record<string, unknown> }>();

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

  const segments = adresse.pathname.split("/");
  const id = segments.at(-1) !== "files" ? segments.at(-1)! : null;

  // Envoi en deux temps (« resumable ») : le contenu arrive par PUT sur l'adresse de session.
  if (methode === "PUT" && adresse.searchParams.get("upload_id")) {
    const session = sessionsEnvoi.get(adresse.searchParams.get("upload_id")!);
    if (!session) return json({ error: { message: "Invalid upload session" } }, 404);
    sessionsEnvoi.delete(adresse.searchParams.get("upload_id")!);
    const contenuRecu = Buffer.from(init.body as Uint8Array).toString("utf8");
    if (session.cible) {
      const cible = drive.get(session.cible);
      if (!cible) return json({ error: { message: "File not found" } }, 404);
      if (session.metadonnees.name) cible.name = String(session.metadonnees.name);
      cible.contenu = contenuRecu;
      return json({ id: cible.id });
    }
    const cree: ElementFaux = {
      id: `f${++compteur}`,
      name: String(session.metadonnees.name),
      parents: (session.metadonnees.parents as string[] | undefined) ?? ["racine-drive"],
      trashed: false,
      dossier: false,
      contenu: contenuRecu,
    };
    drive.set(cree.id, cree);
    return json({ id: cree.id });
  }
  if (adresse.pathname.startsWith("/upload/drive/v3/files") && adresse.searchParams.get("uploadType") === "resumable") {
    const idSession = `session-${++compteur}`;
    sessionsEnvoi.set(idSession, { methode, cible: id, metadonnees: JSON.parse(String(init.body)) });
    return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${idSession}` } });
  }

  const envoi = adresse.pathname.startsWith("/upload/drive/v3/files");
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

    // Mode Test : le jeton expire 7 jours après l'autorisation ; le rappel s'affiche à 48 h.
    assert.equal(etatConnexion.connexion?.echeance.expireLe, new Date(ligne.createdAt.getTime() + 7 * 86_400_000).toISOString());
    assert.equal(await google.rappelConnexionGoogle(), null, "pas de rappel tant que l'échéance est loin");
    const dans = (jours: number) => new Date(ligne.createdAt.getTime() + jours * 86_400_000);
    assert.equal((await google.rappelConnexionGoogle(dans(5.5)))?.niveau, "PROCHE");
    assert.equal((await google.rappelConnexionGoogle(dans(6.5)))?.niveau, "IMMINENTE");
    const expiree = await google.rappelConnexionGoogle(dans(7.1));
    assert.deepEqual([expiree?.niveau, expiree?.compte], ["EXPIREE", "coverswap.essai@example.test"]);
    process.env.GOOGLE_APPLICATION_PUBLIEE = "1";
    assert.equal(await google.rappelConnexionGoogle(dans(30)), null, "application publiée : plus de reconnexion tous les 7 jours");
    delete process.env.GOOGLE_APPLICATION_PUBLIEE;
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

  test("fichier de plus de 5 Mo : envoi en deux temps ; réseau coupé pendant l'envoi, rien n'est créé et le passage suivant reprend", async () => {
    const client = await prisma.client.create({ data: { nom: "Bruno Grandfichier", source: "ENTRANT", premierContactLe: new Date() } });
    const lourde = new File([Buffer.alloc(6 * 1024 * 1024, "a")], "photo.jpg", { type: "image/jpeg" });
    const idDossier = await dossiers.creerDossier(
      { clientNom: "Bruno Grandfichier", clientAdresse: "2 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000013", clientEmail: null, objet: "Dressing", source: "ENTRANT", montantEstime: null, prochaineAction: null, prochaineActionDate: null, leadId: null, prospectId: null, clientId: client.id },
      [lourde]
    );
    const copieDeLaPhoto = () => prisma.miroirDrive.findFirst({ where: { cle: { startsWith: `photo:${idDossier}:` } } });

    // Session ouverte, puis le réseau tombe pendant l'envoi du contenu.
    google.definirTransportGoogleEssai(async (url, init) => {
      if (init?.method === "PUT") throw new TypeError("fetch failed");
      return fauxGoogle(url, init);
    });
    const coupe = await miroir.synchroniserMiroir();
    google.definirTransportGoogleEssai(fauxGoogle);
    assert.equal(coupe.erreurs, 1);
    const enErreur = await copieDeLaPhoto();
    assert.equal(enErreur?.driveId ?? null, null);
    assert.match(enErreur?.derniereErreur ?? "", /fetch failed/);
    assert.equal([...drive.values()].filter((element) => element.contenu.length === 6 * 1024 * 1024).length, 0, "rien de créé à moitié");

    const reprise = await miroir.synchroniserMiroir();
    assert.equal(reprise.erreurs, 0);
    const envoyee = await copieDeLaPhoto();
    assert.equal(envoyee?.etat, "A_JOUR");
    assert.equal(envoyee?.derniereErreur, null);
    assert.equal(drive.get(envoyee!.driveId!)?.contenu.length, 6 * 1024 * 1024);
    assert.ok(appels.some((appel) => appel.methode === "POST" && appel.url.includes("uploadType=resumable")));
    assert.ok(appels.some((appel) => appel.methode === "PUT" && appel.url.includes("upload_id=")));
    assert.equal([...drive.values()].filter((element) => element.contenu.length === 6 * 1024 * 1024).length, 1, "envoyée une seule fois");
  });

  test("client anonymisé : le contenu des copies de ses photos est remplacé dans Drive, rien n'y est supprimé", async () => {
    // Ce que fait l'anonymisation (src/lib/rgpd) : photos retirées du dossier, copies marquées à neutraliser.
    const { A_NEUTRALISER, ARCHIVE_A_NEUTRALISER } = await import("./synchronisation");
    await prisma.dossier.update({ where: { id: dossierId }, data: { photos: "[]" } });
    await prisma.miroirDrive.updateMany({ where: { cle: { startsWith: `photo:${dossierId}:` }, etat: "ARCHIVE" }, data: { etat: ARCHIVE_A_NEUTRALISER } });
    await prisma.miroirDrive.updateMany({ where: { cle: { startsWith: `photo:${dossierId}:` }, etat: { not: ARCHIVE_A_NEUTRALISER } }, data: { etat: A_NEUTRALISER } });

    const resume = await miroir.synchroniserMiroir();
    assert.equal(resume.erreurs, 0);
    const copies = (await prisma.miroirDrive.findMany({ where: { cle: { startsWith: `photo:${dossierId}:` } } })).map((ligne) => drive.get(ligne.driveId!)!);
    assert.equal(copies.length, 2);
    for (const copie of copies) {
      assert.equal(copie.name, "Photo effacée (RGPD).txt");
      assert.match(copie.contenu, /effacé au titre du RGPD/);
      assert.equal(chemin(copie.id).startsWith("CoverSwap CRM/Archives (retirés du CRM)/"), true);
    }
    assert.equal((await prisma.miroirDrive.count({ where: { cle: { startsWith: `photo:${dossierId}:` }, etat: "ARCHIVE" } })), 2);
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
    const rappel = await google.rappelConnexionGoogle();
    assert.deepEqual([rappel?.niveau, rappel?.coupee], ["EXPIREE", true], "une connexion coupée s'affiche sur tous les écrans");
    google.definirTransportGoogleEssai(fauxGoogle);

    // Ni suppression, ni corbeille, ni vidage de corbeille.
    assert.equal(appels.some((appel) => appel.methode === "DELETE" || /\/trash|emptyTrash/.test(appel.url)), false);
  });
});
