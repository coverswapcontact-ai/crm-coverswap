import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-a-faire-systeme-"));

/**
 * Mission 17 (partie A, lot 2) — les détecteurs SYSTEME, COHERENCE et MANUELLE, et la notification du matin : chaque
 * tâche système détectée puis cochée par le CRM quand sa cause disparaît (avec sa preuve), une incohérence → une tâche
 * (le contrôle gardé une heure, invalidé par la correction), une tâche à moi cochée par sa condition, une seule
 * notification du matin par jour. Instants fixes injectés ; aucun réseau ; noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let detection: typeof import("../detection");
let reponses: typeof import("../reponses");
let achevement: typeof import("../achevement");
let systeme: typeof import("./systeme");
let coherence: typeof import("./coherence");
let manuelles: typeof import("./manuelles");
let matin: typeof import("../matin");
let parametres: typeof import("@/lib/parametres/service");
let controle: typeof import("@/lib/coherence/controle");
let file: typeof import("@/lib/taches/file");
let google: typeof import("@/lib/google/connexion");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
/** Mercredi 30/09/2026, 10 h à Paris (heure d'été). */
const MERCREDI = new Date("2026-09-30T08:00:00.000Z");
const MIN = 60_000;
const H = 3_600_000;
const J = 86_400_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const fetchOriginal = globalThis.fetch;
const requetes: string[] = [];

let numero = 0;
const unique = () => `${Date.now().toString(36)}${++numero}`;

const tache = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });
const raccourciDe = async (cle: string) => JSON.parse((await tache(cle)).raccourci) as Record<string, unknown>;

/** Un passage d'une seule source, avec son seul détecteur (les autres détecteurs sont écrits en parallèle). */
async function passe(source: "SYSTEME" | "COHERENCE" | "MANUELLE", maintenant = MERCREDI) {
  const detecteur = source === "SYSTEME" ? systeme.detecteurSysteme : source === "COHERENCE" ? coherence.detecteurCoherence : manuelles.detecteurManuelles;
  const bilan = await detection.passeComplete(maintenant, { sources: [source], detecteurs: [detecteur] });
  assert.ok(bilan.sources.every((s) => s.couverte), `source couverte : ${JSON.stringify(bilan.sources)}`);
  return bilan;
}

function unMail(de: string, objet: string, recuLe: Date, donnees: Record<string, unknown> = {}) {
  const id = unique();
  return prisma.message.create({ data: { canal: "EMAIL", compte: "crm", identifiantCanal: `essai-${id}`, filCanal: `fil-${id}`, sens: "ENTRANT", de, objet, recuLe, ...donnees } });
}

function uneTacheDeFond(type: string, donnees: Record<string, unknown>) {
  return prisma.tache.create({ data: { type, cle: `essai:${type}:${unique()}`, demandeePar: "SCRIPT:essai", ...donnees } });
}

async function unDossier(nom: string, donnees: Record<string, unknown> = {}) {
  return prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000000", objet: "Cuisine", source: "ENTRANT", ...donnees } });
}

function unLead(prenom: string) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${String(200000 + numero++).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS" } });
}

/** « coché par le CRM » : faite, par le CRM, avec sa preuve. */
async function cocheeParLeCrm(cle: string, preuve: string | RegExp) {
  const ligne = await tache(cle);
  assert.equal(ligne.statut, "FAITE", `${cle} cochée`);
  assert.equal(ligne.reponduPar, "SYSTEME:taches-a-faire");
  if (typeof preuve === "string") assert.equal(ligne.reponseTexte, `${achevement.PREFIXE_COCHE}${preuve}`);
  else assert.match(ligne.reponseTexte ?? "", preuve);
}

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    requetes.push(String(url));
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  detection = await import("../detection");
  reponses = await import("../reponses");
  achevement = await import("../achevement");
  systeme = await import("./systeme");
  coherence = await import("./coherence");
  manuelles = await import("./manuelles");
  matin = await import("../matin");
  parametres = await import("@/lib/parametres/service");
  controle = await import("@/lib/coherence/controle");
  file = await import("@/lib/taches/file");
  google = await import("@/lib/google/connexion");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(requetes, [], "aucune requête réseau");
  await prisma.$disconnect();
});

