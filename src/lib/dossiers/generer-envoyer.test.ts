import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-generer-envoyer-"));

/**
 * Mission 18 (B1, écart 1) : générer un devis n'est pas l'envoyer. « Devis envoyé » seulement s'il est annoncé (mail
 * « Devis disponible » programmé : adresse valide, espace ouvert ; ou interrupteur coupé : la mise en ligne vaut envoi) ;
 * sinon il reste masqué en Qualification ou Simulation, la main est à moi, et une tâche « Envoyer le devis · X » le
 * rappelle. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`) : étape, main, prochaine action, étape de l'espace,
 * relances, tâches. Rien ne part hors du poste : les mails sont seulement programmés (file locale), jamais envoyés.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let compte: typeof import("@/lib/espace/compte");
let dossiers: typeof import("./dossiers");
let documents: typeof import("./documents");
let transitions: typeof import("./transitions");
let devisEnvoye: typeof import("./devis-envoye");
let notifications: typeof import("@/lib/mail/notifications");
let commercial: typeof import("@/lib/commercial/pilotage");
let auto: typeof import("./prochaine-action-auto");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
const devisDe = (objet: string, extra: { notifier?: boolean; libelleVariante?: string } = {}) =>
  documents.schemaGeneration.parse({ type: "DEVIS", objet, lignes: [ligne("Revêtement adhésif — façades", 10, 150)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, ...extra });
const generer = (dossierId: string, objet: string, extra: { notifier?: boolean; libelleVariante?: string } = {}) => avecActeur(LUCAS, () => documents.genererDocument(dossierId, devisDe(objet, extra)));

async function contact(prenom: string, email?: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...(email ? { email } : {}) } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, permanentId: ouvert.permanent.id, nom: `${prenom} Essai` };
}
const notifs = (documentId: string) => prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${documentId}` } });
const tachesDe = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>, type: string) => etat.taches.filter((t) => t.type === type);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  compte = await import("@/lib/espace/compte");
  dossiers = await import("./dossiers");
  documents = await import("./documents");
  transitions = await import("./transitions");
  devisEnvoye = await import("./devis-envoye");
  notifications = await import("@/lib/mail/notifications");
  commercial = await import("@/lib/commercial/pilotage");
  auto = await import("./prochaine-action-auto");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("générer n'est pas envoyer (mission 18, B1)", () => {
  test("la règle : annoncé = envoyé ; sinon masqué avant tout devis envoyé ; une variante silencieuse dans un espace ouvert est mise en ligne", () => {
    const regle = (etape: import("./constants").EtapeDossier, notifier: boolean, etat: Partial<{ modeleActif: boolean; espaceOuvert: boolean; possible: boolean }> = {}) =>
      devisEnvoye.envoiALaGeneration({ etape, notifier, modeleActif: true, espaceOuvert: true, possible: true, ...etat });
    assert.deepEqual(regle("QUALIFICATION", true), { visible: true, envoye: true, mail: true });
    assert.deepEqual(regle("QUALIFICATION", false), { visible: false, envoye: false, mail: false });
    assert.deepEqual(regle("SIMULATION", true, { possible: false }), { visible: false, envoye: false, mail: false }, "sans adresse : rien ne l'annonce");
    assert.deepEqual(regle("SIMULATION", true, { espaceOuvert: false, possible: false }), { visible: false, envoye: false, mail: false });
    assert.deepEqual(regle("SIMULATION", true, { modeleActif: false, possible: false }), { visible: true, envoye: true, mail: false }, "interrupteur coupé : la mise en ligne vaut envoi");
    assert.deepEqual(regle("SIMULATION", true, { modeleActif: false, espaceOuvert: false, possible: false }), { visible: false, envoye: false, mail: false });
    assert.deepEqual(regle("DEVIS_ENVOYE", false), { visible: true, envoye: true, mail: false }, "variante silencieuse");
    assert.deepEqual(regle("RELANCE", true, { possible: false, espaceOuvert: true }), { visible: true, envoye: false, mail: false }, "visible, mais pas annoncé");
    assert.deepEqual(regle("SIGNE", false, { espaceOuvert: false }), { visible: true, envoye: false, mail: false });
  });

  test("Qualification, notifier: false : reste en Qualification, main à moi, devis masqué, aucune relance, tâche « Envoyer le devis » ; rendu visible, il est envoyé et la tâche se coche", async () => {
    const c = await contact("Masque", "masque.essai@example.test");
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });
    const { document: devis } = await generer(c.dossierId, "Recouvrement cuisine", { notifier: false });

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "QUALIFICATION");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["MOI", "MOI", `Devis prêt, pas encore envoyé (${devis.numero}) : à lui envoyer`]);
    assert.equal(etat.prochaineAction, avant.prochaineAction, "rien à remplacer : « Attendre l'accord » n'est pas posé");
    assert.equal(etat.statutLead, avant.statutLead);
    assert.equal(etat.etapeEspace, avant.etapeEspace, "l'espace ne bouge pas");
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
    const envoyer = tachesDe(etat, "ENVOYER_DEVIS");
    assert.deepEqual(envoyer.map((t) => [t.cle, t.titre, t.niveau, t.statut]), [[`ENVOYER_DEVIS:dossier:${c.dossierId}`, `Envoyer le devis · ${c.nom}`, 2, "A_FAIRE"]]);
    assert.match(envoyer[0].raison, new RegExp(`^devis ${devis.numero} prêt le \\d{2}/\\d{2}, masqué dans son espace$`));
    assert.equal(tachesDe(etat, "DEVIS").length + tachesDe(etat, "SIMULATION").length, 0, "ni « Faire le devis » ni « Préparer la simulation »");
    assert.equal(devis.visibleEspace, false);
    assert.equal(await notifs(devis.id), 0, "aucun mail programmé");
    const permanent = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: c.permanentId } });
    assert.ok(!(await compte.documentsDuClient(permanent)).some((x) => x.id === devis.id), "le client ne le voit pas");
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_GENERE" } });
    assert.equal(JSON.parse(evenement.metadata).envoye, false);
    // /commercial : à moi, « devis prêt, pas encore envoyé » (pas « préparer la simulation »).
    const affaire = (await commercial.pilotageCommercial(new Date(), { sansLimite: true })).affaires.find((a) => a.dossierId === c.dossierId)!;
    assert.deepEqual([affaire.groupe, affaire.main, affaire.action], ["DEVIS", "MOI", etat.mainMotif]);

    // Lucas le met en ligne : c'est l'envoi (étape, main, relance) ; la tâche est cochée par le CRM.
    await avecActeur(LUCAS, () => documents.modifierPresentationDevis(c.dossierId, devis.id, { visibleEspace: true }));
    const envoye = await etatDesDeuxCotes(c.dossierId);
    assert.equal(envoye.etape, "DEVIS_ENVOYE");
    assert.deepEqual([envoye.main, envoye.mainCalculee, envoye.mainMotif], ["CLIENT", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.deepEqual(envoye.relances.devis.map((r) => [r.numero, r.rang]), [[devis.numero, 1]]);
    assert.equal(tachesDe(envoye, "ENVOYER_DEVIS").length, 0);
    const cochee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: `ENVOYER_DEVIS:dossier:${c.dossierId}` } });
    assert.equal(cochee.statut, "FAITE");
    assert.match(cochee.reponseTexte ?? "", new RegExp(`^coché par le CRM : devis ${devis.numero} mis en ligne à \\d{2}:\\d{2}$`));
  });

  test("annoncé (adresse, espace ouvert) : Devis envoyé, main au client, « Attendre l'accord », relance datée de l'envoi, un seul mail programmé, aucune tâche à envoyer", async () => {
    const c = await contact("Annonce", "annonce.essai@example.test");
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
    const { document: devis } = await generer(c.dossierId, "Recouvrement cuisine");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "DEVIS_ENVOYE");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["CLIENT", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal(etat.prochaineAction, "Attendre l'accord du client sur le devis");
    assert.equal(etat.statutLead, "DEVIS_ENVOYE");
    assert.equal(etat.etapeEspace, "DEVIS");
    assert.deepEqual(etat.relances.devis.map((r) => [r.numero, r.rang]), [[devis.numero, 1]]);
    assert.ok(etat.relances.devis[0].le && new Date(etat.relances.devis[0].le).getTime() > Date.now(), "la relance court depuis l'envoi : à venir");
    assert.equal(tachesDe(etat, "ENVOYER_DEVIS").length, 0);
    assert.equal(devis.visibleEspace, true);
    assert.equal(await notifs(devis.id), 1);
    assert.equal(JSON.parse((await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_GENERE" } })).metadata).envoye, true);
  });

  test("« Préparer le devis » devient « Envoyer le devis au client » ; posée à la main, l'action reste, sans tâche de remplacement, et « Envoyer le devis » apparaît malgré sa vigueur", async () => {
    const parLEspace = await contact("Preparer");
    await avecActeur(LUCAS, () => transitions.changerEtape(parLEspace.dossierId, { vers: "SIMULATION" }));
    await prisma.dossier.update({ where: { id: parLEspace.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
    await generer(parLEspace.dossierId, "Cuisine");
    const ecrite = await etatDesDeuxCotes(parLEspace.dossierId);
    assert.deepEqual([ecrite.etape, ecrite.prochaineAction, ecrite.main], ["SIMULATION", "Envoyer le devis au client", "MOI"]);
    assert.equal(tachesDe(ecrite, "ENVOYER_DEVIS").length, 1, "sans adresse : pas annoncé, à envoyer");

    const alaMain = await contact("Gardee");
    const texte = "Préparer le devis avec le plan de travail en option";
    await avecActeur(LUCAS, () => dossiers.modifierDossier(alaMain.dossierId, { prochaineAction: texte }));
    await generer(alaMain.dossierId, "Cuisine", { notifier: false });
    const gardee = await etatDesDeuxCotes(alaMain.dossierId);
    assert.deepEqual([gardee.prochaineAction, gardee.actionManuelle], [texte, texte], "jamais écrasée");
    assert.equal(gardee.taches.filter((t) => t.cle.startsWith(auto.PREFIXE_TACHE_SYNCHRO)).length, 0, "pas de doublon de la tâche « Envoyer le devis »");
    assert.deepEqual(tachesDe(gardee, "ENVOYER_DEVIS").map((t) => t.titre), [`Envoyer le devis · ${alaMain.nom}`]);
    assert.deepEqual([gardee.main, gardee.mainCalculee], ["MOI", "MOI"]);
  });

  test("interrupteur « Devis disponible » coupé : la mise en ligne dans un espace ouvert vaut envoi, sans mail ; deux devis à envoyer font une seule tâche ; annulés, elle se coche", async () => {
    const coupe = { ...notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, actif: false };
    await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", coupe, "essai");
    try {
      const c = await contact("Coupe");
      const { document: devis } = await generer(c.dossierId, "Cuisine");
      const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
      assert.deepEqual([etat.etape, etat.main, devis.visibleEspace], ["DEVIS_ENVOYE", "CLIENT", true]);
      assert.equal(await notifs(devis.id), 0);
    } finally {
      await notifications.enregistrerModeleNotification("DEVIS_DISPONIBLE", notifications.MODELES_PAR_DEFAUT.DEVIS_DISPONIBLE, "essai");
    }

    const d = await contact("Deux");
    const { document: a } = await generer(d.dossierId, "Cuisine", { notifier: false, libelleVariante: "façades seules" });
    const { document: b } = await generer(d.dossierId, "Cuisine", { notifier: false, libelleVariante: "façades + plan" });
    const deux = await etatDesDeuxCotes(d.dossierId);
    const tache = tachesDe(deux, "ENVOYER_DEVIS");
    assert.equal(tache.length, 1);
    assert.equal(tache[0].raison, `devis ${a.numero}, ${b.numero} prêts, pas encore envoyés`);
    assert.deepEqual((await devisEnvoye.devisAEnvoyer(prisma, [d.dossierId])).map((x) => x.numero), [a.numero, b.numero]);

    await avecActeur(LUCAS, () => documents.annulerDevis(d.dossierId, a.id, "erreur de métrage"));
    await avecActeur(LUCAS, () => documents.annulerDevis(d.dossierId, b.id, "erreur de métrage"));
    const annules = await etatDesDeuxCotes(d.dossierId);
    assert.equal(tachesDe(annules, "ENVOYER_DEVIS").length, 0);
    assert.match((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: `ENVOYER_DEVIS:dossier:${d.dossierId}` } })).reponseTexte ?? "", /^coché par le CRM : devis .+ annulé$/);
    assert.notEqual(annules.mainMotif?.startsWith("Devis prêt"), true, "annulé : plus « à envoyer »");
    assert.equal(annules.etape, "QUALIFICATION");
  });

  test("un devis émis avant la mission 18 (sans la marque) n'est jamais pris pour un devis à envoyer", async () => {
    const c = await contact("Ancien");
    await generer(c.dossierId, "Cuisine", { notifier: false });
    // L'événement tel qu'il était écrit avant B1 : sans `envoye` ni `visibleEspace`.
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_GENERE" } });
    const ancienne = JSON.parse(evenement.metadata) as Record<string, unknown>;
    delete ancienne.envoye;
    delete ancienne.visibleEspace;
    await prisma.dossierEvenement.update({ where: { id: evenement.id }, data: { metadata: JSON.stringify(ancienne) } });
    assert.deepEqual(await devisEnvoye.devisAEnvoyer(prisma, [c.dossierId]), []);
    const { calculerMain } = await import("./main");
    assert.notEqual((await calculerMain(c.dossierId))?.motif.startsWith("Devis prêt"), true, "la main ne le dit pas « à envoyer »");
  });
});
