import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-signature-b8-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B8, écart 8) : le bon pour accord du client et le passage en « Signé » dans UNE transaction. Une panne au
 * milieu n'écrit rien (la nouvelle tentative signe) ; rejoué ou doublé, il n'écrit qu'un accord ; un accord d'avant B8
 * resté sans signature (deux temps interrompus) est terminé par la nouvelle tentative. Chaque cas : le déclencheur,
 * puis l'état DES DEUX CÔTÉS (`etatDesDeuxCotes` : étape, main, prochaine action, étape de l'espace, relances, tâches).
 * Rien ne sort du poste : réseau coupé, mails seulement programmés.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("./service");
let documents: typeof import("@/lib/dossiers/documents");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let transitions: typeof import("@/lib/dossiers/transitions");
let coherence: typeof import("@/lib/coherence/controle");
let auto: typeof import("@/lib/dossiers/prochaine-action-auto");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const ORIGINE = { ip: "203.0.113.8", navigateur: "Safari iPhone" };
const ACCORD_SIGNE = "Appeler le client : fixer la date du chantier, suivre l'acompte";
/** Une signature au doigt minimale (en-tête PNG, assez d'octets pour être retenue). */
const SIGNATURE = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]).toString("base64")}`;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré et annoncé (« Devis disponible » : espace ouvert, adresse valide). */
const generer = (dossierId: string, objet: string, prix = 150) =>
  avecActeur(LUCAS, () => documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif", 10, prix)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: true })));

/** Un contact avec son espace, en Simulation, et deux variantes de devis envoyées (le dossier passe « Devis envoyé »). */
async function enAttenteDAccord(prenom: string) {
  const email = `${prenom.toLowerCase()}.b8@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3364${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Mauguio", codePostal: "34130", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  await avecActeur(LUCAS, () => transitions.changerEtape(ouvert.dossierId, { vers: "SIMULATION" }));
  const { document: devis } = await generer(ouvert.dossierId, "Cuisine", 150);
  const { document: variante } = await generer(ouvert.dossierId, "Cuisine, variante bois", 170);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, nom: `${prenom} Essai`, devis, variante };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;
const compter = (dossierId: string, type: string) => prisma.dossierEvenement.count({ where: { dossierId, type } });
const signer = async (c: { espaceId: string; nom: string }, documentId: string, signature?: string) => service.accepterDevis(await espaceDe(c.espaceId), { documentId, nom: c.nom, accepte: true, ...(signature ? { signature } : {}) }, ORIGINE);

/** Panne simulée dans la transaction : l'écriture du changement d'étape de CE dossier échoue (après l'accord). */
const PANNE = "panne_b8";
const provoquerPanne = (dossierId: string) =>
  prisma.$executeRawUnsafe(`CREATE TRIGGER ${PANNE} BEFORE INSERT ON DossierEvenement WHEN NEW.type = 'CHANGEMENT_ETAPE' AND NEW.dossierId = '${dossierId}' BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;`);
