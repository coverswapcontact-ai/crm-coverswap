import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mise-en-ligne-"));

/**
 * Mission 18 (B5, écart 5) : un devis rendu visible dans l'espace est MIS EN LIGNE, d'un bloc (visibilité, événement
 * « Devis envoyé » qui date la relance, étape, prochaine action, main), puis annoncé par l'automatisme existant
 * « Devis disponible » (une fois par devis ; pas pour un devis repris ni déjà envoyé par mail ; interrupteur gardé).
 * La relance compte depuis la mise en ligne, et le dit (« envoyé il y a », « adressé le »). Chaque cas se lit des deux
 * côtés (`etatDesDeuxCotes`). Rien ne part hors du poste : les mails sont seulement programmés (file locale).
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let existants: typeof import("./documents-existants");
let transitions: typeof import("./transitions");
let notifications: typeof import("@/lib/mail/notifications");
let relances: typeof import("@/lib/relances/service");
let dates: typeof import("./dates");
let auto: typeof import("./prochaine-action-auto");
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let session: import("@/lib/assistant/execution").Session;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
/** Un devis du CRM généré sans annonce (`notifier: false`) : masqué en Qualification ou Simulation, pas envoyé (B1). */
const genererMasque = (dossierId: string, objet: string) =>
  avecActeur(LUCAS, () => documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false })));
const rendreVisible = (dossierId: string, documentId: string, visibleEspace = true) => avecActeur(LUCAS, () => documents.modifierPresentationDevis(dossierId, documentId, { visibleEspace }));

