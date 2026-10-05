import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-relecture-partie-b-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 — corrections de la relecture des lots B7 à B13 (docs/REPRISE-LOCAL.md) : l'accord d'un avenant retiré seul
 * par Lucas (écran et outil, l'aperçu annonce l'accord que le geste retire), le retrait de l'accord d'origine en une
 * transaction, le paiement de l'espace après un avenant (le total, puis le reste des factures : ce que Stripe débiterait),
 * rien à signer sur un projet figé, une ancienne variante qui ne se signe plus après la signature, les montants des tâches
 * avec un avenant, la révocation du lien d'un espace dont tous les projets sont perdus. Chaque cas : le déclencheur,
 * puis l'état DES DEUX CÔTÉS (`etatDesDeuxCotes` + ce que reçoit le site). Rien ne sort du poste : réseau coupé.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("./service");
let validations: typeof import("./validations");
let vueCrm: typeof import("./vue-crm");
let compte: typeof import("./compte");
let revocation: typeof import("./revocation");
let documents: typeof import("@/lib/dossiers/documents");
let transitions: typeof import("@/lib/dossiers/transitions");
let encaissements: typeof import("@/lib/encaissements/service");
let carte: typeof import("@/lib/paiement/carte");
let montantSigne: typeof import("@/lib/dossiers/montant-signe");
let detecteurDossiers: typeof import("@/lib/a-faire/detecteurs/dossiers");
let execution: typeof import("@/lib/assistant/execution");
let gestes: typeof import("@/lib/assistant/outils/gestes");
let session: import("@/lib/assistant/execution").Session;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;
let aujourdhui: string;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const ORIGINE = { ip: null, navigateur: null };
const FIXER_LA_DATE = "Appeler le client : fixer la date du chantier, suivre l'acompte";
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré et annoncé (« Devis disponible » : espace ouvert, adresse valide). */
const generer = (dossierId: string, objet: string, prix = 150) =>
  avecActeur(LUCAS, async () => (await documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif", 10, prix)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: true }))).document);
const facturer = (dossierId: string, lignes: ReturnType<typeof ligne>[]) =>
  avecActeur(LUCAS, async () => (await documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "FACTURE", objet: "Recouvrement cuisine", lignes, noteMl: true, acomptePct: null, remplaceDocumentId: null }))).document);
const payer = (dossierId: string, montant: number) => avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId, paiement: { montant, moyen: "VIREMENT", recuLe: aujourdhui, reference: null } }));

