import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 17 (partie C) — le lien de dépôt, sur une copie de base, sans réseau :
 * usage unique, expiration, type lu dans les octets, rattachement de chaque
 * type de cible, dépôt libre puis rangement, retrait et remise, route publique.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

let prisma: typeof import("@/lib/prisma").default;
let jetons: typeof import("./jetons");
let enregistrement: typeof import("./enregistrement");
let route: typeof import("@/app/api/depot/[jeton]/route");
let NextRequest: typeof import("next/server").NextRequest;
let ErreurMetier: typeof import("@/lib/commun/erreurs").ErreurMetier;
let JPEG: Buffer;
let PNG: Buffer;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const ids: Record<string, string> = {};
const appelsReseau: string[] = [];

const refus = (motif: RegExp, statut?: number) => (e: unknown) => e instanceof ErreurMetier && motif.test(e.message) && (statut === undefined || e.status === statut);
const photosDuDossier = async (id: string) => JSON.parse((await prisma.dossier.findUniqueOrThrow({ where: { id }, select: { photos: true } })).photos) as string[];

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    appelsReseau.push(String(entree));
    throw new Error("réseau coupé pendant les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  jetons = await import("./jetons");
  enregistrement = await import("./enregistrement");
  route = await import("@/app/api/depot/[jeton]/route");
  NextRequest = (await import("next/server")).NextRequest;
  ErreurMetier = (await import("@/lib/commun/erreurs")).ErreurMetier;
  await (await import("@/lib/base/preparation")).preparerBase();
  const sharp = (await import("sharp")).default;
  JPEG = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
  PNG = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();

  const { avecActeur } = await import("@/lib/journal/contexte");
  await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, async () => {
    const client = await prisma.client.create({ data: { nom: "Hélène Garcia", source: "SITE", premierContactLe: new Date("2026-09-01T10:00:00Z") } });
    const lead = await prisma.lead.create({ data: { prenom: "Paul", nom: "Roux", telephone: "0600000091", ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
    const dossier = await prisma.dossier.create({ data: { clientId: client.id, clientNom: "Hélène Garcia", clientAdresse: "1 rue des Lilas", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000092", objet: "Recouvrement façades de cuisine", source: "ENTRANT" } });
    const depense = await prisma.depense.create({ data: { payeeLe: new Date("2026-09-20T12:00:00Z"), montant: 84.5, fournisseur: "Leroy Merlin", categorie: "MATERIEL", dossierId: dossier.id } });
    const publication = await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine chêne à Montpellier", dossierId: dossier.id } });
    Object.assign(ids, { client: client.id, lead: lead.id, dossier: dossier.id, depense: depense.id, publication: publication.id });
  });
});

after(async () => {
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

async function deposer(cible: { entite: "DOSSIER" | "LEAD" | "CLIENT" | "DEPENSE" | "PUBLICATION"; id: string } | null, type: Parameters<typeof jetons.creerLienDepot>[0]["type"], fichiers: { contenu: Buffer; nom: string }[]) {
  const lien = await jetons.creerLienDepot({ cible, type, creePar: "lucas@coverswap.fr" });
  const { cle } = await jetons.ouvrirDepot(lien.jeton, { tailles: fichiers.map((f) => f.contenu.length) });
  const resultats = [];
  for (const f of fichiers) resultats.push(await jetons.recevoirFichier(lien.jeton, cle, f));
  return { lien, cle, resultats };
}

describe("le lien : usage unique, expiration, refus", () => {
  test("lien valide : l'ouvrir ne consomme rien ; la soumission le consomme ; réutilisé → refusé", async () => {
    const lien = await jetons.creerLienDepot({ cible: { entite: "DOSSIER", id: ids.dossier }, type: "PHOTO_AVANT", creePar: "lucas@coverswap.fr" });
    assert.match(lien.chemin, /^\/depot\/[A-Za-z0-9_-]{43}$/);
    const ligne = await prisma.jetonDepot.findUniqueOrThrow({ where: { id: lien.id } });
    assert.notEqual(ligne.empreinte, lien.jeton, "le jeton n'est jamais gardé en clair");
    assert.equal(Math.round((ligne.expireLe.getTime() - ligne.createdAt.getTime()) / 60_000), 30, "30 minutes");
    for (let i = 0; i < 3; i++) assert.equal((await jetons.etatLien(lien.jeton)).etat, "valide", "ouvrir la page (ou son aperçu) ne consomme rien");

    const { cle } = await jetons.ouvrirDepot(lien.jeton, { tailles: [JPEG.length, PNG.length] });
    assert.equal((await jetons.etatLien(lien.jeton)).etat, "utilise");
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: [JPEG.length] }), refus(/déjà servi/, 410), "seconde soumission refusée");
    // La soumission envoie ses fichiers un par un avec SA clé.
    await jetons.recevoirFichier(lien.jeton, cle, { contenu: JPEG, nom: "a.jpg" });
    await jetons.recevoirFichier(lien.jeton, cle, { contenu: PNG, nom: "b.png" });
    await assert.rejects(jetons.recevoirFichier(lien.jeton, cle, { contenu: JPEG, nom: "c.jpg" }), refus(/terminé/, 410), "rien au-delà de ce qui a été annoncé");
    await assert.rejects(jetons.recevoirFichier(lien.jeton, "une-autre-cle", { contenu: JPEG, nom: "d.jpg" }), refus(/déjà servi/, 410), "une autre clé : refusée");
    assert.equal((await prisma.fichierDepose.count({ where: { jetonId: lien.id } })), 2);
  });

  test("lien expiré : refusé, rien n'est écrit", async () => {
    const lien = await jetons.creerLienDepot({ cible: { entite: "DOSSIER", id: ids.dossier }, type: null, creePar: "lucas@coverswap.fr", maintenant: new Date(Date.now() - 31 * 60_000) });
    const avant = { photos: (await photosDuDossier(ids.dossier)).length, depots: await prisma.fichierDepose.count() };
    const etat = await jetons.etatLien(lien.jeton);
    assert.equal(etat.etat, "expire");
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: [JPEG.length] }), refus(/expiré/, 410));
    await assert.rejects(jetons.recevoirFichier(lien.jeton, "x", { contenu: JPEG, nom: "a.jpg" }), refus(/non ouvert/));
    const ligne = await prisma.jetonDepot.findUniqueOrThrow({ where: { id: lien.id } });
    assert.equal(ligne.utiliseLe, null, "le lien expiré n'est pas consommé");
    assert.deepEqual({ photos: (await photosDuDossier(ids.dossier)).length, depots: await prisma.fichierDepose.count() }, avant);
  });

  test("lien inconnu ou mal formé : refusé", async () => {
    assert.equal((await jetons.etatLien("AbCdEf0123456789AbCdEf0123456789AbCdEf01234")).etat, "inconnu");
    assert.equal((await jetons.etatLien("../../etc")).etat, "inconnu");
    await assert.rejects(jetons.ouvrirDepot("AbCdEf0123456789AbCdEf0123456789AbCdEf01234", { tailles: [10] }), refus(/n'existe pas/, 404));
  });

  test("type interdit refusé par ses octets, pas par son extension ; rien n'est compté ni écrit", async () => {
    const lien = await jetons.creerLienDepot({ cible: { entite: "CLIENT", id: ids.client }, type: null, creePar: "lucas@coverswap.fr" });
    const html = Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>");
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 1)]);
    const { cle } = await jetons.ouvrirDepot(lien.jeton, { tailles: [html.length, exe.length, JPEG.length] });
    const avant = await prisma.fichierDepose.count();
    await assert.rejects(jetons.recevoirFichier(lien.jeton, cle, { contenu: html, nom: "photo.jpg" }), refus(/Format refusé/, 415));
    await assert.rejects(jetons.recevoirFichier(lien.jeton, cle, { contenu: exe, nom: "devis.pdf" }), refus(/Format refusé/, 415));
    assert.equal(await prisma.fichierDepose.count(), avant);
    assert.equal((await prisma.jetonDepot.findUniqueOrThrow({ where: { id: lien.id } })).fichiersRecus, 0, "un fichier refusé n'entame pas le dépôt");
    // Un vrai JPEG nommé « .pdf » : accepté comme JPEG (le contenu fait foi).
    const r = await jetons.recevoirFichier(lien.jeton, cle, { contenu: JPEG, nom: "scan.pdf" });
    assert.equal(r.typeMime, "image/jpeg");
    assert.equal(r.nom, "scan.jpg");
  });

  test("taille : annonce au-delà du plafond refusée ; un fichier plus gros qu'annoncé refusé", async () => {
    const lien = await jetons.creerLienDepot({ cible: { entite: "CLIENT", id: ids.client }, type: null, creePar: "lucas@coverswap.fr" });
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: [10 * 1024 * 1024] }), refus(/dépasse/, 413));
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: Array(25).fill(1000) }), refus(/au plus/, 413));
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: Array(8).fill(8.5 * 1024 * 1024) }), refus(/Trop lourd pour un seul dépôt/, 413));
    assert.equal((await jetons.etatLien(lien.jeton)).etat, "valide", "une annonce refusée ne consomme pas le lien");
    const { cle } = await jetons.ouvrirDepot(lien.jeton, { tailles: [20] });
    await assert.rejects(jetons.recevoirFichier(lien.jeton, cle, { contenu: PDF, nom: "a.pdf" }), refus(/annoncé/, 413));
  });
});