describe("détecteur SYSTEME : chaque tâche détectée, puis cochée par le CRM quand sa cause disparaît", () => {
  test("paiement Railway refusé (mails rangés d'office) → « Régler le paiement · Railway », niveau 4 ; un reçu plus récent la coche", async () => {
    // Railway est rangé d'office (bruit) : le détecteur lit quand même ces mails.
    await unMail("notify@railway.app", "Payment unsuccessful for your Railway subscription", plus(MERCREDI, -5 * J), { classe: "BRUIT", rangeLe: plus(MERCREDI, -5 * J), traiteLe: plus(MERCREDI, -5 * J), lu: true });
    await unMail("notify@railway.app", "Action required: your payment failed", plus(MERCREDI, -2 * J), { classe: "BRUIT", rangeLe: plus(MERCREDI, -2 * J) });
    await unMail("notify@railway.app", "Weekly usage report", plus(MERCREDI, -1 * J));
    await unMail("notify@railway.app", "Payment failed (old)", plus(MERCREDI, -45 * J));
    await passe("SYSTEME");
    const cle = "SYSTEME:paiement-railway";
    const ligne = await tache(cle);
    assert.equal(ligne.statut, "A_FAIRE");
    assert.equal(ligne.type, "SYSTEME");
    assert.equal(ligne.sujetType, "SYSTEME");
    assert.equal(ligne.sujetId, null);
    assert.equal(ligne.niveau, 4);
    assert.equal(ligne.titre, "Régler le paiement · Railway");
    assert.equal(ligne.raison, "2 échecs depuis le 25/09", "le mail de plus de 30 jours ne compte pas");
    assert.equal(ligne.depuis.getTime(), plus(MERCREDI, -5 * J).getTime());
    assert.deepEqual(await raccourciDe(cle), {
      genre: "PAGE",
      libelle: "Ouvrir la facturation Railway",
      href: "https://railway.com/account/billing",
      externe: true,
      marche: "Mettre à jour la carte sur la page de facturation Railway, puis régler la facture en attente (sinon le CRM s'arrête).",
    });
    // Un passage identique n'écrit rien.
    const second = await passe("SYSTEME");
    assert.equal(second.reconciliation.crees + second.reconciliation.cochees + second.reconciliation.rouvertes, 0);
    // Le reçu arrive : la tâche est cochée, avec sa preuve.
    await unMail("invoice+statements@railway.app", "Your receipt from Railway Corporation", plus(MERCREDI, -1 * H), { classe: "BRUIT", rangeLe: MERCREDI });
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, "paiement Railway reçu le 30/09");
  });

  test("paiement Stripe refusé, en français → « Régler le paiement · Stripe » (lien externe Stripe) ; Railway facturé par Stripe reste Railway", async () => {
    await unMail("failed-payments@stripe.com", "Échec de paiement de votre facture", plus(MERCREDI, -3 * J), { deNom: "Stripe", classe: "ADMINISTRATIF" });
    await unMail("notifications@stripe.com", "Votre reçu", plus(MERCREDI, -20 * J), { deNom: "Stripe" });
    await passe("SYSTEME");
    const ligne = await tache("SYSTEME:paiement-stripe");
    assert.equal(ligne.statut, "A_FAIRE");
    assert.equal(ligne.raison, "1 échec depuis le 27/09");
    assert.equal((await raccourciDe("SYSTEME:paiement-stripe")).href, "https://dashboard.stripe.com/settings/billing");
    // Railway facturé par Stripe : un refus rouvre la tâche Railway, pas une seconde tâche Stripe.
    await unMail("invoice@stripe.com", "Payment declined", plus(MERCREDI, -30 * MIN), { deNom: "Railway Corporation" });
    await passe("SYSTEME");
    assert.equal((await tache("SYSTEME:paiement-railway")).statut, "A_FAIRE", "rouverte : la condition est revenue");
    assert.equal((await tache("SYSTEME:paiement-railway")).raison, "1 échec depuis le 30/09");
    assert.equal((await tache("SYSTEME:paiement-stripe")).raison, "1 échec depuis le 27/09");
    // Les motifs, pur : anglais et français.
    const echoue = (t: string) => systeme.MOTIF_PAIEMENT_ECHOUE.test(t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    assert.deepEqual(["Your card was declined", "Invoice past due", "Paiement refusé", "Facture impayée", "Your receipt"].map(echoue), [true, true, true, true, false]);
  });

  test("numérotation : série F vierge (F2026-001) alors qu'une facture manuelle hors série existe → niveau 4 ; le compteur posé la coche", async () => {
    await prisma.numeroDocument.upsert({ where: { cle: ":2026:30" }, create: { cle: ":2026:30", numero: "2026-030", famille: "", annee: 2026, rang: 30, type: "FACTURE", origine: "MANUEL" }, update: {} });
    await passe("SYSTEME");
    const cle = "SYSTEME:numerotation-factures";
    const ligne = await tache(cle);
    assert.equal(ligne.statut, "A_FAIRE");
    assert.equal(ligne.niveau, 4);
    assert.equal(ligne.titre, "Faire valider la numérotation · Factures");
    assert.match(ligne.raison, /^première facture prévue en F2026-001 alors que .*2026-030/);
    assert.equal((await raccourciDe(cle)).href, "/parametres#numerotation");
    await prisma.compteurNumerotation.create({ data: { serie: "FACTURE", annee: 2026, valeur: 32 } });
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, "numérotation des factures 2026 posée");
  });

  test("crédit OpenAI : jamais noté → « Noter le solde OpenAI » (5) ; sous 2 $ → « Recharger » (4) ; rechargé → cochée", async () => {
    const cle = "SYSTEME:credit-openai";
    await passe("SYSTEME");
    let ligne = await tache(cle);
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Noter le solde OpenAI", 5]);
    await parametres.enregistrerParametre({ cle: "SIMULATEUR_CREDIT_OPENAI", valeur: 1.5, valableDu: plus(MERCREDI, -J), source: "essai" });
    await passe("SYSTEME");
    ligne = await tache(cle);
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Recharger le crédit · OpenAI", 4]);
    assert.equal(ligne.raison, "solde estimé 1,50 $ (relevé 1,50 $ le 29/09)");
    assert.equal((await raccourciDe(cle)).externe, true);
    await parametres.enregistrerParametre({ cle: "SIMULATEUR_CREDIT_OPENAI", valeur: 20, valableDu: plus(MERCREDI, -H), source: "essai" });
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, "solde OpenAI noté : 20,00 $ le 30/09");
  });

  test("tâche de fond en échec définitif → « Relancer 1 tâche de fond en échec » (4, Paramètres › Système) ; relancée → cochée", async () => {
    const echec = await uneTacheDeFond("ESSAI_ECHEC", { statut: "ECHEC_DEFINITIF", derniereErreur: "boom", termineLe: plus(MERCREDI, -2 * H) });
    await passe("SYSTEME");
    const cle = "SYSTEME:taches-de-fond";
    const ligne = await tache(cle);
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Relancer 1 tâche de fond en échec", 4]);
    assert.equal(ligne.raison, "1 échec définitif depuis le 30/09");
    const raccourci = await raccourciDe(cle);
    // Mission 18 (A5) : l'écran Tâches de fond est l'onglet Système de Paramètres ; la clé de la tâche ne change pas.
    assert.equal(raccourci.href, "/parametres?section=systeme");
    assert.ok(String(raccourci.marche).length > 20, "la marche à suivre");
    await file.relancerTache(echec.id);
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, "plus aucune tâche de fond en échec");
  });

  test("travail périodique en échec deux fois de suite → une tâche par travail (5 ; sauvegarde : 4) ; repassé → coché", async () => {
    await prisma.planification.create({ data: { nom: "essai-releve", dernierStatut: "ECHEC", echecsConsecutifs: 1, derniereErreur: "délai dépassé", dernierDebut: plus(MERCREDI, -H) } });
    await prisma.planification.create({ data: { nom: "sauvegarde-essai", dernierStatut: "ECHEC", echecsConsecutifs: 2, derniereErreur: "disque plein", dernierDebut: plus(MERCREDI, -H) } });
    await prisma.planification.create({ data: { nom: "sauvegarde-quotidienne", dernierStatut: "ECHEC", echecsConsecutifs: 1, derniereErreur: "copie impossible", dernierDebut: plus(MERCREDI, -2 * H) } });
    await passe("SYSTEME");
    await assert.rejects(tache("SYSTEME:travail-essai-releve"), "un seul échec : pas encore de tâche");
    await prisma.planification.update({ where: { nom: "essai-releve" }, data: { echecsConsecutifs: 2 } });
    await passe("SYSTEME");
    const releve = await tache("SYSTEME:travail-essai-releve");
    assert.deepEqual([releve.statut, releve.titre, releve.niveau], ["A_FAIRE", "Réparer · essai-releve", 5]);
    assert.equal(releve.raison, "2 échecs de suite : délai dépassé");
    assert.equal((await tache("SYSTEME:travail-sauvegarde-essai")).niveau, 4);
    // La sauvegarde quotidienne a sa propre tâche, dès le premier échec.
    await assert.rejects(tache("SYSTEME:travail-sauvegarde-quotidienne"));
    const sauvegarde = await tache("SYSTEME:sauvegarde");
    assert.deepEqual([sauvegarde.statut, sauvegarde.titre, sauvegarde.niveau], ["A_FAIRE", "Réparer · Sauvegarde", 4]);
    assert.match(sauvegarde.raison, /^sauvegarde quotidienne en échec : copie impossible/);
    await prisma.planification.update({ where: { nom: "essai-releve" }, data: { dernierStatut: "SUCCES", echecsConsecutifs: 0, dernierFin: MERCREDI } });
    await passe("SYSTEME", plus(MERCREDI, MIN));
    await cocheeParLeCrm("SYSTEME:travail-essai-releve", "travail repassé le 30/09");
  });

  test("jeton Meta refusé → « Renouveler le jeton · Meta » (4, marche Graph + Railway) ; le refus reste vrai 7 jours, mais un succès postérieur la coche", async () => {
    const refus = await uneTacheDeFond("META_CONVERSION", { statut: "ECHEC_DEFINITIF", derniereErreur: 'Jeton Meta refusé par Meta ({"error":{"message":"Error validating access token","code":190}})', termineLe: new Date() });
    await passe("SYSTEME");
    const cle = "SYSTEME:jeton-meta";
    const ligne = await tache(cle);
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Renouveler le jeton · Meta", 4]);
    assert.equal(ligne.raison, `refusé par Meta le ${achevement.jourMois(refus.updatedAt)}`);
    assert.equal((await raccourciDe(cle)).marche, "Régénérer le jeton de page dans l'explorateur Graph, puis le remplacer sur Railway (META_PAGE_ACCESS_TOKEN)");
    // Le jeton est remplacé : une conversion passe. La tâche en échec de la semaine dit encore « refusé »…
    await uneTacheDeFond("META_CONVERSION", { statut: "TERMINEE", termineLe: plus(new Date(), 1000) });
    assert.equal((await systeme.lireJetonMeta(MERCREDI)).etat, "invalide", "le résumé Meta croit encore au refus");
    // … mais le succès postérieur coche la tâche.
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, /^coché par le CRM : Meta a accepté un envoi le \d\d\/\d\d$/);
  });

  test("API Google non activée (tâche d'agenda en attente) → « Activer l'API · Google Calendar » (5, console Google Cloud) ; repartie → cochée", async () => {
    const attente = await uneTacheDeFond("AGENDA_ESSAI", { statut: "EN_ATTENTE", derniereErreur: google.messageAttenteApiNonActivee(google.API_CALENDAR, null) });
    await passe("SYSTEME");
    const cle = "SYSTEME:google-api-agenda";
    const ligne = await tache(cle);
    assert.deepEqual([ligne.statut, ligne.titre, ligne.niveau], ["A_FAIRE", "Activer l'API · Google Calendar", 5]);
    const raccourci = await raccourciDe(cle);
    assert.equal(raccourci.externe, true);
    assert.match(String(raccourci.marche), /^Console Google Cloud → API et services → activer « Google Calendar API »/);
    await prisma.tache.update({ where: { id: attente.id }, data: { statut: "TERMINEE", derniereErreur: null } });
    await passe("SYSTEME");
    await cocheeParLeCrm(cle, "API Google activée");
  });

  test("répondue « Fait » par Lucas alors que la cause tient : revient 24 h après (sujet SYSTEME)", async () => {
    const cle = "SYSTEME:paiement-stripe";
    assert.equal((await tache(cle)).statut, "A_FAIRE");
    const id = (await tache(cle)).id;
    await avecActeur(LUCAS, () => reponses.repondreTache(id, { reponse: "FAIT" }, MERCREDI));
    assert.equal((await tache(cle)).statut, "FAITE");
    await passe("SYSTEME", plus(MERCREDI, 2 * H));
    assert.equal((await tache(cle)).statut, "FAITE", "pas avant 24 h");
    await passe("SYSTEME", plus(MERCREDI, 25 * H));
    assert.equal((await tache(cle)).statut, "A_FAIRE", "la cause tient encore 24 h après : elle revient");
  });
});

