import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-avenant-b7-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B7, écart 7) : un nouveau devis ou un avenant émis sur un dossier signé. L'espace le propose
 * (`devisASigner`, `prochainPas`, onglet Devis de nouveau « à faire ») et le fait signer À CÔTÉ du devis d'origine :
 * l'accord d'origine tient, l'étape ne bouge pas, l'acompte reste celui du devis d'origine ; retirer l'accord de
 * l'avenant (ciblé par son devis) ne fait pas reculer le dossier. Chaque cas : le déclencheur, puis l'état DES DEUX
 * CÔTÉS (`etatDesDeuxCotes` + ce que reçoit le site). Rien ne sort du poste : réseau coupé, mails seulement programmés.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("./service");
let validations: typeof import("./validations");
let documents: typeof import("@/lib/dossiers/documents");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let transitions: typeof import("@/lib/dossiers/transitions");
let faits: typeof import("./faits");
let etapes: typeof import("./etapes");
let pas: typeof import("./prochain-pas");
let projets: typeof import("./projets");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const ORIGINE = { ip: null, navigateur: null };

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré et annoncé (« Devis disponible » : espace ouvert, adresse valide). */
const generer = (dossierId: string, objet: string, prix = 150) =>
  avecActeur(LUCAS, () => documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif", 10, prix)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: true })));

async function contact(prenom: string) {
  const email = `${prenom.toLowerCase()}.b7@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3364${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Mauguio", codePostal: "34130", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, nom: `${prenom} Essai` };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;
const accordsActifs = (dossierId: string) => prisma.accordDevis.findMany({ where: { dossierId, retireLe: null }, orderBy: { createdAt: "asc" }, select: { documentId: true } });
const passages = (dossierId: string) => prisma.dossierEvenement.count({ where: { dossierId, type: "CHANGEMENT_ETAPE" } });

/** Signé sur le devis d'origine (bon pour accord dans l'espace), puis un avenant émis et annoncé. */
async function signeAvecAvenant(prenom: string) {
  const c = await contact(prenom);
  await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
  const { document: origine } = await generer(c.dossierId, "Cuisine", 150);
  await service.accepterDevis(await espaceDe(c.espaceId), { documentId: origine.id, nom: c.nom, accepte: true }, ORIGINE);
  const { document: avenant } = await generer(c.dossierId, "Avenant : crédence", 40);
  return { ...c, origine, avenant };
}

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
  validations = await import("./validations");
  documents = await import("@/lib/dossiers/documents");
  dossiers = await import("@/lib/dossiers/dossiers");
  transitions = await import("@/lib/dossiers/transitions");
  faits = await import("./faits");
  etapes = await import("./etapes");
  pas = await import("./prochain-pas");
  projets = await import("./projets");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("avenant ou nouveau devis sur un dossier signé (mission 18, B7)", () => {
  test("règles pures : avenant, devis en vigueur (l'origine), devis à signer, onglets, prochaine étape, pastille", () => {
    const jour = (n: number) => new Date(Date.UTC(2026, 9, n));
    const d = (id: string, statut: string, n: number, visibleEspace = true) => ({ id, statut, createdAt: jour(n), numero: `2026-${id}`, visibleEspace });
    const origine = d("1", "ACCEPTE", 1);
    const variante = d("0", "GENERE", 1); // ancienne variante restée « Généré » (même jour, créée avant) : pas un avenant
    variante.createdAt = new Date(origine.createdAt.getTime() - 1000);
    const avenant = d("2", "GENERE", 5);
    const masque = d("3", "GENERE", 6, false);
    const tous = [variante, origine, avenant, masque];
    assert.equal(faits.estAvenant(avenant, tous), true);
    assert.equal(faits.estAvenant(origine, tous), false);
    assert.equal(faits.estAvenant(variante, tous), false);
    assert.deepEqual(faits.devisASigner(tous, []).map((x) => x.id), ["2"], "après la signature : les avenants visibles seulement");
    assert.deepEqual(faits.devisASigner([d("a", "ENVOYE", 1), d("b", "GENERE", 2), d("c", "NON_RETENU", 3)], []).map((x) => x.id), ["a", "b"], "avant : les devis proposés");
    assert.deepEqual(faits.devisASigner([origine, avenant], [{ documentId: "2", retireLe: null }]).map((x) => x.id), [], "un accord en cours : plus à signer");
    // Deux devis acceptés (avenant signé) : « le devis » reste l'origine (acompte, virement).
    assert.equal(faits.devisEnVigueur([origine, { ...avenant, statut: "ACCEPTE" }])?.id, "1");

    const base = { photos: 1, projet: true, simulationsCrm: 1, simulationsSite: 0, choix: true, devis: true, accord: true, acompteRecu: false, etapeDossier: "SIGNE" };
    const sans = etapes.progression(base);
    const avec = etapes.progression({ ...base, avenantASigner: true });
    assert.deepEqual([sans.find((e) => e.cle === "DEVIS")?.fait, sans.find((e) => e.courante)?.cle], [true, "ACOMPTE"]);
    assert.deepEqual([avec.find((e) => e.cle === "DEVIS")?.fait, avec.find((e) => e.courante)?.cle], [false, "DEVIS"]);
    assert.equal(etapes.etapeEspace({ ...base, avenantASigner: true }), "ACOMPTE", "l'étape de l'espace ne change pas : l'acompte reste dû");

    assert.deepEqual(projets.pastilleDuProjet({ etape: "ACOMPTE", etapeDossier: "SIGNE", dateChantier: null, soldeDu: false, enCoursCreation: false, avenantASigner: true }), { pastille: "A_VOUS", prochaine: "Un nouveau devis à signer" });
    assert.deepEqual(projets.pastilleDuProjet({ etape: "ACOMPTE", etapeDossier: "SIGNE", dateChantier: null, soldeDu: false, enCoursCreation: false }), { pastille: "A_VOUS", prochaine: "Acompte à régler" });
  });

  test("avenant émis après la signature : l'espace le propose (devis à signer, prochaine étape, onglet Devis) ; le devis signé reste « le devis » ; l'étape ne bouge pas", async () => {
    const c = await signeAvecAvenant("Ambroise");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["SIGNE", "SIGNE", "ACOMPTE", [c.avenant.numero]]);
    assert.equal(etat.prochaineAction, "Appeler le client : fixer la date du chantier, suivre l'acompte", "l'avenant ne couvre pas la date du chantier");
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, [], "pas de relance sur un dossier signé");

    const vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(vue.devis?.id, c.origine.id, "le devis signé d'origine");
    assert.ok(vue.devis?.accepte);
    assert.deepEqual(vue.devisASigner.map((d) => [d.id, d.accepte]), [[c.avenant.id, null]]);
    assert.deepEqual(vue.devisProposes.map((d) => [d.id, Boolean(d.accepte)]), [[c.origine.id, true], [c.avenant.id, false]]);
    assert.deepEqual(vue.prochainPas, { phrase: `Un nouveau devis vous est proposé : ${(400).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 })}. Votre devis signé reste valable.`, bouton: "Voir le nouveau devis", vue: "devis" });
    const onglet = vue.etapes.find((e) => e.cle === "DEVIS")!;
    assert.deepEqual([onglet.fait, onglet.courante, onglet.verrouillee], [false, true, false]);
    assert.equal(vue.paiement?.devisNumero, c.origine.numero, "le paiement porte sur le devis d'origine");
    assert.equal(vue.acompte?.montant, vue.devis?.acompte);
  });

  test("le client signe l'avenant : accord à côté de l'origine, étape inchangée, main à moi, prochaine action gardée ; une nouvelle tentative est sans effet", async () => {
    const c = await signeAvecAvenant("Berenice");
    const etapesAvant = await passages(c.dossierId);
    const resultat = await service.accepterDevis(await espaceDe(c.espaceId), { documentId: c.avenant.id, nom: c.nom, accepte: true }, ORIGINE);
    assert.deepEqual(resultat, { dejaAccepte: false });
    assert.deepEqual([await statutDe(c.origine.id), await statutDe(c.avenant.id)], ["ACCEPTE", "ACCEPTE"]);
    assert.deepEqual((await accordsActifs(c.dossierId)).map((a) => a.documentId), [c.origine.id, c.avenant.id], "l'accord d'origine n'est pas touché");
    assert.equal(await passages(c.dossierId), etapesAvant, "aucun changement d'étape");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["SIGNE", "SIGNE", "ACOMPTE", []]);
    assert.deepEqual([etat.main, etat.mainMotif], ["MOI", `Il a signé l'avenant ${c.avenant.numero} : le prévoir au chantier`]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.equal(etat.prochaineAction, "Appeler le client : fixer la date du chantier, suivre l'acompte");
    assert.deepEqual(etat.relances.proposables, []);
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_DEVIS_ACCEPTE" }, orderBy: { createdAt: "desc" } });
    assert.match(evenement.contenu, new RegExp(`sur le devis ${c.avenant.numero} .*avenant au devis signé ${c.origine.numero}`));

    const vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(vue.devis?.id, c.origine.id);
    assert.deepEqual(vue.devisASigner, []);
    const signe = vue.devisProposes.find((d) => d.id === c.avenant.id)!;
    assert.deepEqual([signe.accepte?.source, signe.accepte?.retirable], ["ESPACE", true], "il relit son avenant signé, retirable avant le chantier");
    assert.equal(vue.etapes.find((e) => e.cle === "DEVIS")?.fait, true);
    assert.equal(vue.prochainPas.vue, "paiement", "l'acompte d'origine redevient la prochaine étape");

    assert.deepEqual(await service.accepterDevis(await espaceDe(c.espaceId), { documentId: c.avenant.id, nom: c.nom, accepte: true }, ORIGINE), { dejaAccepte: true });
    assert.equal((await accordsActifs(c.dossierId)).length, 2, "un seul accord par devis");
  });

  test("retrait ciblé de l'accord de l'avenant : le dossier reste signé, l'avenant redevient à signer ; sans devis nommé, c'est l'accord d'origine (retour en « Devis envoyé », comme avant)", async () => {
    const c = await signeAvecAvenant("Cyprien");
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: c.avenant.id, nom: c.nom, accepte: true }, ORIGINE);
    assert.deepEqual(await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "je réfléchis", c.avenant.id), { retire: true });
    assert.deepEqual([await statutDe(c.origine.id), await statutDe(c.avenant.id)], ["ACCEPTE", "ENVOYE"]);
    assert.deepEqual((await accordsActifs(c.dossierId)).map((a) => a.documentId), [c.origine.id]);
    let etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["SIGNE", "SIGNE", "ACOMPTE", [c.avenant.numero]]);
    assert.equal(etat.prochaineAction, "Appeler le client : fixer la date du chantier, suivre l'acompte", "la date du chantier reste à fixer");
    assert.deepEqual([etat.main, etat.mainMotif], ["MOI", "Il a retiré son bon pour accord : l'appeler"]);
    assert.equal(etat.main, etat.mainCalculee);
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ESPACE_ACCORD_RETIRE" }, orderBy: { createdAt: "desc" } });
    assert.match(trace.contenu, /avenant .* retiré par le client : « je réfléchis »\. Le devis signé d'origine tient toujours/);
    assert.deepEqual(await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "", c.avenant.id), { retire: false }, "plus d'accord sur ce devis");

    // Sans devis nommé (ancien site, geste de Lucas) : l'accord d'origine, le dossier revient en « Devis envoyé ».
    await avecActeur(LUCAS, async () => validations.retirerAccord(await espaceDe(c.espaceId), "LUCAS", "erreur"));
    etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.etapeEspace], ["DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual(await accordsActifs(c.dossierId), []);
    assert.deepEqual(etat.devisASigner, [c.origine.numero, c.avenant.numero], "les deux devis redeviennent à signer");
    assert.equal(etat.main, etat.mainCalculee);
  });

  test("le chantier a commencé : le client ne retire plus l'accord de l'avenant (un appel) ; Lucas le peut, sans recul d'étape", async () => {
    const c = await signeAvecAvenant("Delphine");
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: c.avenant.id, nom: c.nom, accepte: true }, ORIGINE);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "CHANTIER" } });
    const vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(vue.devisProposes.find((d) => d.id === c.avenant.id)?.accepte?.retirable, false);
    await assert.rejects(validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "", c.avenant.id), /Le chantier a commencé/);
    await avecActeur(LUCAS, async () => validations.retirerAccord(await espaceDe(c.espaceId), "LUCAS", "erreur de saisie", c.avenant.id));
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.devisASigner], ["CHANTIER", [c.avenant.numero]]);
    assert.deepEqual((await accordsActifs(c.dossierId)).map((a) => a.documentId), [c.origine.id]);
  });

  test("une prochaine action posée à la main est gardée : la tâche « Avenant signé » est rangée à côté ; deux avenants proposés : il en signe un, l'autre n'est pas retenu", async () => {
    const c = await signeAvecAvenant("Edouard");
    const { document: autre } = await generer(c.dossierId, "Avenant : plan de travail", 60);
    let vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(vue.devisASigner.map((d) => d.id), [c.avenant.id, autre.id]);
    assert.equal(vue.prochainPas.phrase, "2 nouveaux devis vous sont proposés : choisissez celui qui vous convient.");
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Commander les adhésifs" }));

    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: autre.id, nom: c.nom, accepte: true }, ORIGINE);
    assert.deepEqual([await statutDe(c.origine.id), await statutDe(c.avenant.id), await statutDe(autre.id)], ["ACCEPTE", "NON_RETENU", "ACCEPTE"]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.prochaineAction, etat.actionManuelle, etat.devisASigner], ["SIGNE", "Commander les adhésifs", "Commander les adhésifs", []]);
    const tache = etat.taches.find((t) => t.cle === `MANUELLE:synchro:${c.dossierId}:avenant-signe`);
    assert.ok(tache, "la tâche rangée à la place");
    assert.equal(tache.titre, `Avenant signé (devis ${autre.numero}) : le prévoir au chantier et sur la facture · ${c.nom}`);
    assert.equal(etat.main, etat.mainCalculee);

    // Retiré : l'avenant écarté par CET accord redevient au choix, l'origine reste signée.
    await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "", autre.id);
    assert.deepEqual([await statutDe(c.origine.id), await statutDe(c.avenant.id), await statutDe(autre.id)], ["ACCEPTE", "ENVOYE", "ENVOYE"]);
    vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual(vue.devisASigner.map((d) => d.id), [c.avenant.id, autre.id]);
  });

  test("prochaine étape calculée par le CRM : les cas d'avant à l'identique (devis à signer, plusieurs devis, chantier daté)", () => {
    const base = { mots: { nom: "cuisine", votre: "votre cuisine", de: "de votre cuisine" }, familles: ["CUISINE" as const], famillesSuggerees: [], simulations: [], creation: { enCours: [] } as never, monProjet: null, projetValide: null, photos: [], devisProposes: [], devisASigner: [], chantier: null, apres: null, devis: null };
    assert.equal(pas.prochainPas({ ...base, etape: "PHOTOS" }).phrase, "Envoyez-nous quelques photos de votre cuisine : c'est la première étape.");
    const devis = { total: 1250.5, accepte: null } as never;
    assert.deepEqual(pas.prochainPas({ ...base, etape: "DEVIS", devis, devisProposes: [devis] }), { phrase: `Votre devis est prêt : ${(1250.5).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`, bouton: "Voir mon devis", vue: "devis" });
    assert.equal(pas.prochainPas({ ...base, etape: "DEVIS", devis, devisProposes: [devis, devis] }).phrase, "2 devis vous sont proposés : choisissez celui qui vous convient.");
    assert.equal(pas.prochainPas({ ...base, etape: "CHANTIER", chantier: { date: "2026-10-12T22:30:00.000Z" } }).phrase, "Rendez-vous le 13 octobre : tout est prêt.", "à l'heure de Paris");
    assert.equal(pas.prochainPas({ ...base, etape: "ACOMPTE", devis: { total: 100, accepte: { le: "", nom: "", source: "ESPACE", retirable: false } } as never }).vue, "paiement");
  });
});