describe("chaque cible reçoit le fichier au bon endroit", () => {
  test("dossier : photos du dossier (proposées au simulateur) et documents", async () => {
    const { resultats } = await deposer({ entite: "DOSSIER", id: ids.dossier }, null, [{ contenu: JPEG, nom: "cuisine.jpg" }, { contenu: PDF, nom: "plan.pdf" }]);
    const [photo, doc] = resultats;
    assert.equal(photo.type, "PHOTO_AVANT");
    assert.ok((await photosDuDossier(ids.dossier)).some((c) => c.includes(photo.photoId!)), "dans Dossier.photos");
    const { photosAvantDuDossier } = await import("@/lib/simulateur/preparation");
    assert.ok((await photosAvantDuDossier(ids.dossier)).some((p) => p.id === photo.photoId), "proposée au simulateur");
    assert.equal(doc.type, "AUTRE");
    assert.ok(doc.fichierId);
    const ev = await prisma.dossierEvenement.findFirst({ where: { dossierId: ids.dossier, type: "DOCUMENT_DEPOSE", metadata: { contains: doc.fichierId! } } });
    assert.ok(ev, "écrit dans l'historique du dossier, comme deposer_document");
  });

  test("dossier : photo après chantier, devis sans numéro gardé « à compléter »", async () => {
    const { resultats: [apres] } = await deposer({ entite: "DOSSIER", id: ids.dossier }, "PHOTO_APRES", [{ contenu: JPEG, nom: "fini.jpg" }]);
    assert.ok((await photosDuDossier(ids.dossier)).some((c) => c.includes("/photos-apres/") && c.includes(apres.photoId!)));
    const { resultats: [devis] } = await deposer({ entite: "DOSSIER", id: ids.dossier }, "DEVIS", [{ contenu: PDF, nom: "devis-fournisseur.pdf" }]);
    assert.equal(devis.aCompleter, true);
    assert.equal(devis.documentId, null);
    assert.equal(await prisma.document.count({ where: { dossierId: ids.dossier } }), 0, "aucun devis repris sans numéro ni montant");
  });

  test("lead : PhotoLead ; client : fichier rattaché ; dépense : justificatif ; réalisation : photo après", async () => {
    const { resultats: [lead] } = await deposer({ entite: "LEAD", id: ids.lead }, null, [{ contenu: JPEG, nom: "salon.jpg" }]);
    const photoLead = await prisma.photoLead.findUniqueOrThrow({ where: { id: lead.photoId! } });
    assert.equal(photoLead.leadId, ids.lead);
    assert.equal(photoLead.origine, "DEPOT_CRM");

    const { resultats: [client] } = await deposer({ entite: "CLIENT", id: ids.client }, "AUTRE", [{ contenu: PDF, nom: "kbis.pdf" }]);
    const ligneClient = await prisma.fichierDepose.findUniqueOrThrow({ where: { id: client.id } });
    assert.deepEqual([ligneClient.cibleEntite, ligneClient.cibleId, Boolean(ligneClient.fichierId)], ["CLIENT", ids.client, true]);

    const { resultats: [justificatif] } = await deposer({ entite: "DEPENSE", id: ids.depense }, null, [{ contenu: PNG, nom: "ticket.png" }]);
    assert.equal(justificatif.type, "JUSTIFICATIF");
    assert.equal((await prisma.depense.findUniqueOrThrow({ where: { id: ids.depense } })).justificatifId, justificatif.fichierId);

    const lien = await jetons.creerLienDepot({ cible: { entite: "DEPENSE", id: ids.depense }, type: null, creePar: "lucas@coverswap.fr" });
    await assert.rejects(jetons.ouvrirDepot(lien.jeton, { tailles: [10, 10] }), refus(/un seul fichier/), "une dépense : un seul justificatif par dépôt");

    const { resultats: [realisation] } = await deposer({ entite: "PUBLICATION", id: ids.publication }, "PHOTO_APRES", [{ contenu: JPEG, nom: "apres.jpg" }]);
    const publication = await prisma.publicationSite.findUniqueOrThrow({ where: { id: ids.publication } });
    assert.ok(publication.photoApres?.includes(realisation.photoId!), "photo après posée sur la réalisation");
    assert.ok((await photosDuDossier(ids.dossier)).includes(publication.photoApres!), "prise dans son dossier (règle du Site)");
  });

  test("refus de sens : photo après sur un lead, PDF comme photo", async () => {
    await assert.rejects(jetons.creerLienDepot({ cible: { entite: "LEAD", id: ids.lead }, type: "PHOTO_APRES", creePar: "x" }), refus(/dossier, pas sur le lead/));
    const lien = await jetons.creerLienDepot({ cible: { entite: "DOSSIER", id: ids.dossier }, type: "PHOTO_AVANT", creePar: "x" });
    const { cle } = await jetons.ouvrirDepot(lien.jeton, { tailles: [PDF.length] });
    await assert.rejects(jetons.recevoirFichier(lien.jeton, cle, { contenu: PDF, nom: "a.pdf" }), refus(/doit être une image/));
  });
});

