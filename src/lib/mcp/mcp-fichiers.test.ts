import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 17 (partie C) — les outils de fichiers (lien_depot, ajouter_fichier,
 * ranger_fichier, voir_fichiers) exécutés par le moteur de l'assistant (garde-
 * fous, journal, confirmation), sur une copie de base. Réseau coupé : fetch
 * refuse tout, la résolution et le transport du téléchargement par URL sont
 * remplacés.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";
process.env.ANTHROPIC_API_KEY = "cle-factice-qui-ne-doit-jamais-servir";

type Outils = typeof import("@/lib/assistant/outils/fichiers");
let prisma: typeof import("@/lib/prisma").default;
let outils: Outils;
let execution: typeof import("@/lib/assistant/execution");
let jetons: typeof import("@/lib/fichiers-depot/jetons");
let url: typeof import("@/lib/fichiers-depot/url");
let session: import("@/lib/assistant/execution").Session;
let JPEG: Buffer;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const ids: Record<string, string> = {};
const appelsReseau: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const appeler = (outil: any, args: Record<string, unknown>) => execution.executerOutil(outil, { commande: "essai de Lucas", ...args }, session);
const photos = async (dossierId: string) => JSON.parse((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId }, select: { photos: true } })).photos) as string[];
const donnees = <T,>(r: { donnees?: unknown }) => r.donnees as T;

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request) => {
    appelsReseau.push(String(entree));
    throw new Error("réseau coupé pendant les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  outils = await import("@/lib/assistant/outils/fichiers");
  execution = await import("@/lib/assistant/execution");
  jetons = await import("@/lib/fichiers-depot/jetons");
  url = await import("@/lib/fichiers-depot/url");
  await (await import("@/lib/base/preparation")).preparerBase();
  const sharp = (await import("sharp")).default;
  JPEG = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 180, g: 140, b: 90 } } }).jpeg().toBuffer();
  session = await execution.ouvrirSession({ jetonId: "essai-fichiers", clientNom: "essai", utilisateur: "lucas@coverswap.fr" });

  const { avecActeur } = await import("@/lib/journal/contexte");
  await avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, async () => {
    const client = await prisma.client.create({ data: { nom: "Hélène Garcia", source: "SITE", premierContactLe: new Date("2026-09-01T10:00:00Z") } });
    const autre = await prisma.client.create({ data: { nom: "Bureau Dupuy", source: "SITE", premierContactLe: new Date("2026-09-01T10:00:00Z") } });
    const lead = await prisma.lead.create({ data: { prenom: "Paul", nom: "Roux", telephone: "0600000081", ville: "Lattes", source: "SITE_DEVIS" } });
    const dossier = await prisma.dossier.create({ data: { clientId: client.id, clientNom: "Hélène Garcia", clientAdresse: "1 rue des Lilas", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000082", objet: "Recouvrement façades de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
    const depense = await prisma.depense.create({ data: { payeeLe: new Date("2026-09-20T12:00:00Z"), montant: 42, fournisseur: "Castorama", categorie: "MATERIEL", dossierId: dossier.id } });
    const publication = await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Cuisine chêne", dossierId: dossier.id } });
    const publiee = await prisma.publicationSite.create({ data: { type: "REALISATION", titre: "Salle de bain béton", dossierId: dossier.id, publieLe: new Date(), accordClientLe: new Date() } });
    Object.assign(ids, { client: client.id, autre: autre.id, lead: lead.id, dossier: dossier.id, depense: depense.id, publication: publication.id, publiee: publiee.id });
  });
});