async function contact(prenom: string) {
  const email = `${prenom.toLowerCase()}.relecture@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3365${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Pérols", codePostal: "34470", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, permanent: ouvert.permanent, nom: `${prenom} Essai` };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id }, select: { statut: true } })).statut;
const accordsActifs = async (dossierId: string) => (await prisma.accordDevis.findMany({ where: { dossierId, retireLe: null }, orderBy: { createdAt: "asc" }, select: { documentId: true } })).map((a) => a.documentId);
const signer = async (c: { espaceId: string; nom: string }, documentId: string) => service.accepterDevis(await espaceDe(c.espaceId), { documentId, nom: c.nom, accepte: true }, ORIGINE);

/** Signé sur le devis d'origine (1 500 €, acompte 30 %), puis un avenant (400 €) émis et annoncé — signé si demandé. */
async function signeAvecAvenant(prenom: string, options: { avenantSigne?: boolean } = {}) {
  const c = await contact(prenom);
  await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
  const origine = await generer(c.dossierId, "Cuisine", 150);
  await signer(c, origine.id);
  const avenant = await generer(c.dossierId, "Avenant : crédence", 40);
  if (options.avenantSigne) await signer(c, avenant.id);
  return { ...c, origine, avenant };
}

const executer = (entree: Record<string, unknown>) => execution.executerOutil(gestes.outilGesteEspace as never, entree, session, new Date());

/** Panne simulée dans la transaction : l'écriture du changement d'étape de CE dossier échoue. */
const PANNE = "panne_relecture_b";
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
  validations = await import("./validations");
  vueCrm = await import("./vue-crm");
  compte = await import("./compte");
  revocation = await import("./revocation");
  documents = await import("@/lib/dossiers/documents");
  transitions = await import("@/lib/dossiers/transitions");
  encaissements = await import("@/lib/encaissements/service");
  carte = await import("@/lib/paiement/carte");
  montantSigne = await import("@/lib/dossiers/montant-signe");
  detecteurDossiers = await import("@/lib/a-faire/detecteurs/dossiers");
  execution = await import("@/lib/assistant/execution");
  gestes = await import("@/lib/assistant/outils/gestes");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  aujourdhui = (await import("@/lib/dossiers/dates")).jourParis(new Date());
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  await reparer();
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("l'accord d'un avenant, retiré seul par Lucas (B7, relecture)", () => {
  test("outil geste_espace : l'aperçu annonce l'accord que le geste retire (l'origine sans devis nommé, l'avenant avec document_id) ; retiré, le dossier reste signé", async () => {
    const c = await signeAvecAvenant("Gaspard", { avenantSigne: true });
    assert.deepEqual(await accordsActifs(c.dossierId), [c.origine.id, c.avenant.id]);

    // Sans devis nommé : l'accord du devis signé d'origine (avant : l'aperçu parlait de l'avenant, le plus récent).
    const sansDevis = await executer({ geste: "RETIRER_ACCORD", dossierId: c.dossierId });
    assert.ok(sansDevis.confirmation?.jeton, sansDevis.texte);
    assert.match(sansDevis.texte, new RegExp(`sur le devis ${c.origine.numero} .*le dossier revient à « Devis envoyé »`));

    // Avec le devis de l'avenant : son accord seul.
    const entree = { geste: "RETIRER_ACCORD", dossierId: c.dossierId, document_id: c.avenant.id, motif: "erreur de saisie" };
    const apercu = await executer(entree);
    assert.match(apercu.texte, new RegExp(`sur l'avenant ${c.avenant.numero} .*le devis signé d'origine tient toujours, le dossier ne change pas d'étape`));
    const fait = await executer({ ...entree, confirmation: apercu.confirmation!.jeton });
    assert.ok(!fait.confirmation, fait.texte);
    assert.match(fait.texte, new RegExp(`sur l'avenant ${c.avenant.numero} : preuve gardée, le devis signé d'origine tient toujours`));

    assert.deepEqual(await accordsActifs(c.dossierId), [c.origine.id], "l'accord d'origine n'est pas touché");
    assert.deepEqual([await statutDe(c.origine.id), await statutDe(c.avenant.id)], ["ACCEPTE", "ENVOYE"]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["SIGNE", "SIGNE", "ACOMPTE", [c.avenant.numero]]);
    assert.equal(etat.prochaineAction, FIXER_LA_DATE, "la date du chantier reste à fixer");
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, []);
  });

  test("l'écran (vue CRM) : chaque avenant signé a son bouton ; en Chantier, Lucas retire l'accord de l'avenant, l'étape ne bouge pas", async () => {
    const c = await signeAvecAvenant("Hortense", { avenantSigne: true });
    let vue = await vueCrm.vueEspaceCrm(c.dossierId);
    assert.deepEqual(
      vue?.devisProposes.map((d) => [d.id, d.avenant, d.accordEnCours]),
      [
        [c.origine.id, false, true],
        [c.avenant.id, true, true],
      ]
    );
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "CHANTIER" } });
    // Le client ne le peut plus (un appel) ; Lucas, depuis l'écran : le geste porte le devis.
    await assert.rejects(validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "", c.avenant.id), /Le chantier a commencé/);
    await avecActeur(LUCAS, () => vueCrm.gesteDeLucas(c.dossierId, vueCrm.schemaGesteEspace.parse({ geste: "retirer-accord", motif: "", documentId: c.avenant.id })));
    assert.deepEqual(await accordsActifs(c.dossierId), [c.origine.id], "avant : le geste retirait l'accord d'ORIGINE");
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace, etat.devisASigner], ["CHANTIER", "SIGNE", "CHANTIER", [c.avenant.numero]]);
    assert.equal(etat.main, etat.mainCalculee);
    vue = await vueCrm.vueEspaceCrm(c.dossierId);
    assert.deepEqual(vue?.devisProposes.map((d) => d.accordEnCours), [true, false]);
  });
});