describe("dépôt libre, rangement, retrait et remise", () => {
  test("dépôt libre → « À ranger » → rangé sur le dossier comme photo avant", async () => {
    const { lien, resultats: [recu] } = await deposer(null, null, [{ contenu: JPEG, nom: "libre.jpg" }]);
    assert.match((await jetons.etatLien(lien.jeton)).etat, /utilise/);
    assert.equal(recu.cible, null);
    const aRanger = await prisma.fichierDepose.findMany({ where: { cibleEntite: null } });
    assert.ok(aRanger.some((l) => l.id === recu.id), "dans « À ranger »");
    const range = await enregistrement.rangerFichierDepose(recu.id, { entite: "DOSSIER", id: ids.dossier }, "PHOTO_AVANT");
    assert.ok((await photosDuDossier(ids.dossier)).some((c) => c.includes(range.photoId!)));
    const ancien = await prisma.fichierDepose.findUniqueOrThrow({ where: { id: recu.id } });
    assert.ok(ancien.archiveLe && ancien.rangeLe, "l'entrée « À ranger » est close (gardée)");
    assert.equal((await prisma.fichierDepose.findMany({ where: { cibleEntite: null } })).some((l) => l.id === recu.id), false);

    // Retirer (archivé, jamais supprimé) puis remettre.
    const chemin = (await prisma.fichierDepose.findUniqueOrThrow({ where: { id: range.id } })).photoChemin!;
    await enregistrement.retirerFichierDepose(range.id, "essai");
    assert.equal((await photosDuDossier(ids.dossier)).includes(chemin), false);
    const { lireFichier } = await import("@/lib/dossiers/stockage");
    assert.ok(await lireFichier(chemin), "le fichier reste sur le disque");
    await enregistrement.remettreFichierDepose(range.id);
    assert.ok((await photosDuDossier(ids.dossier)).includes(chemin));
  });
});