describe("détecteur SYSTEME : un signal illisible ne fait rien cocher", () => {
  test("une tâche ouverte rendue telle quelle (reconduite) n'est ni cochée ni changée", async () => {
    const ligne = (await prisma.tacheAFaire.findFirst({ where: { source: "SYSTEME", statut: "A_FAIRE" } }))!;
    assert.ok(ligne, "une tâche système ouverte");
    const moteur = await import("../moteur");
    const bilan = await moteur.reconcilier([(await import("./ouvertes")).reconduite(ligne)], { sources: ["SYSTEME"], maintenant: plus(MERCREDI, 26 * H) });
    assert.equal(bilan.crees, 0);
    const apres = await tache(ligne.cle);
    assert.equal(apres.statut, "A_FAIRE");
    for (const colonne of ["titre", "raison", "niveau", "raccourci", "donnees", "dureeMin"] as const) assert.deepEqual(apres[colonne], ligne[colonne], colonne);
    assert.equal(apres.depuis.getTime(), ligne.depuis.getTime());
  });
});

describe("détecteur COHERENCE", () => {
  test("une incohérence → « Corriger · Nom » (5, raccourci COHERENCE) ; le contrôle est gardé une heure ; corrigée → cochée", async () => {
    coherence.invaliderCoherence();
    const leadA = await unLead("Aline");
    const leadB = await unLead("Basile");
    const a = await unDossier("Cohérence Aline", { etape: "DEVIS_ENVOYE", leadId: leadA.id });
    const b = await unDossier("Cohérence Basile", { etape: "DEVIS_ENVOYE", leadId: leadB.id });
    await passe("COHERENCE");
    const cleA = `COHERENCE:STATUT_DU_LEAD:${a.id}`;
    const cleB = `COHERENCE:STATUT_DU_LEAD:${b.id}`;
    const ligne = await tache(cleA);
    assert.deepEqual([ligne.statut, ligne.type, ligne.source, ligne.titre, ligne.niveau, ligne.dureeMin], ["A_FAIRE", "COHERENCE", "COHERENCE", "Corriger · Cohérence Aline", 5, 1]);
    assert.deepEqual([ligne.sujetType, ligne.sujetId, ligne.dossierId, ligne.leadId], ["DOSSIER", a.id, a.id, leadA.id]);
    assert.equal(ligne.raison, "Le dossier est en « Devis envoyé » mais son lead est resté « NOUVEAU »");
    const raccourci = await raccourciDe(cleA);
    assert.deepEqual([raccourci.genre, raccourci.cleCoherence, raccourci.dossierId], ["COHERENCE", `STATUT_DU_LEAD:${a.id}`, a.id]);
    // Réglée à la main hors du bouton : le rapport gardé en mémoire (moins d'une heure) la voit encore.
    await prisma.lead.update({ where: { id: leadB.id }, data: { statut: "DEVIS_ENVOYE" } });
    await passe("COHERENCE", plus(MERCREDI, 15 * MIN));
    assert.equal((await tache(cleB)).statut, "A_FAIRE", "contrôle gardé une heure");
    // Le bouton « Corriger » : la correction invalide le rapport gardé, les deux tâches sont cochées au passage suivant.
    const resultat = await avecActeur(LUCAS, () => controle.corrigerIncoherence(`STATUT_DU_LEAD:${a.id}`));
    assert.equal(resultat.corrigee, true);
    await passe("COHERENCE", plus(MERCREDI, 16 * MIN));
    await cocheeParLeCrm(cleA, "incohérence corrigée");
    await cocheeParLeCrm(cleB, "incohérence corrigée");
  });

  test("constat court, et MAIL_SANS_REPONSE écarté (les tâches « Répondre » le couvrent)", () => {
    assert.equal(coherence.constatCourt("Le devis 2026-043 vaut 0 € : le client lit « 0 € » dans son espace. Corriger le montant."), "Le devis 2026-043 vaut 0 €");
    assert.equal(coherence.constatCourt("Le dossier est archivé mais le lien de son espace client fonctionne encore."), "Le dossier est archivé mais le lien de son espace client fonctionne encore");
    assert.ok(coherence.CODES_ECARTES.includes("MAIL_SANS_REPONSE"));
  });
});