describe("retrait de l'accord d'origine en une transaction (relecture)", () => {
  test("panne au milieu : rien d'écrit (accord, événement, étape) ; la nouvelle tentative retire et ramène en « Devis envoyé » d'un bloc ; rejouée, sans effet", async () => {
    const c = await contact("Ivan");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
    const devis = await generer(c.dossierId, "Cuisine", 150);
    const variante = await generer(c.dossierId, "Cuisine, variante", 120);
    await signer(c, devis.id);
    assert.deepEqual([await statutDe(devis.id), await statutDe(variante.id)], ["ACCEPTE", "NON_RETENU"]);
    const evenements = (type: string) => prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type } });
    const [passagesAvant, retraitsAvant] = [await evenements("CHANGEMENT_ETAPE"), await evenements("ESPACE_ACCORD_RETIRE")];

    await provoquerPanne(c.dossierId);
    try {
      await assert.rejects(validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "je réfléchis"), /panne simulée|Enregistrement impossible/);
    } finally {
      await reparer();
    }
    // Avant : l'accord était retiré et l'événement écrit, le dossier restait « Signé » sans accord en ligne.
    assert.deepEqual(await accordsActifs(c.dossierId), [devis.id], "l'accord tient toujours");
    assert.deepEqual([await evenements("ESPACE_ACCORD_RETIRE"), await evenements("CHANGEMENT_ETAPE")], [retraitsAvant, passagesAvant]);
    assert.deepEqual([await statutDe(devis.id), await statutDe(variante.id)], ["ACCEPTE", "NON_RETENU"]);
    const apresPanne = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([apresPanne.etape, apresPanne.statutLead, apresPanne.etapeEspace, apresPanne.prochaineAction], ["SIGNE", "SIGNE", "ACOMPTE", FIXER_LA_DATE]);

    assert.deepEqual(await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "je réfléchis"), { retire: true });
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "DEVIS_ENVOYE", "DEVIS"]);
    assert.deepEqual([etat.prochaineAction, etat.main, etat.mainMotif], ["Appeler : il a retiré son bon pour accord", "MOI", "Il a retiré son bon pour accord : l'appeler"]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.devisASigner, [devis.numero, variante.numero], "le devis redevient émis, la variante au choix");
    assert.deepEqual([await statutDe(devis.id), await statutDe(variante.id)], ["GENERE", "ENVOYE"]);
    assert.deepEqual(await accordsActifs(c.dossierId), []);
    assert.equal(await evenements("CHANGEMENT_ETAPE"), passagesAvant + 1);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    assert.equal(passage.contenu, "Signé → Devis envoyé : bon pour accord retiré par le client (retour en arrière)");

    assert.deepEqual(await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", ""), { retire: false }, "rejouée : plus d'accord en cours");
    assert.equal(await evenements("ESPACE_ACCORD_RETIRE"), retraitsAvant + 1);
  });
});