describe("route publique POST /api/depot/[jeton]", () => {
  const appeler = (jeton: string, corps: BodyInit, entetes: Record<string, string>) =>
    route.POST(new NextRequest(new Request(`http://localhost:3001/api/depot/${jeton}`, { method: "POST", body: corps, headers: { "x-forwarded-for": "203.0.113.9", ...entetes } })), { params: Promise.resolve({ jeton }) });

  test("soumission puis fichiers ; seconde soumission refusée ; lien inconnu refusé", async () => {
    const lien = await jetons.creerLienDepot({ cible: { entite: "DOSSIER", id: ids.dossier }, type: "PHOTO_AVANT", creePar: "lucas@coverswap.fr" });
    const ouverture = await appeler(lien.jeton, JSON.stringify({ tailles: [JPEG.length] }), { "content-type": "application/json" });
    assert.equal(ouverture.status, 200);
    const { cle } = (await ouverture.json()) as { cle: string };
    const envoi = await appeler(lien.jeton, new Uint8Array(JPEG), { "content-type": "application/octet-stream", "x-cle-depot": cle, "x-nom-fichier": encodeURIComponent("évier.jpg") });
    const corps = (await envoi.json()) as { destination: string; nom: string };
    assert.equal(envoi.status, 200, JSON.stringify(corps));
    assert.match(corps.destination, /photo avant ajoutée au dossier/);
    assert.equal(corps.nom, "évier.jpg");
    const encore = await appeler(lien.jeton, JSON.stringify({ tailles: [JPEG.length] }), { "content-type": "application/json" });
    assert.equal(encore.status, 410);
    assert.match(((await encore.json()) as { error: string }).error, /déjà servi/);
    const inconnu = await appeler("AbCdEf0123456789AbCdEf0123456789AbCdEf01234", JSON.stringify({ tailles: [10] }), { "content-type": "application/json" });
    assert.equal(inconnu.status, 404);
  });
});