describe("détecteur MANUELLE : la condition d'une tâche à moi", () => {
  test("condition remplie → cochée par le CRM avec sa raison ; sans condition ou code inconnu → jamais cochée", async () => {
    const v2 = await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Passer le simulateur en V2", condition: { code: "SIMULATEUR_V2" } }, MERCREDI));
    const libre = await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Relire la politique de confidentialité" }, MERCREDI));
    const inconnue = await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Condition inconnue", condition: { code: "INCONNUE" } }, MERCREDI));
    const solde = await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Noter le solde OpenAI", condition: { code: "SOLDE_OPENAI_NOTE" } }, MERCREDI));
    await passe("MANUELLE");
    for (const t of [v2, libre, inconnue, solde]) assert.equal((await tache(t.cle)).statut, "A_FAIRE", `${t.titre} : rien de rempli`);
    await parametres.enregistrerParametre({ cle: "SIMULATEUR_MOTEUR", valeur: "V2", valableDu: plus(MERCREDI, -H), source: "essai" });
    await parametres.enregistrerParametre({ cle: "SIMULATEUR_CREDIT_OPENAI", valeur: 18, valableDu: plus(MERCREDI, -H), source: "essai" });
    await passe("MANUELLE");
    await cocheeParLeCrm(v2.cle, "moteur du simulateur passé en V2");
    await cocheeParLeCrm(solde.cle, /^coché par le CRM : solde OpenAI noté le \d\d\/\d\d \(18,00 \$\)$/);
    assert.equal((await tache(libre.cle)).statut, "A_FAIRE");
    assert.equal((await tache(inconnue.cle)).statut, "A_FAIRE");
  });

  test("codes : texte seul ou objet { code } ; la liste est exportée pour la mise en route", () => {
    assert.equal(manuelles.codeDeCondition("AVIS_GOOGLE"), "AVIS_GOOGLE");
    assert.equal(manuelles.codeDeCondition({ code: "JETON_META" }), "JETON_META");
    assert.equal(manuelles.codeDeCondition({ genre: "PARAMETRE" }), null);
    assert.equal(manuelles.codeDeCondition("AUTRE"), null);
    assert.deepEqual([...manuelles.CONDITIONS_MANUELLES].sort(), ["AVIS_GOOGLE", "BANC_LANCE", "CALENDAR_ACTIVE", "JETON_META", "REALISATION_PUBLIEE", "SIMULATEUR_V2", "SOLDE_OPENAI_NOTE", "TARIFS_COMPLETS"]);
    for (const code of manuelles.CONDITIONS_MANUELLES) assert.ok(manuelles.LIBELLES_CONDITION[code].length > 10);
  });
});