const reparer = () => prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PANNE}`);

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("./service");
  documents = await import("@/lib/dossiers/documents");
  dossiers = await import("@/lib/dossiers/dossiers");
  transitions = await import("@/lib/dossiers/transitions");
  coherence = await import("@/lib/coherence/controle");
  auto = await import("@/lib/dossiers/prochaine-action-auto");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await reparer();
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("signature en une transaction (mission 18, B8)", () => {
  test("bon pour accord : accord, Signé, devis accepté, variante non retenue, prochaine action, main et lead — d'un bloc, des deux côtés", async () => {
    const c = await enAttenteDAccord("Bastien");
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.etapeEspace, avant.devisASigner], ["DEVIS_ENVOYE", "DEVIS", [c.devis.numero, c.variante.numero]]);

    assert.deepEqual(await signer(c, c.devis.id), { dejaAccepte: false });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["SIGNE", "SIGNE", "ACOMPTE", []]);
    assert.equal(etat.prochaineAction, ACCORD_SIGNE);
    assert.equal(etat.actionManuelle, null);
    assert.equal(etat.main, etat.mainCalculee, "la main écrite est celle de la règle");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] }, "plus de relance de devis sur un dossier signé");
    assert.ok(!etat.taches.some((t) => t.type === "ENVOYER_DEVIS" || t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)), "ni devis à envoyer, ni tâche à la place d'une action posée à la main");

    assert.deepEqual([await statutDe(c.devis.id), await statutDe(c.variante.id)], ["ACCEPTE", "NON_RETENU"]);
    const accords = await prisma.accordDevis.findMany({ where: { dossierId: c.dossierId } });
    assert.deepEqual(accords.map((a) => [a.documentId, a.nomSignataire, a.ip, a.retireLe]), [[c.devis.id, c.nom, ORIGINE.ip, null]]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, /→ Signé : bon pour accord donné dans l'espace client sur le devis .* ; non retenu : /);
    assert.equal(JSON.parse(passage.metadata).documentId, c.devis.id);
    assert.equal(await compter(c.dossierId, "ESPACE_DEVIS_ACCEPTE"), 1);
  });

  test("panne au milieu de la transaction : rien d'écrit ; la nouvelle tentative signe, avec la même signature au doigt", async () => {
    const c = await enAttenteDAccord("Clemence");
    const passagesAvant = await compter(c.dossierId, "CHANGEMENT_ETAPE");
    await provoquerPanne(c.dossierId);
    try {
      await assert.rejects(signer(c, c.devis.id, SIGNATURE), /panne simulée|Enregistrement impossible/, "la panne (traduite par le journal)");
    } finally {
      await reparer();
    }
    // Rien de la tentative : ni accord, ni événement, ni devis accepté, ni variante écartée, ni étape.
    const apresPanne = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apresPanne.etape, apresPanne.statutLead, apresPanne.etapeEspace, apresPanne.devisASigner], ["DEVIS_ENVOYE", "DEVIS_ENVOYE", "DEVIS", [c.devis.numero, c.variante.numero]]);
    assert.equal(apresPanne.main, apresPanne.mainCalculee);
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: c.dossierId } }), 0);
    assert.equal(await compter(c.dossierId, "ESPACE_DEVIS_ACCEPTE"), 0);
    assert.equal(await compter(c.dossierId, "CHANGEMENT_ETAPE"), passagesAvant);
    assert.notEqual(await statutDe(c.devis.id), "ACCEPTE");
    assert.notEqual(await statutDe(c.variante.id), "NON_RETENU");
    assert.ok(apresPanne.prochaineAction !== ACCORD_SIGNE);

    // La nouvelle tentative : signée, d'un bloc.
    assert.deepEqual(await signer(c, c.devis.id, SIGNATURE), { dejaAccepte: false });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.prochaineAction], ["SIGNE", "SIGNE", "ACOMPTE", ACCORD_SIGNE]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, []);
    assert.equal(await compter(c.dossierId, "CHANGEMENT_ETAPE"), passagesAvant + 1);
    // La signature au doigt : écrite avant la transaction, sous un nom stable — un seul fichier pour les deux tentatives.
    const accord = await prisma.accordDevis.findFirstOrThrow({ where: { dossierId: c.dossierId } });
    assert.match(accord.signature ?? "", new RegExp(`^dossiers/${c.dossierId}/accords/signature-${c.devis.id}-[0-9a-f]{16}\\.png$`));
    assert.deepEqual(readdirSync(path.join(process.env.UPLOADS_DIR!, "dossiers", c.dossierId, "accords")), [path.posix.basename(accord.signature!)]);
  });

  test("nouvelle tentative sans effet : deux appuis en même temps, puis rejouée — un seul accord, un seul passage", async () => {
    const c = await enAttenteDAccord("Dorian");
    const passagesAvant = await compter(c.dossierId, "CHANGEMENT_ETAPE");
    const issues = await Promise.allSettled([signer(c, c.devis.id), signer(c, c.devis.id)]);
    // Les deux transactions se suivent (SQLite n'a qu'un écrivain) : la seconde relit l'accord de la première.
    assert.deepEqual(issues.map((i) => (i.status === "fulfilled" ? i.value.dejaAccepte : String(i.reason))).sort(), [false, true], "l'un signe, l'autre trouve l'accord");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: c.dossierId } }), 1, "un seul accord");
    assert.equal(await compter(c.dossierId, "ESPACE_DEVIS_ACCEPTE"), 1);
    assert.equal(await compter(c.dossierId, "CHANGEMENT_ETAPE"), passagesAvant + 1, "un seul passage en Signé");
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.prochaineAction], ["SIGNE", "SIGNE", "ACOMPTE", ACCORD_SIGNE]);

    // Rejouée (page rechargée, réseau revenu) : sans effet, même sur la variante restée non retenue.
    const versions = await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId }, select: { updatedAt: true, prochaineActionDate: true } });
    assert.deepEqual(await signer(c, c.devis.id), { dejaAccepte: true });
    await assert.rejects(signer(c, c.variante.id), /n'est plus en vigueur/);
    const rejouee = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual(rejouee, etat, "rien n'a bougé, des deux côtés");
    assert.deepEqual(await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId }, select: { updatedAt: true, prochaineActionDate: true } }), versions);
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: c.dossierId } }), 1);
    assert.equal(await compter(c.dossierId, "CHANGEMENT_ETAPE"), passagesAvant + 1);
  });

  test("accord d'une signature en deux temps interrompue (d'avant B8) : la nouvelle tentative termine le passage en Signé", async () => {
    const c = await enAttenteDAccord("Eloise");
    // L'ancien chemin : l'accord et son événement écrits, puis le passage en « Signé » perdu (409, coupure).
    await prisma.accordDevis.create({ data: { dossierId: c.dossierId, documentId: c.devis.id, numeroDevis: c.devis.numero, totalHt: 1500, acomptePct: 30, nomSignataire: c.nom, mention: "Bon pour accord", ip: null, navigateur: null } });
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "ESPACE_DEVIS_ACCEPTE", direction: "ENTRANT", contenu: `Bon pour accord donné par ${c.nom} sur le devis ${c.devis.numero}`, metadata: JSON.stringify({ documentId: c.devis.id }) } });
    const controle = await coherence.controlerCoherence();
    assert.ok(controle.incoherences.some((i) => i.dossierId === c.dossierId && i.code === "ACCORD_SANS_SIGNATURE"), "l'écart que laissait l'ancien chemin");

    assert.deepEqual(await signer(c, c.devis.id), { dejaAccepte: true }, "l'accord était déjà là");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.prochaineAction], ["SIGNE", "SIGNE", "ACOMPTE", ACCORD_SIGNE]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, []);
    assert.deepEqual([await statutDe(c.devis.id), await statutDe(c.variante.id)], ["ACCEPTE", "NON_RETENU"]);
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: c.dossierId } }), 1, "pas de second accord");
    assert.equal(await compter(c.dossierId, "ESPACE_DEVIS_ACCEPTE"), 1, "l'accord n'est pas raconté deux fois");
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, /→ Signé : bon pour accord donné dans l'espace client sur le devis .* \(passage terminé à la nouvelle tentative\) ; non retenu : /);
    assert.ok(!(await coherence.controlerCoherence()).incoherences.some((i) => i.dossierId === c.dossierId && i.code === "ACCORD_SANS_SIGNATURE"));

    // Et rejouée encore : sans effet.
    const passages = await compter(c.dossierId, "CHANGEMENT_ETAPE");
    assert.deepEqual(await signer(c, c.devis.id), { dejaAccepte: true });
    assert.equal(await compter(c.dossierId, "CHANGEMENT_ETAPE"), passages);
  });

  test("en pause depuis Devis envoyé, une action posée à la main : Signé (sortie de pause), l'action gardée avec la tâche à côté ; perdu : refusé", async () => {
    const c = await enAttenteDAccord("Fabrice");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "EN_PAUSE" }));
    const ecrite = "Passer chez le client avec les échantillons de bois";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: ecrite }));

    assert.deepEqual(await signer(c, c.devis.id), { dejaAccepte: false });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace], ["SIGNE", "SIGNE", "ACOMPTE"]);
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], [ecrite, ecrite], "jamais écrasée");
    assert.equal(etat.main, etat.mainCalculee);
    const gardee = etat.taches.filter((t) => t.cle === `${auto.PREFIXE_TACHE_SYNCHRO}${c.dossierId}:accord`);
    assert.equal(gardee.length, 1, "la prochaine action de l'accord, rangée en tâche");
    assert.match(gardee[0].titre, /fixer la date du chantier/);

    // Un projet perdu est figé : le service refuse, comme la route (rien d'écrit).
    const p = await enAttenteDAccord("Gaspard");
    await avecActeur(LUCAS, () => transitions.changerEtape(p.dossierId, { vers: "PERDU", motifPerte: "PRIX" }));
    await assert.rejects(signer(p, p.devis.id), /n'a pas été réalisé/);
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: p.dossierId } }), 0);
    assert.equal((await etatDesDeuxCotes(p.dossierId, { taches: false })).etape, "PERDU");
  });
});