async function contact(prenom: string, email?: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...(email ? { email } : {}) } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, nom: `${prenom} Essai` };
}
/** En Simulation, le client a choisi : l'espace a posé « Préparer le devis (simulation choisie) ». */
async function enSimulation(dossierId: string) {
  await avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers: "SIMULATION" }));
  await prisma.dossier.update({ where: { id: dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
}
const notifs = (documentId: string) => prisma.envoiMail.findMany({ where: { cle: `notif:DEVIS_DISPONIBLE:${documentId}` } });
const misesEnLigne = (dossierId: string) => prisma.dossierEvenement.findMany({ where: { dossierId, type: "DEVIS_ENVOYE" }, orderBy: { createdAt: "asc" } });
const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);

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
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  existants = await import("./documents-existants");
  transitions = await import("./transitions");
  notifications = await import("@/lib/mail/notifications");
  relances = await import("@/lib/relances/service");
  dates = await import("./dates");
  auto = await import("./prochaine-action-auto");
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "mise-en-ligne", utilisateur: "essai@local" });
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("devis rendu visible = mis en ligne et annoncé (mission 18, B5)", () => {
  test("Simulation, devis masqué rendu visible : Devis envoyé, main au client, « Attendre l'accord », espace DEVIS, relance depuis la mise en ligne, tâche cochée, un seul « Devis disponible »", async () => {
    const c = await contact("Enligne", "enligne.essai@example.test");
    await enSimulation(c.dossierId);
    const { document: devis } = await genererMasque(c.dossierId, "Recouvrement cuisine");
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([avant.etape, avant.main, avant.prochaineAction], ["SIMULATION", "MOI", "Envoyer le devis au client"]);
    assert.notEqual(avant.etapeEspace, "DEVIS", "masqué : le client ne le voit pas");
    assert.equal(tachesDe(avant, "ENVOYER_DEVIS").length, 1);
    assert.deepEqual(avant.relances, { proposables: [], devis: [] });

    const rendu = await rendreVisible(c.dossierId, devis.id);
    assert.equal(rendu.passage?.vers, "DEVIS_ENVOYE");
    assert.deepEqual(rendu.annonce, { mail: true, raison: null });

    // Côté CRM et côté client.
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "DEVIS_ENVOYE");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["CLIENT", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal(etat.prochaineAction, "Attendre l'accord du client sur le devis");
    assert.equal(etat.statutLead, "DEVIS_ENVOYE");
    assert.equal(etat.etapeEspace, "DEVIS");
    assert.deepEqual(tachesDe(etat, "ENVOYER_DEVIS"), [], "la tâche « Envoyer le devis » est faite");
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: `ENVOYER_DEVIS:dossier:${c.dossierId}` } })).statut, "FAITE");

    // Historique : la mise en ligne (canal ESPACE) et le passage, écrits ensemble.
    const [miseEnLigne] = await misesEnLigne(c.dossierId);
    assert.deepEqual(JSON.parse(miseEnLigne.metadata), { documentId: devis.id, presentation: true, canal: "ESPACE" });
    assert.equal(miseEnLigne.contenu, `Devis ${devis.numero} : visible dans l'espace client`);
    const passage = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" } });
    assert.match(passage.contenu, new RegExp(`Simulation → Devis envoyé : devis ${devis.numero} rendu visible dans son espace`));

    // L'annonce : l'automatisme existant, une fois, à l'adresse du client, vers la rubrique devis de son espace.
    const mails = await notifs(devis.id);
    assert.equal(mails.length, 1);
    assert.deepEqual([mails[0].nature, mails[0].modele, mails[0].a, mails[0].dossierId], ["NOTIFICATION", "DEVIS_DISPONIBLE", "enligne.essai@example.test", c.dossierId]);
    assert.match(mails[0].texte, /#devis/);

    // La relance compte depuis la mise en ligne (délai par défaut) ; décalée avec elle, elle suit.
    const { jours: delai } = await relances.lireDelaiRelance();
    assert.deepEqual(etat.relances.devis.map((r) => [r.numero, r.rang]), [[devis.numero, 1]]);
    assert.equal(new Date(etat.relances.devis[0].le!).getTime(), miseEnLigne.createdAt.getTime() + delai * JOUR);
    const plusTard = new Date(miseEnLigne.createdAt.getTime() + 3 * JOUR);
    await prisma.dossierEvenement.update({ where: { id: miseEnLigne.id }, data: { createdAt: plusTard } });
    try {
      const decale = await etatDesDeuxCotes(c.dossierId, { maintenant: plusTard, taches: false });
      assert.equal(new Date(decale.relances.devis[0].le!).getTime(), plusTard.getTime() + delai * JOUR, "pas depuis l'émission");
      const [liste] = (await relances.listerRelances(plusTard, { dossierId: c.dossierId, sms: false })).devis;
      assert.deepEqual([liste.envoyeLe, liste.joursDepuisEnvoi, liste.joursDepuisEmission], [plusTard.toISOString(), 0, 3], "« envoyé il y a 0 jour », émis il y a 3 jours");
      const relance = await relances.relancerDevis(c.dossierId, { maintenant: new Date(plusTard.getTime() + (delai + 1) * JOUR), apercuSeulement: true });
      assert.match(relance.texte, new RegExp(`que je vous ai adressé le ${dates.dateEnLettres(plusTard)}\\.`));
      assert.ok(!(await relances.relancerDevis(c.dossierId, { maintenant: new Date(plusTard.getTime() + (delai - 1) * JOUR), apercuSeulement: true }).then(() => true, () => false)), "délai pas écoulé depuis la mise en ligne");
    } finally {
      await prisma.dossierEvenement.update({ where: { id: miseEnLigne.id }, data: { createdAt: miseEnLigne.createdAt } });
    }

    // Masqué puis remis en ligne : une nouvelle mise en ligne (la relance repart d'elle), jamais un second mail.
    // Mission 18 (B6) : masqué, le seul devis fait revenir le dossier en Simulation ; remis en ligne, il y repasse.
    const masque = await rendreVisible(c.dossierId, devis.id, false);
    assert.deepEqual([masque.passage?.de, masque.passage?.vers, masque.passage?.nature], ["DEVIS_ENVOYE", "SIMULATION", "RETOUR"]);
    const remis = await rendreVisible(c.dossierId, devis.id);
    assert.deepEqual([remis.passage?.de, remis.passage?.vers], ["SIMULATION", "DEVIS_ENVOYE"], "revenu en Simulation au masquage : il repasse en « Devis envoyé »");
    assert.equal(remis.annonce?.mail, false);
    assert.match(remis.annonce?.raison ?? "", /Déjà envoyé/);
    assert.equal((await notifs(devis.id)).length, 1, "un seul « Devis disponible » par devis");
    assert.equal((await misesEnLigne(c.dossierId)).length, 2);
    const apres = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([apres.etape, apres.main, apres.prochaineAction, apres.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
  });

  test("action posée à la main gardée (sans tâche : une attente du client) ; interrupteur « Devis disponible » coupé : mis en ligne quand même, sans mail ; sans adresse : visible, pas envoyé", async () => {
    const coupe = { ...notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, actif: false };
    await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", coupe, "essai");
    try {
      const c = await contact("Gardee", "gardee.enligne@example.test");
      await enSimulation(c.dossierId);
      // Posée à la main avant le devis : la génération sans envoi la garde (sans tâche, B1) ; la mise en ligne aussi.
      const texte = "Préparer le devis avec le plan de travail en option";
      await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: texte }));
      const { document: devis } = await genererMasque(c.dossierId, "Cuisine");

      const rendu = await rendreVisible(c.dossierId, devis.id);
      assert.deepEqual(rendu.annonce, { mail: false, raison: "Modèle désactivé dans Paramètres." });
      const etat = await etatDesDeuxCotes(c.dossierId);
      assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "CLIENT", "DEVIS"]);
      assert.deepEqual([etat.prochaineAction, etat.actionManuelle], [texte, texte], "jamais écrasée");
      // Relecture : « Attendre l'accord » est une attente du client : aucune tâche rangée à la place de l'action gardée.
      assert.deepEqual(etat.taches.filter((t) => t.cle === `${auto.PREFIXE_TACHE_SYNCHRO}${c.dossierId}:devis`), []);
      assert.deepEqual(etat.relances.devis.map((r) => [r.numero, r.rang]), [[devis.numero, 1]]);
      assert.equal((await notifs(devis.id)).length, 0, "interrupteur gardé : aucun mail");
    } finally {
      await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, "essai");
    }

    // Relecture (une seule règle, celle de la génération) : sans adresse, rendu visible mais PAS envoyé — l'étape ne bouge
    // pas, la main reste à moi, la tâche « Envoyer le devis » reste ouverte, aucune relance ; l'écran dit pourquoi.
    const sans = await contact("Sansadresse");
    const { document: devis } = await genererMasque(sans.dossierId, "Cuisine");
    const rendu = await rendreVisible(sans.dossierId, devis.id);
    assert.deepEqual([rendu.passage, rendu.annonce], [null, { mail: false, raison: "Aucune adresse e-mail valide pour ce client." }]);
    assert.match(rendu.nonEnvoye ?? "", /^Visible dans son espace, mais pas envoyé : aucune adresse e-mail valide pour ce client\. /);
    const etat = await etatDesDeuxCotes(sans.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.relances.devis], ["QUALIFICATION", "MOI", "MOI", []]);
    assert.deepEqual(tachesDe(etat, "ENVOYER_DEVIS").map((t) => t.raison.replace(/\d{2}\/\d{2}/, "jj/mm")), [`devis ${devis.numero} prêt le jj/mm, pas encore annoncé`]);
    assert.equal((await misesEnLigne(sans.dossierId)).length, 0, "aucun « Devis envoyé »");
    const { phraseAnnonce } = await import("./devis-envoye");
    assert.equal(phraseAnnonce(rendu.annonce!), "Aucun mail « Devis disponible » : aucune adresse e-mail valide pour ce client.");
  });

  test("devis repris (fait ailleurs) masqué puis rendu visible, par l'interrupteur ou par la correction : mis en ligne d'un bloc, aucun mail", async () => {
    for (const geste of ["interrupteur", "correction"] as const) {
      const c = await contact(geste === "interrupteur" ? "Reprisinter" : "Repriscorr", `repris.${geste}@example.test`);
      await enSimulation(c.dossierId);
      const numero = geste === "interrupteur" ? "2026-781" : "2026-782";
      const depose = await avecActeur(LUCAS, () =>
        existants.enregistrerDocumentExistant(c.dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero, montant: 900, dateEmission: dates.jourParis(new Date(Date.now() - 2 * JOUR)), statut: "ENVOYE", objet: "Repris", inscrireAuRegistre: true, visibleEspace: false }))
      );
      const masque = await etatDesDeuxCotes(c.dossierId, { taches: false });
      assert.deepEqual([masque.etape, masque.relances.devis], ["SIMULATION", []], "déposé masqué : rien ne bouge");
      assert.notEqual(masque.etapeEspace, "DEVIS");

      if (geste === "interrupteur") {
        const rendu = await rendreVisible(c.dossierId, depose.documentId);
        assert.deepEqual(rendu.annonce, { mail: false, raison: "devis repris : il est déjà parti ailleurs" });
      } else {
        await avecActeur(LUCAS, () => existants.modifierDocumentExistant(c.dossierId, depose.documentId, { visibleEspace: true }));
      }
      const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
      assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction, etat.statutLead, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS_ENVOYE", "DEVIS"]);
      const [miseEnLigne] = await misesEnLigne(c.dossierId);
      assert.equal(JSON.parse(miseEnLigne.metadata).canal, "ESPACE");
      const { jours: delai } = await relances.lireDelaiRelance();
      assert.equal(new Date(etat.relances.devis[0].le!).getTime(), miseEnLigne.createdAt.getTime() + delai * JOUR, "depuis la mise en ligne, pas depuis l'émission d'il y a deux jours");
      assert.equal((await notifs(depose.documentId)).length, 0, `${geste} : aucun mail`);
    }
  });

  test("outil « modifier » DOCUMENT : l'aperçu annonce le mail « Devis disponible », le résultat dit qu'il est parti (mêmes fonctions que l'écran)", async () => {
    const c = await contact("Outil", "outil.enligne@example.test");
    await enSimulation(c.dossierId);
    const { document: devis } = await genererMasque(c.dossierId, "Cuisine");
    const appeler = (entree: Record<string, unknown>) => execution.executerOutil(catalogue.outilParNom("modifier")!, { commande: "mets le devis en ligne", ...entree }, session, new Date());
    const entree = { entite: "DOCUMENT", id: devis.id, champs: { visible_espace: true } };
    const apercu = await appeler(entree);
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.match(apercu.texte, /la relance compte depuis la mise en ligne/);
    assert.match(apercu.texte, /Le mail « Devis disponible » partira au client \(une fois par devis\)\./);
    assert.equal((await notifs(devis.id)).length, 0, "l'aperçu n'envoie rien");
    const fait = await appeler({ ...entree, confirmation: apercu.confirmation!.jeton });
    assert.match(fait.texte, /Le client est prévenu par le mail « Devis disponible »\./);
    assert.equal((await notifs(devis.id)).length, 1);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
  });
});