describe("notification du matin", () => {
  /** Lundi 05/10/2026 à Paris (heure d'été : UTC+2). */
  const aParis = (jour: string, heure: string) => new Date(`${jour}T${heure}:00.000+02:00`);
  const envois = () => prisma.alerteEnvoi.count({ where: { origine: matin.ORIGINE_MATIN } });
  const dates = new Set<string>();
  /** En production l'envoi est daté de l'instant du passage ; ici l'horloge est fixe : on date la nouvelle ligne comme elle l'aurait été. */
  async function daterEnvois(le: Date) {
    const lignes = await prisma.alerteEnvoi.findMany({ where: { origine: matin.ORIGINE_MATIN }, select: { id: true } });
    for (const { id } of lignes.filter((l) => !dates.has(l.id))) {
      await prisma.alerteEnvoi.update({ where: { id }, data: { createdAt: le } });
      dates.add(id);
    }
  }

  test("aucune avant 8 h ; une seule par jour ; jamais si le paramètre vaut NON ; rien sans tâche", async () => {
    await avecActeur(LUCAS, () => reponses.ajouterTache({ titre: "Tâche du matin" }, aParis("2026-10-05", "07:00")));
    assert.deepEqual(await matin.notifierTachesDuMatin(aParis("2026-10-05", "07:45")), { envoyee: false, raison: "avant 8 h" });
    assert.equal(await envois(), 0);

    const premier = await matin.notifierTachesDuMatin(aParis("2026-10-05", "08:05"));
    assert.equal(premier.envoyee, true);
    assert.match(premier.texte ?? "", /^\d+ tâches? aujourd'hui, environ \d+ (min|h)/);
    assert.equal(await envois(), 1);
    await daterEnvois(aParis("2026-10-05", "08:05"));
    // Même jour : la garde en mémoire, puis le registre des alertes (après un redémarrage).
    assert.equal((await matin.notifierTachesDuMatin(aParis("2026-10-05", "08:20"))).envoyee, false);
    matin.oublierEnvoiDuMatin();
    assert.deepEqual(await matin.notifierTachesDuMatin(aParis("2026-10-05", "18:00")), { envoyee: false, raison: "déjà envoyée aujourd'hui" });
    assert.equal(await envois(), 1);

    // Lendemain, paramètre à NON : rien.
    await parametres.enregistrerParametre({ cle: "NOTIF_TACHES_MATIN", valeur: "NON", valableDu: aParis("2026-10-06", "00:00"), source: "essai" });
    assert.equal((await matin.notifierTachesDuMatin(aParis("2026-10-06", "08:30"))).envoyee, false);
    assert.equal(await envois(), 1);

    // Surlendemain, remis à OUI : une nouvelle notification.
    await parametres.enregistrerParametre({ cle: "NOTIF_TACHES_MATIN", valeur: "OUI", valableDu: aParis("2026-10-07", "00:00"), source: "essai" });
    assert.equal((await matin.notifierTachesDuMatin(aParis("2026-10-07", "09:00"))).envoyee, true);
    assert.equal(await envois(), 2);
    await daterEnvois(aParis("2026-10-07", "09:00"));

    // Plus aucune tâche : rien n'est envoyé.
    await prisma.tacheAFaire.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "essai suivant" } });
    assert.deepEqual(await matin.notifierTachesDuMatin(aParis("2026-10-08", "08:10")), { envoyee: false, raison: "aucune tâche aujourd'hui" });
    assert.equal(await envois(), 2);
  });

  test("durée lisible", () => {
    assert.deepEqual([45, 60, 75, 125].map(matin.dureeLisible), ["45 min", "1 h", "1 h 15", "2 h 05"]);
  });
});