describe("le paiement de l'espace après un avenant (B7, B10, relecture)", () => {
  test("l'avenant s'ajoute au total ; le devis d'origine payé n'est pas « Réglé » ; facturé, le solde est le reste des factures, celui que la carte débite et que « Mes documents » affiche", async () => {
    const c = await signeAvecAvenant("Jacinthe", { avenantSigne: true });
    const paiement = async () => (await service.etatEspace(await espaceDe(c.espaceId))).paiement!;
    let p = await paiement();
    assert.deepEqual([p.devisNumero, p.total, p.acompte?.montant, p.solde.montant, p.regle], [c.origine.numero, 1900, 450, 1450, false], "l'acompte reste celui du devis d'origine ; l'avenant est payé avec le solde");
    assert.equal((await carte.aReglerParCarte(await espaceDe(c.espaceId)))?.centimes, 45_000, "la carte : l'acompte d'origine");

    await payer(c.dossierId, 450);
    await payer(c.dossierId, 1050);
    p = await paiement();
    assert.deepEqual([p.recu, p.reste, p.regle, p.solde.statut], [1500, 400, false, "PARTIEL"], "avant : « Réglé, merci » (le devis d'origine seul était payé)");
    const signe = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([signe.etape, signe.etapeEspace], ["SIGNE", "CHANTIER"]);
    assert.equal(signe.main, signe.mainCalculee);

    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "PLANIFIE", dateChantier: aujourdhui }));
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "CHANTIER" }));
    const facture = await facturer(c.dossierId, [ligne("Façades", 10, 150), ligne("Crédence", 10, 40)]);
    const mesDocuments = async () => (await compte.documentsDuClient(c.permanent)).find((x) => x.id === facture.id)?.statut;
    assert.equal(await mesDocuments(), "Reste 400,00 €");
    p = await paiement();
    const reglement = await carte.aReglerParCarte(await espaceDe(c.espaceId));
    assert.deepEqual([reglement?.nature, reglement?.centimes], ["SOLDE", 40_000]);
    assert.deepEqual([p.regle, p.reste, Math.round((p.solde.montant - p.solde.recu) * 100)], [false, 400, reglement?.centimes], "l'onglet Paiement affiche ce que la carte débitera (EtapePaiement.tsx : solde.montant − solde.recu)");
    const facturee = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([facturee.etape, facturee.etapeEspace], ["FACTURE", "TERMINE"]);
    // La vue de Lucas lit la même chose.
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))?.paiement?.reste, 400);

    await payer(c.dossierId, 400);
    p = await paiement();
    assert.deepEqual([p.regle, p.reste], [true, 0]);
    assert.equal(await carte.aReglerParCarte(await espaceDe(c.espaceId)), null);
    assert.equal(await mesDocuments(), "Réglée");
    const encaisse = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([encaisse.etape, encaisse.etapeEspace, encaisse.statutLead], ["ENCAISSE", "TERMINE", "TERMINE"]);
    assert.equal(encaisse.main, encaisse.mainCalculee);
    assert.equal(encaisse.taches.some((t) => t.type === "ENCAISSER"), false);
  });

  test("les tâches et les montants lisent le devis d'origine : « Encaisser l'acompte » de l'origine (pas de l'avenant), montant signé = origine + avenant", async () => {
    const c = await signeAvecAvenant("Kilian", { avenantSigne: true });
    await etatDesDeuxCotes(c.dossierId);
    const tache = await prisma.tacheAFaire.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "ENCAISSER", statut: "A_FAIRE" } });
    assert.equal(tache.montant, 450, "avant : 120, l'acompte de l'avenant (le plus récent accepté)");
    assert.match(tache.titre, /^Encaisser l'acompte/);
    const accordOrigine = await prisma.accordDevis.findFirstOrThrow({ where: { documentId: c.origine.id } });
    assert.equal(tache.raison, `accord du ${(await import("@/lib/a-faire/achevement")).jourMois(accordOrigine.createdAt)}`, "la date de l'accord d'origine");

    // Règles pures, quel que soit l'ordre des listes.
    const jour = (n: number) => new Date(Date.UTC(2026, 9, n));
    const lignes = JSON.stringify([ligne("x", 10, 150)]);
    const origine = { id: "o", createdAt: jour(1), statut: "ACCEPTE", totalHt: 1500, acomptePct: 30, lignes, visibleEspace: true };
    const avenant = { id: "a", createdAt: jour(5), statut: "ACCEPTE", totalHt: 400, acomptePct: 30, lignes: JSON.stringify([ligne("y", 10, 40)]), visibleEspace: true };
    const accords = [
      { documentId: "a", createdAt: jour(5), totalHt: 400, acomptePct: 30 },
      { documentId: "o", createdAt: jour(1), totalHt: 1500, acomptePct: 30 },
    ];
    for (const liste of [[origine, avenant], [avenant, origine]]) {
      assert.equal(detecteurDossiers.acompteAttendu({ documents: liste, accords }), 450);
      assert.equal(detecteurDossiers.montantEnJeu({ documents: liste, accords, montantEstime: null }), 1900);
      assert.equal(montantSigne.devisSigneDOrigine(liste)?.id, "o");
      assert.equal(montantSigne.accordDOrigine(liste, accords)?.documentId, "o");
    }
    assert.equal(montantSigne.montantSigneHt([], accords), 1900, "signés hors CRM : les accords");
    assert.equal(montantSigne.montantSigneHt([{ id: "o", statut: "ACCEPTE", totalHt: 1500 }], [{ documentId: "a", totalHt: 400 }]), 1900, "origine signée sur papier, avenant en ligne");
    assert.equal(montantSigne.montantSigneHt([{ id: "o", statut: "ENVOYE", totalHt: 1500 }], []), null);
  });
});

