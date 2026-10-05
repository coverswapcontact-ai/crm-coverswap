import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-depot-atomique-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B4, écart 4) : `deposerDocument` atomique. Le PDF est vérifié avant toute écriture (un faux PDF ne
 * consomme aucun numéro et ne fait pas bouger le dossier ; on peut réessayer), puis document, PDF et étape s'écrivent
 * d'un bloc (une transaction qui échoue ne laisse rien, le PDF écrit quitte sa place). Un devis déposé « accepté » (signé
 * hors ligne) sur un dossier pas encore signé le fait passer en « Signé » dans la même transaction, les autres devis
 * proposés « non retenus » — aussi pour un devis repris corrigé en « accepté », et pour la correction du contrôle de
 * cohérence. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`). Rien ne sort du poste (aucun mail : pas d'adresse
 * annoncée, `notifier: false`).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let documents: typeof import("./documents");
let existants: typeof import("./documents-existants");
let transitions: typeof import("./transitions");
let depot: typeof import("./depot-document");
let dossiers: typeof import("./dossiers");
let stockage: typeof import("./stockage");
let controle: typeof import("@/lib/coherence/controle");
let NextRequest: typeof import("next/server").NextRequest;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const ACCORD = "Appeler le client : fixer la date du chantier, suivre l'acompte";
// Les devis déposés (inscrits au registre) prennent leur numéro en descendant depuis 2026-999 : la génération, qui prend
// le plus grand du registre + 1, ne retombe jamais sur l'un d'eux.
let rang = 999;
const numero = () => `2026-${rang--}`;
// Un devis écrit directement en base n'est pas au registre : il prend son numéro sous ceux du registre (la génération
// prend le plus grand du registre + 1, et pourrait sinon reprendre le sien).
let rangDirect = 850;
const numeroDirect = () => `2026-${rangDirect++}`;

async function contact(prenom: string, etape: "SIMULATION" | "DEVIS_ENVOYE" = "SIMULATION") {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await avecActeur(LUCAS, () => transitions.changerEtape(ouvert.dossierId, { vers: "SIMULATION" }));
  if (etape === "DEVIS_ENVOYE") await avecActeur(LUCAS, () => transitions.changerEtape(ouvert.dossierId, { vers: "DEVIS_ENVOYE" }));
  // Le client a choisi : l'espace a posé « Préparer le devis » (un devis déposé le remplace).
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
  // L'espace ouvert il y a deux jours (un geste à moins d'une minute d'un passage l'emporterait sur l'étape, main.ts).
  await prisma.dossierEvenement.updateMany({ where: { dossierId: ouvert.dossierId }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) } });
  await (await import("./main")).recalculerMain(ouvert.dossierId);
  return { leadId: lead.id, dossierId: ouvert.dossierId, nom: `${prenom} Essai` };
}

/** Le dépôt de l'outil « ajouter_fichier » et de l'écran (même fonction). */
function deposer(dossierId: string, champs: Record<string, unknown>, contenu: Buffer = PDF) {
  return avecActeur(LUCAS, () =>
    depot.deposerDocument(dossierId, depot.schemaDepotDocument.parse({ type: "DEVIS", montant: 2400, acompte_pct: 30, inscrire_au_registre: true, source: { contenu_base64: contenu.toString("base64"), nom: "devis.pdf" }, ...champs }))
  );
}

const cleDuNumero = (n: string) => `:${n.slice(0, 4)}:${Number(n.slice(5))}`;
const cheminPdf = (dossierId: string, n: string) => `dossiers/${dossierId}/documents/DEVIS-${n}.pdf`;
const typesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>) => [...new Set(etat.taches.map((t) => t.type))].sort();
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  documents = await import("./documents");
  existants = await import("./documents-existants");
  transitions = await import("./transitions");
  depot = await import("./depot-document");
  dossiers = await import("./dossiers");
  stockage = await import("./stockage");
  controle = await import("@/lib/coherence/controle");
  NextRequest = (await import("next/server")).NextRequest;
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("dépôt d'un devis d'un bloc (mission 18, B4)", () => {
  test("faux PDF : refusé avant toute écriture (aucun numéro inscrit, aucun document, rien ne bouge des deux côtés) ; le vrai PDF ensuite passe", async () => {
    const c = await contact("Faux");
    const n = numero();
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.prochaineAction], ["SIMULATION", "Préparer le devis (simulation choisie)"]);

    await assert.rejects(deposer(c.dossierId, { numero: n }, Buffer.from("pas un pdf, une image renommée")), /n'est pas un PDF/);
    await assert.rejects(deposer(c.dossierId, { numero: n }, Buffer.from("%PD")), /n'est pas un PDF/, "un PDF tronqué non plus");
    assert.equal(await prisma.numeroDocument.count({ where: { cle: cleDuNumero(n) } }), 0, "aucun numéro consommé");
    assert.equal(await prisma.document.count({ where: { dossierId: c.dossierId } }), 0);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: { in: ["DOCUMENT_REPRIS", "CHANGEMENT_ETAPE"] }, createdAt: { gt: new Date(Date.now() - 60_000) }, contenu: { contains: "Devis envoyé" } } }), 0);
    assert.equal(await stockage.lireFichier(cheminPdf(c.dossierId, n)), null, "aucun fichier écrit");
    const refuse = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual(
      [refuse.etape, refuse.main, refuse.mainCalculee, refuse.prochaineAction, refuse.statutLead, refuse.etapeEspace, refuse.relances, typesDe(refuse)],
      [avant.etape, avant.main, avant.mainCalculee, avant.prochaineAction, avant.statutLead, avant.etapeEspace, avant.relances, typesDe(avant)],
      "des deux côtés, rien n'a bougé"
    );

    // Nouvelle tentative, le bon PDF : même numéro, tout d'un coup.
    const depose = await deposer(c.dossierId, { numero: n });
    assert.equal(depose.nature, "DOCUMENT");
    const documentId = depose.nature === "DOCUMENT" ? depose.documentId : "";
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.main, apres.mainCalculee, apres.prochaineAction, apres.statutLead, apres.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(apres.relances.devis.map((d) => [d.numero, d.rang]), [[n, 1]], "relance à venir, datée du dépôt");
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    assert.equal(document.pdfPath, cheminPdf(c.dossierId, n), "le PDF est rattaché dans la même transaction");
    assert.match((await documents.lirePdfDocument(c.dossierId, documentId)).contenu.toString("latin1"), /^%PDF-/);
  });

  test("transaction qui échoue après l'écriture du PDF : rien en base, le PDF quitte sa place (archives), l'étape ne bouge pas", async () => {
    const c = await contact("Echec");
    const n = numeroDirect();
    // Un document d'ailleurs porte déjà ce numéro sans être au registre (données anciennes) : la création échoue, APRÈS
    // l'écriture du PDF sous ce numéro.
    const autre = await contact("Ailleurs");
    await prisma.document.create({ data: { dossierId: autre.dossierId, type: "DEVIS", numero: n, dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 900, statut: "ENVOYE", origine: "REPRISE" } });
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });

    await assert.rejects(deposer(c.dossierId, { numero: n }), /porte déjà le numéro/);
    assert.equal(await stockage.lireFichier(cheminPdf(c.dossierId, n)), null, "le PDF écrit pendant la transaction n'est plus servi");
    assert.equal(await prisma.numeroDocument.count({ where: { cle: cleDuNumero(n) } }), 0, "l'inscription au registre est annulée avec le reste");
    assert.equal(await prisma.document.count({ where: { dossierId: c.dossierId } }), 0);
    const apres = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([apres.etape, apres.main, apres.prochaineAction, apres.etapeEspace, apres.relances], [avant.etape, avant.main, avant.prochaineAction, avant.etapeEspace, avant.relances]);
  });

  test("devis déposé « accepté » en Simulation → « Signé » d'un bloc : l'autre devis non retenu, accord (date du chantier, acompte), espace à l'acompte, plus de relance", async () => {
    const c = await contact("Signe");
    // Un devis du CRM prêt mais pas envoyé (B1 : masqué, tâche « Envoyer le devis ») : le client a signé autre chose.
    const { document: genere } = await avecActeur(LUCAS, () =>
      documents.genererDocument(c.dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Cuisine", lignes: [{ type: "PRESTATION", designation: "Revêtement adhésif", quantite: 6, unite: "ml", prixUnitaire: 110 }], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
    );
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.main, avant.mainMotif], ["SIMULATION", "MOI", "Devis prêt, pas encore envoyé (" + genere.numero + ") : à lui envoyer"]);
    assert.ok(typesDe(avant).includes("ENVOYER_DEVIS"));

    const n = numero();
    const depose = await deposer(c.dossierId, { numero: n, statut: "ACCEPTE", libelle: "signé sur place" });
    assert.equal(depose.nature, "DOCUMENT");
    const documentId = depose.nature === "DOCUMENT" ? depose.documentId : "";
    assert.deepEqual(depose.nature === "DOCUMENT" ? depose.changements.map((ch) => [ch.de, ch.vers, ch.documentId]) : [], [["SIMULATION", "SIGNE", documentId]]);

    const apres = await etatDesDeuxCotes(c.dossierId);
    // Signé : l'acompte est attendu du client (responsable de l'étape) ; à moi, la prochaine action (date, acompte).
    assert.deepEqual([apres.etape, apres.main, apres.mainCalculee, apres.mainMotif, apres.statutLead], ["SIGNE", "CLIENT", "CLIENT", "Étape « Signé »", "SIGNE"]);
    assert.equal(apres.prochaineAction, ACCORD);
    assert.equal(apres.etapeEspace, "ACOMPTE", "l'espace du client le dit signé, à l'acompte");
    assert.deepEqual(apres.relances, { proposables: [], devis: [] }, "un dossier signé ne se relance plus");
    assert.ok(!typesDe(apres).includes("ENVOYER_DEVIS"), "le devis pas envoyé n'est plus à envoyer : non retenu");
    assert.ok(!typesDe(apres).includes("RELANCER_DEVIS"));
    assert.deepEqual([await statutDe(documentId), await statutDe(genere.id)], ["ACCEPTE", "NON_RETENU"]);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).pdfPath, cheminPdf(c.dossierId, n));

    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, new RegExp(`^Simulation → Signé : devis ${n} déposé « accepté » \\(signé hors ligne\\) ; non retenu : ${genere.numero}`));
    assert.deepEqual(JSON.parse(passage.metadata).confirmations, ["BON_POUR_ACCORD"]);
    const repris = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DOCUMENT_REPRIS" } });
    assert.match(repris.contenu, /, accepté \(signé hors ligne\)$/);
    // Le dossier, comme l'assistant le lit : un devis accepté, un « non retenu ».
    const detail = await dossiers.chargerDetail(c.dossierId);
    assert.deepEqual(detail.documents.filter((d) => d.type === "DEVIS").map((d) => d.statut).sort(), ["ACCEPTE", "NON_RETENU"]);
  });

  test("action posée à la main : gardée, une tâche « accord » à la place ; déposé « accepté » sur un dossier déjà signé : l'étape et la prochaine action ne bougent pas", async () => {
    const c = await contact("Manuelle", "DEVIS_ENVOYE");
    const ecrite = "Rappeler jeudi : il hésite entre deux teintes";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: ecrite }));
    await deposer(c.dossierId, { numero: numero(), statut: "ACCEPTE" });
    const signe = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([signe.etape, signe.prochaineAction, signe.actionManuelle, signe.statutLead], ["SIGNE", ecrite, ecrite, "SIGNE"]);
    const gardee = signe.taches.find((t) => t.cle === `MANUELLE:synchro:${c.dossierId}:accord`);
    assert.ok(gardee, "une tâche dit l'accord à la place de l'action gardée");
    assert.match(gardee.titre, /^Appeler le client : fixer la date du chantier/);

    // Un second devis « accepté » (un complément signé) sur le dossier signé : rien ne bouge, rien n'attend d'accord.
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: null }));
    await deposer(c.dossierId, { numero: numero(), statut: "ACCEPTE" });
    const encore = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([encore.etape, encore.prochaineAction, encore.main], ["SIGNE", null, encore.mainCalculee]);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", contenu: { contains: "→ Signé" } } }), 1);
  });

  test("devis repris corrigé en « accepté » (écran, outil « modifier ») : « Signé » dans la même transaction, l'autre devis non retenu", async () => {
    const c = await contact("Corrige");
    const premier = await deposer(c.dossierId, { numero: numero() });
    const second = await deposer(c.dossierId, { numero: numero(), libelle: "variante" });
    const [idA, idB] = [premier, second].map((d) => (d.nature === "DOCUMENT" ? d.documentId : ""));
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "DEVIS_ENVOYE");

    await avecActeur(LUCAS, () => existants.modifierDocumentExistant(c.dossierId, idB, { statut: "ACCEPTE" }));
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.main, apres.mainCalculee, apres.statutLead, apres.prochaineAction, apres.etapeEspace], ["SIGNE", "CLIENT", "CLIENT", "SIGNE", ACCORD, "ACOMPTE"]);
    assert.deepEqual(apres.relances, { proposables: [], devis: [] });
    assert.deepEqual([await statutDe(idA), await statutDe(idB)], ["NON_RETENU", "ACCEPTE"]);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.match(passage.contenu, /^Devis envoyé → Signé : devis .+ noté « accepté » \(signé hors ligne\) ; non retenu : /);

    // Corrigé de nouveau en « accepté » : déjà accepté, rien ne se rejoue.
    await avecActeur(LUCAS, () => existants.modifierDocumentExistant(c.dossierId, idB, { statut: "ACCEPTE", montant: 2500 }));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", contenu: { contains: "→ Signé" } } }), 1);
  });

  test("l'écran : le PDF dans la même requête (formulaire) ; un faux PDF n'écrit rien, le JSON seul reste accepté", async () => {
    const c = await contact("Ecran");
    const route = await import("@/app/api/dossiers/[id]/documents/existant/route");
    const params = Promise.resolve({ id: c.dossierId });
    const formulaire = (donnees: Record<string, unknown>, contenu: Buffer) => {
      const f = new FormData();
      f.set("donnees", JSON.stringify(donnees));
      f.set("pdf", new File([new Uint8Array(contenu)], "devis.pdf", { type: "application/pdf" }));
      return new NextRequest(`http://localhost/api/dossiers/${c.dossierId}/documents/existant`, { method: "POST", body: f });
    };
    const n = numero();
    const donnees = { type: "DEVIS", numero: n, dateEmission: new Date().toISOString().slice(0, 10), montant: 1800, statut: "ACCEPTE", visibleEspace: true, inscrireAuRegistre: true };

    const refuse = await avecActeur(LUCAS, () => route.POST(formulaire(donnees, Buffer.from("rien d'un pdf")), { params }));
    assert.equal(refuse.status, 415);
    assert.equal(await prisma.numeroDocument.count({ where: { cle: cleDuNumero(n) } }), 0);
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "SIMULATION");

    const reponse = await avecActeur(LUCAS, () => route.POST(formulaire(donnees, PDF), { params }));
    assert.equal(reponse.status, 201);
    const corps = (await reponse.json()) as { documentId: string; changements: { vers: string }[]; dossier: { etape: string } };
    assert.deepEqual([corps.changements.map((ch) => ch.vers), corps.dossier.etape], [["SIGNE"], "SIGNE"]);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: corps.documentId } })).pdfPath, cheminPdf(c.dossierId, n));

    const json = await avecActeur(LUCAS, () =>
      route.POST(new NextRequest(`http://localhost/api/dossiers/${c.dossierId}/documents/existant`, { method: "POST", body: JSON.stringify({ ...donnees, numero: numero(), statut: "REFUSE" }), headers: { "content-type": "application/json" } }), { params })
    );
    assert.equal(json.status, 201);
  });

  test("contrôle de cohérence : un devis « accepté » d'avant B4 sur un dossier pas signé → la correction le signe, par la même fonction", async () => {
    const c = await contact("Ancien", "DEVIS_ENVOYE");
    const accepte = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: numeroDirect(), dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 2000, acomptePct: 30, statut: "ACCEPTE", origine: "REPRISE" } });
    const variante = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: numeroDirect(), dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 2200, acomptePct: 30, statut: "ENVOYE", origine: "REPRISE" } });
    const vues = (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId && i.code === "DEVIS_ACCEPTE_AVANT_SIGNE");
    assert.equal(vues.length, 1);
    assert.match(vues[0].correction ?? "", /^Passer le dossier en « Signé »/);

    const resultat = await avecActeur(LUCAS, () => controle.corrigerIncoherence(vues[0].cle));
    assert.ok(resultat.corrigee);
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.main, apres.mainCalculee, apres.statutLead, apres.prochaineAction, apres.etapeEspace], ["SIGNE", "CLIENT", "CLIENT", "SIGNE", ACCORD, "ACOMPTE"]);
    assert.deepEqual([await statutDe(accepte.id), await statutDe(variante.id)], ["ACCEPTE", "NON_RETENU"]);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "COHERENCE_CORRIGEE" } }), 1);
    assert.deepEqual((await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId && i.code === "DEVIS_ACCEPTE_AVANT_SIGNE"), []);
  });
});