after(async () => {
  url.definirReseauEssai(null);
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("catalogue des outils de fichiers", () => {
  test("quatre outils, niveaux attendus, schémas exportables en JSON Schema (MCP)", async () => {
    const { z } = await import("zod/v4");
    assert.deepEqual(outils.OUTILS_FICHIERS.map((o) => `${o.nom}:${o.niveau}`), ["lien_depot:REVERSIBLE", "ajouter_fichier:REVERSIBLE", "ranger_fichier:REVERSIBLE", "voir_fichiers:LECTURE"]);
    for (const o of outils.OUTILS_FICHIERS) {
      const objet = o.schema as unknown as import("zod/v4").ZodObject<import("zod/v4").ZodRawShape>;
      const schema = o.niveau === "LECTURE" ? objet : objet.extend(execution.schemaCommun.shape);
      const json = z.toJSONSchema(schema, { io: "input" }) as { type: string; properties: Record<string, unknown> };
      assert.equal(json.type, "object", o.nom);
      assert.ok(o.description.length > 200, o.nom);
    }
  });
});

describe("lien_depot", () => {
  test("rend un lien absolu, 30 minutes, rattaché au dossier ; le dépôt arrive dans les photos du dossier", async () => {
    const r = await appeler(outils.outilLienDepot, { cible: { entite: "DOSSIER", id: ids.dossier }, type: "PHOTO_AVANT" });
    assert.equal(r.confirmation, undefined, "réversible : pas de confirmation");
    const d = donnees<{ depot_id: string; lien: string; expireLe: string }>(r);
    assert.match(d.lien, /^http:\/\/localhost:3001\/depot\/[A-Za-z0-9_-]{43}$/);
    assert.match(r.texte, /30 minutes/);
    const jeton = d.lien.split("/").pop()!;
    const { cle } = await jetons.ouvrirDepot(jeton, { tailles: [JPEG.length, JPEG.length] });
    const a = await jetons.recevoirFichier(jeton, cle, { contenu: JPEG, nom: "mur.jpg" });
    await jetons.recevoirFichier(jeton, cle, { contenu: JPEG, nom: "evier.jpg" });
    assert.ok((await photos(ids.dossier)).some((c) => c.includes(a.photoId!)));
    // Proposées au simulateur.
    const { photosAvantDuDossier } = await import("@/lib/simulateur/preparation");
    assert.ok((await photosAvantDuDossier(ids.dossier)).some((p) => p.id === a.photoId));
    // Claude les voit.
    const vues = await appeler(outils.outilVoirFichiers, { genre: "photos", cible: { entite: "DOSSIER", id: ids.dossier } });
    assert.ok((vues.images?.length ?? 0) >= 2, vues.texte);
    assert.match(vues.texte, /déposée dans le CRM/);
  });

  test("nom ambigu : candidats rendus, rien n'est créé", async () => {
    await prisma.lead.create({ data: { prenom: "Paul", nom: "Rouxel", telephone: "0600000083", ville: "Sète" } });
    const avant = await prisma.jetonDepot.count();
    const r = await appeler(outils.outilLienDepot, { cible: { nom: "Paul" } });
    assert.match(r.texte, /Plusieurs contacts correspondent/);
    assert.equal(await prisma.jetonDepot.count(), avant);
  });
});

describe("ajouter_fichier : base64 sur chaque cible", () => {
  const b64 = (b: Buffer) => b.toString("base64");

  test("dossier (par le nom), lead, client, dépense, réalisation non publiée", async () => {
    const dossier = await appeler(outils.outilAjouterFichier, { cible: { entite: "DOSSIER", nom: "Garcia" }, type: "PHOTO_APRES", source: { base64: `data:image/jpeg;base64,${b64(JPEG)}`, nom: "apres.jpg" } });
    assert.equal(dossier.confirmation, undefined, dossier.texte);
    assert.ok((await photos(ids.dossier)).some((c) => c.includes("/photos-apres/")), dossier.texte);

    const lead = await appeler(outils.outilAjouterFichier, { cible: { entite: "LEAD", id: ids.lead }, type: "PHOTO_AVANT", source: { base64: b64(JPEG), nom: "salon.jpg" } });
    assert.equal(await prisma.photoLead.count({ where: { leadId: ids.lead, origine: "DEPOT_CRM" } }), 1, lead.texte);

    const client = await appeler(outils.outilAjouterFichier, { cible: { entite: "CLIENT", id: ids.client }, type: "AUTRE", source: { base64: b64(PDF), nom: "kbis.pdf" } });
    assert.equal(await prisma.fichierDepose.count({ where: { cibleEntite: "CLIENT", cibleId: ids.client } }), 1, client.texte);

    const depense = await appeler(outils.outilAjouterFichier, { cible: { entite: "DEPENSE", id: ids.depense }, type: "JUSTIFICATIF", source: { base64: b64(PDF), nom: "facture.pdf" } });
    assert.ok((await prisma.depense.findUniqueOrThrow({ where: { id: ids.depense } })).justificatifId, depense.texte);

    const publication = await appeler(outils.outilAjouterFichier, { cible: { entite: "PUBLICATION", id: ids.publication }, type: "PHOTO_AVANT", source: { base64: b64(JPEG), nom: "avant.jpg" } });
    assert.equal(publication.confirmation, undefined);
    assert.ok((await prisma.publicationSite.findUniqueOrThrow({ where: { id: ids.publication } })).photoAvant, publication.texte);
  });

  test("octets magiques : un « .jpg » qui n'en est pas un est refusé", async () => {
    const r = await appeler(outils.outilAjouterFichier, { cible: { entite: "CLIENT", id: ids.client }, type: "PHOTO_AVANT", source: { base64: Buffer.from("<html>pas une photo</html>").toString("base64"), nom: "photo.jpg" } });
    assert.match(r.texte, /^Refusé : Format refusé/);
  });

  test("une réalisation déjà publiée : aperçu + jeton, rien n'est posé avant la confirmation", async () => {
    const args = { cible: { entite: "PUBLICATION", id: ids.publiee }, type: "PHOTO_APRES", source: { base64: b64(JPEG), nom: "apres.jpg" } };
    const apercu = await appeler(outils.outilAjouterFichier, args);
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.match(apercu.texte, /coverswap\.fr/);
    assert.equal((await prisma.publicationSite.findUniqueOrThrow({ where: { id: ids.publiee } })).photoApres, null);
    const fait = await appeler(outils.outilAjouterFichier, { ...args, confirmation: apercu.confirmation!.jeton });
    assert.ok((await prisma.publicationSite.findUniqueOrThrow({ where: { id: ids.publiee } })).photoApres, fait.texte);
  });
});

describe("ajouter_fichier : devis repris (logique de deposer_document)", () => {
  test("devis visible : aperçu + jeton (étape annoncée), puis document repris et étape changée", async () => {
    const args = { cible: { entite: "DOSSIER", id: ids.dossier }, type: "DEVIS", numero: "2026-901", montant: 1850, libelle: "façades seules", inscrire_au_registre: true, source: { base64: PDF.toString("base64"), nom: "devis.pdf" } };
    const apercu = await appeler(outils.outilAjouterFichier, args);
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.match(apercu.texte, /Devis envoyé/);
    assert.equal(await prisma.document.count({ where: { dossierId: ids.dossier } }), 0, "rien avant la confirmation");
    const fait = await appeler(outils.outilAjouterFichier, { ...args, confirmation: apercu.confirmation!.jeton });
    const doc = await prisma.document.findFirst({ where: { dossierId: ids.dossier, numero: "2026-901" } });
    assert.ok(doc?.pdfPath, fait.texte);
    assert.match(fait.texte, /passe de « Qualification »/);
  });

  test("devis déposé par lien (à compléter), puis complété par ajouter_fichier source.lien_depot", async () => {
    const lien = await appeler(outils.outilLienDepot, { cible: { entite: "DOSSIER", id: ids.dossier }, type: "DEVIS" });
    const { depot_id, lien: adresse } = donnees<{ depot_id: string; lien: string }>(lien);
    const jeton = adresse.split("/").pop()!;
    const { cle } = await jetons.ouvrirDepot(jeton, { tailles: [PDF.length] });
    const recu = await jetons.recevoirFichier(jeton, cle, { contenu: PDF, nom: "devis-papier.pdf" });
    assert.equal(recu.aCompleter, true);
    const docs = await appeler(outils.outilVoirFichiers, { genre: "documents", cible: { entite: "DOSSIER", id: ids.dossier } });
    assert.match(docs.texte, /À COMPLÉTER/);
    assert.match(docs.texte, /2026-901/);

    const args = { cible: { entite: "DOSSIER", id: ids.dossier }, type: "DEVIS", numero: "2026-902", montant: 2400, inscrire_au_registre: true, visible_espace: false, source: { lien_depot: depot_id } };
    const apercu = await appeler(outils.outilAjouterFichier, args);
    assert.ok(apercu.confirmation?.jeton, "un devis repris reste sensible, comme deposer_document");
    const fait = await appeler(outils.outilAjouterFichier, { ...args, confirmation: apercu.confirmation!.jeton });
    assert.ok(await prisma.document.findFirst({ where: { dossierId: ids.dossier, numero: "2026-902" } }), fait.texte);
    const provisoire = await prisma.fichierDepose.findUniqueOrThrow({ where: { id: recu.id } });
    assert.ok(provisoire.rangeLe, "le dépôt « à compléter » est clos");
  });
});

describe("ajouter_fichier : par URL (réseau remplacé)", () => {
  test("lien public téléchargé ; adresse interne refusée", async () => {
    url.definirReseauEssai({
      resoudre: async (hote) => (hote === "fournisseur.exemple.fr" ? [{ address: "93.184.216.34", family: 4 }] : hote === "piege.exemple.fr" ? [{ address: "10.0.0.7", family: 4 }] : []),
      transport: async ({ url: u }) => ({ statut: 200, entetes: { "content-type": "application/pdf" }, corps: (async function* () { yield new Uint8Array(PDF); })(), fermer: () => undefined, ...(u.hostname === "fournisseur.exemple.fr" ? {} : { statut: 500 }) }),
    });
    const ok = await appeler(outils.outilAjouterFichier, { cible: { entite: "CLIENT", id: ids.autre }, type: "PLAN", source: { url: "https://fournisseur.exemple.fr/plans/cuisine.pdf" } });
    assert.match(ok.texte, /plan rattaché à la fiche client/, ok.texte);
    const ligne = await prisma.fichierDepose.findFirstOrThrow({ where: { cibleId: ids.autre } });
    assert.equal(ligne.voie, "URL");
    for (const adresse of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:3001/api/mcp", "http://localhost/x.pdf", "https://piege.exemple.fr/x.pdf", "http://[::1]/x.pdf", "http://10.1.1.1/x.pdf"]) {
      const r = await appeler(outils.outilAjouterFichier, { cible: { entite: "CLIENT", id: ids.autre }, type: "PLAN", source: { url: adresse } });
      assert.match(r.texte, /^Refusé : Adresse refusée|^Refusé : .*ports/, `${adresse} : ${r.texte}`);
    }
    assert.equal(await prisma.fichierDepose.count({ where: { cibleId: ids.autre } }), 1, "rien d'autre n'est écrit");
    url.definirReseauEssai(null);
  });
});

describe("dépôt libre, ranger_fichier, voir_fichiers", () => {
  test("dépôt libre → « À ranger » (vu en image) → ranger_fichier sur le dossier → retirer → remettre", async () => {
    const lien = await appeler(outils.outilLienDepot, {});
    const { lien: adresse } = donnees<{ lien: string }>(lien);
    assert.match(lien.texte, /À ranger/);
    const jeton = adresse.split("/").pop()!;
    const { cle } = await jetons.ouvrirDepot(jeton, { tailles: [JPEG.length, PDF.length] });
    const image = await jetons.recevoirFichier(jeton, cle, { contenu: JPEG, nom: "libre.jpg" });
    await jetons.recevoirFichier(jeton, cle, { contenu: PDF, nom: "libre.pdf" });

    const boite = await appeler(outils.outilVoirFichiers, { genre: "a_ranger" });
    assert.equal(boite.images?.length, 1, boite.texte);
    assert.match(boite.texte, new RegExp(`\\[fichier:${image.id}\\]`));
    assert.match(boite.texte, /2 fichiers/);

    const range = await appeler(outils.outilRangerFichier, { fichier: `fichier:${image.id}`, cible: { entite: "DOSSIER", id: ids.dossier }, type: "PHOTO_AVANT" });
    const nouveau = donnees<{ fichiers: { id: string; photoId: string }[] }>(range).fichiers[0];
    assert.ok((await photos(ids.dossier)).some((c) => c.includes(nouveau.photoId)), range.texte);
    assert.match((await appeler(outils.outilVoirFichiers, { genre: "a_ranger" })).texte, /1 fichier/);

    const retrait = await appeler(outils.outilRangerFichier, { fichier: nouveau.id, retirer: true });
    assert.match(retrait.texte, /retiré/);
    assert.equal((await photos(ids.dossier)).some((c) => c.includes(nouveau.photoId)), false);
    const vues = await appeler(outils.outilVoirFichiers, { genre: "photos", cible: { entite: "DOSSIER", id: ids.dossier }, retirees: true });
    assert.match(vues.texte, new RegExp(`Photo retirée.*\\[fichier:${nouveau.id}\\]`));
    const remise = await appeler(outils.outilRangerFichier, { fichier: nouveau.id, remettre: true });
    assert.match(remise.texte, /remis/);
    assert.ok((await photos(ids.dossier)).some((c) => c.includes(nouveau.photoId)));
  });

  test("une photo déjà dans le dossier (pas passée par un dépôt) se retire et se remet par photo:<id>", async () => {
    const chemin = (await photos(ids.dossier))[0];
    const photoId = path.posix.basename(chemin).replace(/\.[^.]+$/, "");
    const r = await appeler(outils.outilRangerFichier, { fichier: `photo:${photoId}`, retirer: true });
    assert.match(r.texte, /retiré/, r.texte);
    assert.equal((await photos(ids.dossier)).includes(chemin), false);
    const m = await appeler(outils.outilRangerFichier, { fichier: `photo:${photoId}`, remettre: true });
    assert.match(m.texte, /remis/, m.texte);
    assert.ok((await photos(ids.dossier)).includes(chemin));
  });

  test("voir_fichiers : justificatif d'une dépense en image ou en lien, simulations et site repris", async () => {
    const depense = await appeler(outils.outilVoirFichiers, { genre: "documents", cible: { entite: "DEPENSE", id: ids.depense } });
    assert.match(depense.texte, /Justificatif de la dépense/);
    assert.match(depense.texte, /\/api\/depenses\//);
    const simulations = await appeler(outils.outilVoirFichiers, { genre: "simulations", cible: { entite: "DOSSIER", id: ids.dossier } });
    assert.match(simulations.texte, /Aucune simulation/);
    const site = await appeler(outils.outilVoirFichiers, { genre: "site", jours: 30 });
    assert.match(site.texte, /Aucune simulation faite sur le site/);
    const journal = await prisma.appelOutil.count({ where: { sessionId: session.id, outil: "voir_fichiers" } });
    assert.ok(journal >= 3, "chaque appel est journalisé");
  });
});