describe("rien à signer sur un projet figé ; une ancienne variante ne se signe plus après la signature (relecture)", () => {
  test("un avenant resté « Envoyé » sur un dossier encaissé ou perdu : ni « à signer », ni « Un nouveau devis vous est proposé »", async () => {
    const c = await signeAvecAvenant("Leandre");
    assert.deepEqual((await etatDesDeuxCotes(c.dossierId, { taches: false })).devisASigner, [c.avenant.numero]);
    for (const etape of ["ENCAISSE", "PERDU"]) {
      await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape } });
      const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
      assert.deepEqual(etat.devisASigner, [], `${etape} : avant, l'avenant restait « à signer » et le bouton échouait en 409`);
      const vue = await service.etatEspace(await espaceDe(c.espaceId));
      assert.deepEqual(vue.devisASigner, []);
      assert.doesNotMatch(vue.prochainPas.phrase, /nouveau devis/i);
      assert.notEqual(vue.etapes.find((e) => e.courante)?.cle, "DEVIS");
      await assert.rejects(signer(c, c.avenant.id), (erreur: Error & { statut?: number }) => /plus|terminé|réalisé/i.test(erreur.message));
    }
  });

  test("une variante créée AVANT le devis signé, restée « Généré » (données d'avant B10) : 409, le devis signé reste « le devis »", async () => {
    const c = await contact("Mathis");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
    const variante = await generer(c.dossierId, "Cuisine, variante", 120);
    const devis = await generer(c.dossierId, "Cuisine", 150);
    await signer(c, devis.id);
    // Avant B10, la variante n'était pas passée « non retenu » à la signature.
    await prisma.document.update({ where: { id: variante.id }, data: { statut: "GENERE" } });
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual(avant.devisASigner, [], "elle n'est pas proposée (pas un avenant)");

    await assert.rejects(signer(c, variante.id), /n'est plus en vigueur/);
    assert.deepEqual([await statutDe(devis.id), await statutDe(variante.id)], ["ACCEPTE", "GENERE"]);
    assert.deepEqual(await accordsActifs(c.dossierId), [devis.id]);
    const vue = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(vue.devis?.id, devis.id, "avant : la variante devenait « le devis » (acompte, virement)");
    assert.equal(vue.virement?.reference ?? `Devis ${devis.numero}`, `Devis ${devis.numero}`);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.etapeEspace, etat.prochaineAction], [avant.etape, avant.etapeEspace, avant.prochaineAction]);
    // Le devis signé lui-même, rejoué : toujours sans effet.
    assert.deepEqual(await signer(c, devis.id), { dejaAccepte: true });
  });
});

describe("le lien d'un espace dont tous les projets sont perdus (écart 13, relecture)", () => {
  test("perdu aujourd'hui : le lien reste ; 90 jours après la perte, la révocation automatique le désactive (motif propre) ; un projet vivant le garde", async () => {
    const seul = await contact("Noe");
    await avecActeur(LUCAS, () => transitions.changerEtape(seul.dossierId, { vers: "PERDU", motifPerte: "PRIX" }));
    const candidats = () => revocation.espacesARevoquer(new Date()).then((liste) => liste.map((x) => x.permanentId));
    assert.ok(!(await candidats()).includes(seul.permanent.id), "perdu aujourd'hui : rien");
    const perdu = await etatDesDeuxCotes(seul.dossierId);
    assert.deepEqual([perdu.etape, perdu.statutLead], ["PERDU", "PERDU"]);
    assert.equal(perdu.taches.some((t) => t.type === "COHERENCE"), false, "passer en « Perdu » ne crée pas de tâche « Corriger »");

    await prisma.dossier.update({ where: { id: seul.dossierId }, data: { perteLe: new Date(Date.now() - 91 * 86_400_000) } });
    assert.deepEqual(revocation.dernierProjetClosLe([{ etape: "PERDU", archiveLe: null, perteLe: new Date(0), updatedAt: new Date() }, { etape: "SIGNE", archiveLe: null, perteLe: null, updatedAt: new Date() }]), null, "un projet vivant : pas clos");
    assert.ok((await candidats()).includes(seul.permanent.id));
    const bilan = await revocation.revoquerEspacesTermines(new Date());
    assert.ok(bilan.revoques.some((r) => r.permanentId === seul.permanent.id));
    const lien = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: seul.permanent.id } });
    assert.ok(lien.revoqueLe, "lien désactivé (rien n'est effacé : un nouveau lien le rouvre)");
    const trace = await prisma.dossierEvenement.findFirst({ where: { dossierId: seul.dossierId, type: "ESPACE_LIEN_DESACTIVE" }, orderBy: { createdAt: "desc" } });
    assert.match(trace?.contenu ?? "", /clôture du dernier projet/);
  });
});
