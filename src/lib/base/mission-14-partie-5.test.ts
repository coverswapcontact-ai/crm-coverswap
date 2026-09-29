import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p5-"));

/**
 * Mission 14 (29/09/2026), partie 5 — l'écran SMS et le catalogue unique : les
 * textes n'existent qu'à un seul endroit (`sms/catalogue.ts`, modifiables en
 * base), le SMS proposé suit l'action et la source du lead, copier vaut envoi
 * (événement SMS_COPIE, main au client pour un lien, signal « Lien pas encore
 * envoyé » qui tombe), la migration des textes. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let catalogue: typeof import("@/lib/sms/catalogue");
let modeles: typeof import("@/lib/sms/modeles");
let proposition: typeof import("@/lib/sms/proposition");
let copie: typeof import("@/lib/sms/copie");
let quand: typeof import("@/lib/commercial/quand");
let liens: typeof import("@/lib/espace/liens");
let suivi: typeof import("@/lib/espace/suivi");
let gestion: typeof import("@/lib/espace/gestion");
let lienEspace: typeof import("@/lib/mail/lien-espace");
let simulations: typeof import("@/lib/simulations/dossier");
let main: typeof import("@/lib/dossiers/main");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-5");
let NextRequest: typeof import("next/server").NextRequest;

/** Mercredi 30 septembre 2026, 10 h à Paris (heure d'été). */
const MERCREDI = new Date("2026-09-30T08:00:00.000Z");
/** Lundi 28 septembre 2026, 10 h à Paris. */
const LUNDI = new Date("2026-09-28T08:00:00.000Z");
/** Mardi 1er décembre 2026, 9 h à Paris (heure d'hiver). */
const HIVER = new Date("2026-12-01T08:00:00.000Z");
const MIGRATION = { acteur: "MIGRATION:catalogue-sms-14-5", origine: "essai" };
const JOUR = 86_400_000;
const LIEN = /^https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+$/;

let numero = 0;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Cinq", telephone: `+3361405${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", ...donnees } });

/** Un lead Meta, son dossier et son espace, jamais ouvert par le client. */
async function contact(prenom: string, donnees: Record<string, unknown> = {}) {
  const l = await lead(prenom, donnees);
  const ouvert = await liens.ouvrirEspaceDuContact(l.id);
  return { leadId: l.id, dossierId: ouvert.dossierId, nom: `${prenom} Cinq` };
}
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const ligneEspace = async (dossierId: string, maintenant = new Date()) => (await suivi.listerEspaces(maintenant)).find((l) => l.dossierId === dossierId)!;
const signaux = async (dossierId: string, maintenant = new Date()) => (await ligneEspace(dossierId, maintenant)).signaux.map((s) => s.code);
const modele = (code: string) => prisma.modeleSms.findUniqueOrThrow({ where: { code } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.TACHES_DESACTIVEES = "1";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  catalogue = await import("@/lib/sms/catalogue");
  modeles = await import("@/lib/sms/modeles");
  proposition = await import("@/lib/sms/proposition");
  copie = await import("@/lib/sms/copie");
  quand = await import("@/lib/commercial/quand");
  liens = await import("@/lib/espace/liens");
  suivi = await import("@/lib/espace/suivi");
  gestion = await import("@/lib/espace/gestion");
  lienEspace = await import("@/lib/mail/lien-espace");
  simulations = await import("@/lib/simulations/dossier");
  main = await import("@/lib/dossiers/main");
  migration = await import("@/lib/base/migrations/mission-14-partie-5");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("le catalogue : un seul endroit pour les textes", () => {
  test("les textes de Lucas, exacts ; les accusés inchangés ; l'ordre des groupes", () => {
    const texte = (code: string) => catalogue.definitionSms(code)?.defaut;
    assert.equal(texte("PAS_DE_REPONSE_SIMULATION"), "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre simulation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.");
    assert.equal(texte("PAS_DE_REPONSE"), "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle {quand}, ou dites-moi le moment qui vous arrange.");
    assert.equal(texte("PAS_DE_REPONSE_2"), "Bonjour, c'est encore Lucas de CoverSwap. Je n'arrive pas à vous joindre : répondez-moi ici avec un moment qui vous arrange, ou dites-moi simplement si le projet n'est plus d'actualité.");
    assert.equal(texte("A_RAPPELER"), "Merci pour votre réponse ! C'est noté, je vous rappelle {quand}. À très vite, Lucas de CoverSwap.");
    assert.equal(texte("LIEN_ESPACE"), "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. {lien}");
    assert.equal(texte("LIEN_ESPACE_SIMULATION"), "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel, avec la suite de votre projet : {lien}");
    assert.equal(texte("INJOIGNABLE_LIEN"), "Bonjour {prenom}, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet. Votre espace personnel est prêt, vous pouvez y déposer quelques photos quand vous voulez : {lien}");
    assert.equal(texte("LIEN_ESPACE_RAPPEL"), "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : {lien}");
    assert.equal(texte("LIEN_ESPACE_NOUVEAU"), "Bonjour {prenom}, c'est Lucas de CoverSwap. Voici le nouveau lien de votre espace, l'ancien ne fonctionne plus : {lien}");
    assert.equal(texte("SIMULATION_PRETE"), "Bonjour {prenom}, c'est Lucas de CoverSwap. Votre simulation est en ligne dans votre espace, dites-moi ce que vous en pensez : {lien}");
    assert.equal(texte("RELANCE_DEVIS_1"), "Bonjour, c'est Lucas de CoverSwap. Avez-vous pu regarder votre devis ? Il est toujours dans votre espace client. Je reste disponible si vous avez des questions.");
    assert.equal(texte("RELANCE_DEVIS_2"), "Bonjour, c'est Lucas de CoverSwap. Je reviens vers vous pour votre devis : s'il vous reste une question ou si le projet n'est plus d'actualité, dites-le-moi simplement.");
    assert.equal(texte("ACCUSE_RECEPTION"), "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dans les prochaines minutes. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.");
    assert.equal(texte("ACCUSE_RECEPTION_HORS_HORAIRES"), "Bonjour {prenom}, Lucas de CoverSwap. Merci pour votre demande, je vous appelle dès demain matin. Ce numéro sert à nos échanges par SMS. STOP pour ne plus en recevoir.");
    assert.equal(catalogue.definitionSms("DEVIS_PRET"), null, "archivé, hors du catalogue");
    assert.equal(catalogue.definitionSms("MERCI_ACCORD"), null);
    const groupes = catalogue.CATALOGUE_SMS.map((d) => d.groupe).filter((g, i, tous) => tous.indexOf(g) === i);
    // Mission 14 (partie 6) : l'ancien circuit de relances est retiré du catalogue (modèles archivés).
    assert.deepEqual(groupes, ["AUTOMATIQUES", "APRES_APPEL", "ESPACE", "RELANCES"]);
    for (const code of ["INJOIGNABLE_J3", "RELANCE_PHOTOS", "RELANCE_SIMULATION", "RELANCE_DEVIS", "RELANCE_DEVIS_QUESTIONS", "RELANCE_DERNIERE"]) assert.equal(catalogue.definitionSms(code), null, code);
    assert.deepEqual(catalogue.CATALOGUE_SMS.filter((d) => d.automatique).map((d) => d.code), ["ACCUSE_RECEPTION", "ACCUSE_RECEPTION_HORS_HORAIRES"]);
  });

  test("règles d'écriture : le lien en fin de message, jamais de simulation promise ni de « pièce »", () => {
    for (const d of catalogue.CATALOGUE_SMS) {
      // Chaque texte de départ passe sa propre validation : « Revenir au texte de départ » s'enregistre.
      assert.equal(catalogue.verifierTexteSms(d.code, d.defaut), null, `${d.code} respecte ses propres règles`);
      if (d.lien) assert.ok(d.defaut.endsWith("{lien}"), `${d.code} finit par {lien}`);
      else assert.doesNotMatch(d.defaut, /\{lien\}/, `${d.code} n'a pas de lien`);
      assert.doesNotMatch(d.defaut, /je vous prépare|je vous envoie une simulation/i, `${d.code} ne promet pas de simulation`);
      assert.doesNotMatch(d.defaut, /pièce/i, `${d.code} parle du projet, pas de la pièce`);
    }
    assert.deepEqual([...catalogue.CODES_LIEN_ESPACE], ["LIEN_ESPACE", "LIEN_ESPACE_SIMULATION", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "LIEN_ESPACE_NOUVEAU", "SIMULATION_PRETE"]);
    for (const code of catalogue.CODES_LIEN_ESPACE) assert.equal(catalogue.definitionSms(code)?.lien, true);

    // Toute accolade doit être une variable exacte du code : « {prénom} » partirait tel quel chez le client.
    assert.equal(catalogue.verifierTexteSms("PAS_DE_REPONSE", "Bonjour {prénom}, je vous rappelle {quand}."), "Variable non permise : {prénom}. Celles de ce message : {prenom}, {quand}.");
    assert.match(catalogue.verifierTexteSms("LIEN_ESPACE", "Bonjour { prenom }, votre espace : {lien}") ?? "", /Variable non permise : \{ prenom \}/);
    // Le lien se lit sur le texte ; seuls les accusés ont un interrupteur (l'ancien circuit est retiré, partie 6).
    assert.equal(catalogue.porteLienEspace("Votre espace : https://coverswap.fr/e/AB12CD-xyz"), true);
    assert.equal(catalogue.porteLienEspace("Je vous rappelle demain vers 18 h."), false);
    assert.deepEqual(catalogue.CATALOGUE_SMS.filter((d) => catalogue.aUnInterrupteur(d)).map((d) => d.code), ["ACCUSE_RECEPTION", "ACCUSE_RECEPTION_HORS_HORAIRES"]);
  });

  test("texteDuCatalogue : le texte de départ sans ligne, le texte modifié en base, « Bonjour, » sans prénom", async () => {
    // Plus de ligne pour ce code (renommée, rien ne se supprime) : le texte de départ.
    await prisma.modeleSms.update({ where: { code: "RELANCE_DEVIS_2" }, data: { code: "ESSAI_RELANCE_DEVIS_2_SANS_LIGNE" } });
    assert.equal(await modeles.texteDuCatalogue("RELANCE_DEVIS_2"), catalogue.definitionSms("RELANCE_DEVIS_2")!.defaut);

    const rappel = await modele("LIEN_ESPACE_RAPPEL");
    await modeles.modifierModele(rappel.id, { texte: "Bonjour {prenom}, votre espace : {lien}" });
    assert.equal(await modeles.texteDuCatalogue("LIEN_ESPACE_RAPPEL", { prenom: "Zoé", lien: "https://coverswap.fr/e/abc" }), "Bonjour Zoé, votre espace : https://coverswap.fr/e/abc");
    // Une ancienne coupure (l'écran d'avant la proposait partout) ne fait pas revenir au texte de départ.
    await prisma.modeleSms.update({ where: { id: rappel.id }, data: { actif: false } });
    assert.equal(await modeles.texteDuCatalogue("LIEN_ESPACE_RAPPEL", { prenom: "Zoé", lien: "https://coverswap.fr/e/abc" }), "Bonjour Zoé, votre espace : https://coverswap.fr/e/abc");
    await prisma.modeleSms.update({ where: { id: rappel.id }, data: { actif: true } });
    await modeles.modifierModele(rappel.id, { texte: catalogue.definitionSms("LIEN_ESPACE_RAPPEL")!.defaut });

    assert.equal(await modeles.texteDuCatalogue("LIEN_ESPACE", { prenom: "", lien: "https://coverswap.fr/e/abc" }), "Bonjour, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. https://coverswap.fr/e/abc");
    assert.equal(await modeles.texteDuCatalogue("A_RAPPELER", { quand: "prochainement" }), "Merci pour votre réponse ! C'est noté, je vous rappelle prochainement. À très vite, Lucas de CoverSwap.");
    await assert.rejects(modeles.texteDuCatalogue("DEVIS_PRET"), /Code SMS inconnu/);
  });

  test("modifierModele refuse un lien au milieu, un lien sur un code sans lien, une variable étrangère ; accepte le lien en fin", async () => {
    const lienEspaceModele = await modele("LIEN_ESPACE");
    await assert.rejects(modeles.modifierModele(lienEspaceModele.id, { texte: "Bonjour {prenom}, voici {lien} votre espace." }), /Le lien doit rester à la fin du message\./);
    await assert.rejects(modeles.modifierModele(lienEspaceModele.id, { texte: "Bonjour {prenom}, votre espace est prêt." }), /Le lien doit rester à la fin du message\./);
    const accepte = await modeles.modifierModele(lienEspaceModele.id, { texte: "Bonjour {prenom}, voici votre espace pour votre projet : {lien}  " });
    assert.equal(accepte.texte, "Bonjour {prenom}, voici votre espace pour votre projet : {lien}");
    await modeles.modifierModele(lienEspaceModele.id, { texte: catalogue.definitionSms("LIEN_ESPACE")!.defaut });

    const pasDeReponse = await modele("PAS_DE_REPONSE");
    await assert.rejects(modeles.modifierModele(pasDeReponse.id, { texte: "Je vous rappelle {quand} : {lien}" }), /ne porte pas le lien de l'espace : retire \{lien\}/);
    await assert.rejects(modeles.modifierModele(pasDeReponse.id, { texte: "Je vous rappelle {quand}, devis de {montant}." }), /Variable non permise : \{montant\}\. Celles de ce message : \{prenom\}, \{quand\}\./);
    await assert.rejects(modeles.modifierModele(pasDeReponse.id, { texte: "Bonjour {prénom}, je vous rappelle {quand}." }), /Variable non permise : \{prénom\}/);
    // L'interrupteur seul (les accusés) ne passe pas par la règle du texte (l'ancien circuit est retiré, partie 6).
    const accuse = await modele("ACCUSE_RECEPTION_HORS_HORAIRES");
    assert.equal((await modeles.modifierModele(accuse.id, { actif: false })).actif, false);
    assert.equal((await modeles.modifierModele(accuse.id, { actif: true })).actif, true);
  });

  test("listerCatalogue : l'ordre du catalogue, le texte en base, sans les codes archivés", async () => {
    const liste = await modeles.listerCatalogue();
    assert.deepEqual(liste.map((m) => m.code), catalogue.CATALOGUE_SMS.map((d) => d.code));
    const lien = liste.find((m) => m.code === "LIEN_ESPACE")!;
    assert.ok(lien.id);
    assert.equal(lien.texte, catalogue.definitionSms("LIEN_ESPACE")!.defaut);
    assert.deepEqual(lien.variables, ["prenom", "lien"]);
    assert.equal(liste.find((m) => m.code === "RELANCE_DEVIS_2")!.id, null, "sans ligne en base (renommée plus haut) : affiché, non modifiable");
  });
});

describe("quandLisible : le moment du rappel, dit au client (heure de Paris)", () => {
  test("été : aujourd'hui, ce soir, demain, un jour de la semaine, une date, les minutes", () => {
    const q = (jours: number, heure: number, minute = 0) => quand.quandLisible(quand.aHeureParis(MERCREDI, jours, heure, minute), MERCREDI);
    assert.equal(q(0, 14), "aujourd'hui vers 14 h");
    assert.equal(q(0, 18), "ce soir vers 18 h");
    assert.equal(q(0, 20, 30), "ce soir vers 20 h 30");
    assert.equal(q(1, 18), "demain vers 18 h");
    assert.equal(q(1, 10, 30), "demain vers 10 h 30");
    assert.equal(q(1, 9, 5), "demain vers 9 h 05");
    assert.equal(q(2, 10), "vendredi vers 10 h");
    assert.equal(q(6, 9), "mardi vers 9 h");
    assert.equal(q(7, 10), "le 7 octobre vers 10 h");
    assert.equal(q(12, 10), "le 12 octobre vers 10 h");
    assert.equal(q(32, 9), "le 1er novembre vers 9 h");
    assert.equal(quand.quandLisible(null, MERCREDI), "prochainement");
    assert.equal(q(-1, 10), "prochainement", "un jour déjà passé");
    assert.equal(quand.quandLisible(new Date("2026-10-01T08:00:00Z"), LUNDI), "jeudi vers 10 h");
  });

  test("hiver et changement d'heure : le jour se compte au calendrier de Paris", () => {
    assert.equal(quand.quandLisible(new Date("2026-12-03T09:00:00Z"), HIVER), "jeudi vers 10 h");
    assert.equal(quand.quandLisible(new Date("2026-12-01T17:00:00Z"), HIVER), "ce soir vers 18 h");
    assert.equal(quand.quandLisible(new Date("2026-12-01T23:30:00Z"), HIVER), "demain vers 0 h 30", "00 h 30 à Paris, le lendemain");
    assert.equal(quand.quandLisible(quand.aHeureParis(HIVER, 1, 18), HIVER), "demain vers 18 h");
    // Samedi 24 octobre, 22 h (été) : demain 18 h est déjà l'heure d'hiver.
    const samedi = new Date("2026-10-24T20:00:00Z");
    assert.equal(quand.aHeureParis(samedi, 1, 18).toISOString(), "2026-10-25T17:00:00.000Z");
    assert.equal(quand.quandLisible(quand.aHeureParis(samedi, 1, 18), samedi), "demain vers 18 h");
  });
});

describe("proposerSms : le SMS prérempli selon l'action et la source du lead", () => {
  test("pas de réponse : lead Meta au 1er appel → PAS_DE_REPONSE, « demain vers 18 h » ; rien n'est écrit", async () => {
    const meta = await lead("Anouk", { tentatives: 1 });
    const p = await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: meta.id }, MERCREDI);
    assert.equal(p.code, "PAS_DE_REPONSE");
    assert.equal(p.texte, "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle demain vers 18 h, ou dites-moi le moment qui vous arrange.");
    assert.deepEqual([p.nom, p.prenom, p.telephone, p.leadId, p.dossierId, p.lien], ["Anouk Cinq", "Anouk", meta.telephone, meta.id, null, undefined]);
    const date = await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: meta.id, rappelLe: quand.aHeureParis(MERCREDI, 2, 10).toISOString() }, MERCREDI);
    assert.match(date.texte, /Je vous rappelle vendredi vers 10 h, ou dites-moi/);
    assert.equal(await prisma.interaction.count({ where: { leadId: meta.id } }), 0, "proposer n'écrit rien");
  });

  test("lead du simulateur → la variante « simulation » ; 2ᵉ tentative → D", async () => {
    const site = await lead("Basile", { source: "SITE_SIMULATEUR", tentatives: 1 });
    const a = await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: site.id }, MERCREDI);
    assert.equal(a.code, "PAS_DE_REPONSE_SIMULATION");
    assert.match(a.texte, /au sujet de votre simulation\. Je vous rappelle demain vers 18 h/);
    // Un lead Meta qui a une simulation sur sa fiche est aussi « venu d'une simulation » (estIssuDuSimulateur).
    const avecSimulation = await lead("Capucine", { tentatives: 1 });
    await prisma.simulation.create({ data: { leadId: avecSimulation.id } });
    assert.equal((await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: avecSimulation.id }, MERCREDI)).code, "PAS_DE_REPONSE_SIMULATION");

    const deuxieme = await lead("Dorian", { tentatives: 2 });
    const d = await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: deuxieme.id }, MERCREDI);
    assert.equal(d.code, "PAS_DE_REPONSE_2");
    assert.match(d.texte, /^Bonjour, c'est encore Lucas de CoverSwap\. Je n'arrive pas à vous joindre/);
    assert.equal((await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: site.id, tentatives: 3 }, MERCREDI)).code, "PAS_DE_REPONSE_2", "les tentatives données par la fin d'appel l'emportent");
  });

  test("à rappeler : sans date « prochainement », jeudi 10 h « jeudi vers 10 h »", async () => {
    const l = await lead("Eloi");
    const sans = await proposition.proposerSms({ action: "A_RAPPELER", leadId: l.id }, LUNDI);
    assert.equal(sans.code, "A_RAPPELER");
    assert.equal(sans.texte, "Merci pour votre réponse ! C'est noté, je vous rappelle prochainement. À très vite, Lucas de CoverSwap.");
    const jeudi = await proposition.proposerSms({ action: "A_RAPPELER", leadId: l.id, rappelLe: "2026-10-01T08:00:00.000Z" }, LUNDI);
    assert.equal(jeudi.texte, "Merci pour votre réponse ! C'est noté, je vous rappelle jeudi vers 10 h. À très vite, Lucas de CoverSwap.");
  });

  test("intéressé : LIEN_ESPACE_SIMULATION seulement si sa simulation est déjà dans l'espace ; espace ouvert, aucun événement de SMS écrit", async () => {
    // Venu du simulateur, mais sans rendu arrivé (le webhook crée une simulation sans image) : rien dans l'espace.
    const sansRendu = await lead("Faustine", { source: "SITE_SIMULATEUR" });
    await prisma.simulation.create({ data: { leadId: sansRendu.id, source: "SITE_SIMULATEUR" } });
    const p = await proposition.proposerSms({ action: "INTERESSE", leadId: sansRendu.id }, MERCREDI);
    assert.equal(p.code, "LIEN_ESPACE", "« votre simulation vous attend » serait faux");
    assert.match(p.lien ?? "", LIEN);
    assert.equal(p.texte, `Bonjour Faustine, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. ${p.lien}`);
    assert.ok(p.dossierId, "le dossier et l'espace sont ouverts");
    assert.ok(await prisma.espaceClient.findUnique({ where: { dossierId: p.dossierId! } }));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: p.dossierId!, type: { in: ["SMS_COPIE", "ESPACE_LIEN_COMMUNIQUE"] } } }), 0);
    assert.equal(await prisma.interaction.count({ where: { leadId: sansRendu.id, type: "SMS" } }), 0);

    // Sa simulation du site, avec son rendu, est rangée dans le dossier (donc dans son espace) : la variante.
    const c = await contact("Fleur", { source: "SITE_SIMULATEUR" });
    await prisma.simulation.create({ data: { leadId: c.leadId, dossierId: c.dossierId, source: "SITE_SIMULATEUR", imageAfterPath: "essai/rendu.png", rangeeLe: new Date() } });
    const s = await proposition.proposerSms({ action: "INTERESSE", leadId: c.leadId }, MERCREDI);
    assert.equal(s.code, "LIEN_ESPACE_SIMULATION");
    assert.equal(s.texte, `Bonjour Fleur, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel, avec la suite de votre projet : ${s.lien}`);
    assert.equal((await proposition.proposerSms({ action: "INTERESSE", leadId: (await lead("Gaspard")).id }, MERCREDI)).code, "LIEN_ESPACE", "lead Meta");
  });

  test("le prénom et le nom : la fiche client d'abord, jamais « Inconnu » — la même règle que « lien_espace »", async () => {
    const c = await contact("Inconnu", { nom: "Garnier" });
    const d = await dossierDe(c.dossierId);
    await prisma.client.update({ where: { id: d.clientId! }, data: { prenom: "Camille" } });
    const p = await proposition.proposerSms({ action: "LIEN_ESPACE", leadId: c.leadId }, MERCREDI);
    assert.deepEqual([p.prenom, p.nom], ["Camille", "Garnier"]);
    assert.match(p.texte, /^Bonjour Camille, c'est Lucas de CoverSwap\./);
    const assistant = await lienEspace.proposerLienParSms({ dossierId: c.dossierId, code: "LIEN_ESPACE" });
    assert.equal(assistant.prenom, "Camille");
    assert.equal(assistant.sms, p.texte);
    // Personne ne sait son prénom : « Bonjour, », et l'en-tête garde son nom.
    const anonyme = await lead("Inconnu", { nom: "Inconnu" });
    const a = await proposition.proposerSms({ action: "PAS_DE_REPONSE", leadId: anonyme.id }, MERCREDI);
    assert.deepEqual([a.prenom, a.nom], ["", "Contact sans nom"]);
  });

  test("« SMS avec le lien » : le premier lien, puis « à nouveau » une fois copié, puis le nouveau lien après « Nouveau lien »", async () => {
    const c = await contact("Hortense");
    const premier = await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: c.dossierId }, MERCREDI);
    assert.equal(premier.code, "LIEN_ESPACE");
    await copie.noterSmsCopie({ code: premier.code, texte: premier.texte, dossierId: c.dossierId, origine: "ECRAN" });
    const ensuite = await proposition.proposerSms({ action: "ENVOYER_LIEN", leadId: c.leadId }, MERCREDI);
    assert.equal(ensuite.code, "LIEN_ESPACE_RAPPEL");
    assert.equal(ensuite.dossierId, c.dossierId, "le dossier vivant du lead");
    assert.equal(ensuite.texte, `Bonjour Hortense, c'est Lucas de CoverSwap. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : ${ensuite.lien}`);
    assert.equal((await proposition.proposerSms({ action: "RELANCE_PHOTOS", dossierId: c.dossierId }, MERCREDI)).code, "LIEN_ESPACE_RAPPEL");
    assert.equal((await proposition.proposerSms({ action: "INJOIGNABLE_LIEN", dossierId: c.dossierId }, MERCREDI)).code, "INJOIGNABLE_LIEN");

    // « Nouveau lien » : l'ancien lien est mort, le SMS le dit ; une fois le nouveau copié, « à nouveau ».
    const projet = await prisma.espaceClient.findUniqueOrThrow({ where: { dossierId: c.dossierId } });
    await liens.renouvelerEspace(projet.permanentId!);
    const nouveau = await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: c.dossierId }, MERCREDI);
    assert.equal(nouveau.code, "LIEN_ESPACE_NOUVEAU");
    assert.notEqual(nouveau.lien, ensuite.lien);
    assert.equal(nouveau.texte, `Bonjour Hortense, c'est Lucas de CoverSwap. Voici le nouveau lien de votre espace, l'ancien ne fonctionne plus : ${nouveau.lien}`);
    await copie.noterSmsCopie({ code: nouveau.code, texte: nouveau.texte, dossierId: c.dossierId, origine: "ECRAN" });
    assert.equal((await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: c.dossierId }, MERCREDI)).code, "LIEN_ESPACE_RAPPEL");
  });

  test("« SMS avec le lien » : ouvert par le client → « à nouveau » ; ouvert seulement avant « Nouveau lien » → le nouveau lien", async () => {
    const c = await contact("Octave");
    const projet = await prisma.espaceClient.findUniqueOrThrow({ where: { dossierId: c.dossierId } });
    const avantHier = new Date(Date.now() - 2 * JOUR);
    const hier = new Date(Date.now() - JOUR);
    await prisma.espacePermanent.update({ where: { id: projet.permanentId! }, data: { lienEmisLe: avantHier, premierAccesLe: hier, dernierAccesLe: hier, nbAcces: 1 } });
    assert.equal((await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: c.dossierId }, MERCREDI)).code, "LIEN_ESPACE_RAPPEL", "le lien lui a été donné autrement : il l'a ouvert");
    await liens.renouvelerEspace(projet.permanentId!);
    assert.equal((await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: c.dossierId }, MERCREDI)).code, "LIEN_ESPACE_NOUVEAU");
  });

  test("relance de devis : 1 puis 2, seulement pour un devis que le client attend dans son espace, du dossier visé", async () => {
    const c = await contact("Ulysse");
    const devis = (numero: string, donnees: Record<string, unknown> = {}) =>
      prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero, dateEmission: new Date(), objet: "Recouvrement de cuisine", lignes: "[]", totalHt: 1450, acomptePct: 30, statut: "ENVOYE", ...donnees } });
    const enAttente = await devis("D-P5-ULYSSE-1");
    const r1 = await proposition.proposerSms({ action: "RELANCE_DEVIS", relance: { documentId: enAttente.id, rang: 1 } }, MERCREDI);
    assert.deepEqual([r1.code, r1.dossierId, r1.relance], ["RELANCE_DEVIS_1", c.dossierId, { documentId: enAttente.id, rang: 1 }]);
    assert.equal((await proposition.proposerSms({ action: "RELANCE_DEVIS", dossierId: c.dossierId, relance: { documentId: enAttente.id, rang: 2 } }, MERCREDI)).code, "RELANCE_DEVIS_2");

    const relancer = (documentId: string, dossierId?: string) => proposition.proposerSms({ action: "RELANCE_DEVIS", dossierId, relance: { documentId, rang: 1 } }, MERCREDI);
    const brouillon = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", objet: "Brouillon", lignes: "[]", totalHt: 900 } });
    await assert.rejects(relancer(brouillon.id), /Ce devis n'attend pas de réponse du client/);
    await assert.rejects(relancer((await devis("D-P5-ULYSSE-2", { statut: "ACCEPTE" })).id), /Ce devis n'attend pas de réponse du client/);
    await assert.rejects(relancer((await devis("D-P5-ULYSSE-3", { visibleEspace: false })).id), /Ce devis n'est pas visible dans son espace\./);
    await assert.rejects(relancer((await devis("D-P5-ULYSSE-4", { archiveLe: new Date(), archiveMotif: "essai" })).id), /Ce devis est archivé/);
    await assert.rejects(relancer((await devis("F-P5-ULYSSE-5", { type: "FACTURE" })).id), /Devis introuvable/);
    const autre = await contact("Victor");
    await assert.rejects(relancer(enAttente.id, autre.dossierId), /Ce devis n'est pas celui de ce dossier\./);
  });
});

describe("copier vaut envoi : noterSmsCopie", () => {
  test("espace jamais ouvert : LIEN_ESPACE copié → SMS_COPIE, main au client, « Lien pas encore envoyé » tombe ; double copie → une trace", async () => {
    const c = await contact("Ines");
    assert.ok((await signaux(c.dossierId)).includes("NON_ENVOYE"));
    const p = await proposition.proposerSms({ action: "LIEN_ESPACE", dossierId: c.dossierId });
    const note = await copie.noterSmsCopie({ code: p.code, texte: p.texte, dossierId: c.dossierId, origine: "ECRAN" });
    assert.deepEqual([note.cible, note.deja, note.lien], ["DOSSIER", false, true]);
    const evenement = await prisma.dossierEvenement.findUniqueOrThrow({ where: { id: note.id } });
    assert.deepEqual([evenement.type, evenement.direction], ["SMS_COPIE", "SORTANT"]);
    assert.equal(evenement.contenu, `SMS LIEN_ESPACE copié : « ${p.texte} »`);
    assert.deepEqual(JSON.parse(evenement.metadata), { code: "LIEN_ESPACE", texte: p.texte, canal: "SMS", origine: "ECRAN" });
    const d = await dossierDe(c.dossierId);
    assert.deepEqual([d.main, d.mainMotif], ["CLIENT", "Lien de son espace envoyé : en attente du client"]);
    const ligne = await ligneEspace(c.dossierId);
    assert.ok(!ligne.signaux.some((s) => s.code === "NON_ENVOYE"));
    assert.ok(ligne.lienEnvoyeLe);
    // Toujours pas ouvert trois jours plus tard : « Lien jamais ouvert » peut se déclencher.
    assert.ok((await signaux(c.dossierId, new Date(Date.now() + 3 * JOUR))).includes("JAMAIS_OUVERT"));

    const encore = await copie.noterSmsCopie({ code: p.code, texte: `  ${p.texte}\n`, dossierId: c.dossierId, origine: "ECRAN" });
    assert.deepEqual([encore.deja, encore.id], [true, note.id]);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "SMS_COPIE" } }), 1);
    // Onze minutes plus tard, c'est un nouvel envoi.
    const plusTard = await copie.noterSmsCopie({ code: p.code, texte: p.texte, dossierId: c.dossierId, origine: "ECRAN" }, new Date(Date.now() + 11 * 60_000));
    assert.equal(plusTard.deja, false);
  });

  test("un SMS copié sans lien : trace seulement ; il répond au message du client qui attendait (R2) ; relance gardée dans la trace", async () => {
    const c = await contact("Jules");
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "ESPACE_MESSAGE", direction: "ENTRANT", contenu: "Message du client : pouvez-vous me rappeler ?" } });
    await main.recalculerMain(c.dossierId);
    assert.equal((await dossierDe(c.dossierId)).mainMotif, `Répondre à ${c.nom}`);
    const note = await copie.noterSmsCopie({ code: "A_RAPPELER", texte: "Merci pour votre réponse ! C'est noté, je vous rappelle demain vers 18 h. À très vite, Lucas de CoverSwap.", leadId: c.leadId, origine: "ECRAN" });
    assert.deepEqual([note.cible, note.dossierId, note.lien], ["DOSSIER", c.dossierId, false]);
    const d = await dossierDe(c.dossierId);
    assert.equal(main.estMotifRepondre(d.mainMotif), false, "le SMS copié a répondu");

    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-P5-JULES-1", dateEmission: new Date(), objet: "Recouvrement de cuisine", lignes: "[]", totalHt: 1450, acomptePct: 30, statut: "ENVOYE" } });
    const texteRelance = catalogue.definitionSms("RELANCE_DEVIS_1")!.defaut;
    const relance = await copie.noterSmsCopie({ code: "RELANCE_DEVIS_1", texte: texteRelance, dossierId: c.dossierId, relance: { documentId: devis.id, rang: 1 }, origine: "ASSISTANT" });
    const meta = JSON.parse((await prisma.dossierEvenement.findUniqueOrThrow({ where: { id: relance.id } })).metadata);
    assert.deepEqual([meta.code, meta.origine, meta.relance], ["RELANCE_DEVIS_1", "ASSISTANT", { documentId: devis.id, rang: 1 }]);
    // Une relance ne se compte que sur un vrai devis en attente, de ce dossier.
    await assert.rejects(copie.noterSmsCopie({ code: "RELANCE_DEVIS_2", texte: texteRelance, dossierId: c.dossierId, relance: { documentId: "devis-inconnu", rang: 2 }, origine: "ECRAN" }), /Devis introuvable/);
    await assert.rejects(copie.noterSmsCopie({ code: "RELANCE_DEVIS_1", texte: texteRelance, leadId: (await lead("Yann")).id, relance: { documentId: devis.id, rang: 1 }, origine: "ECRAN" }), /se note sur son dossier/);
  });

  test("le lien se lit sur le texte : un texte libre qui le porte passe la main au client ; un code de lien sans le lien, non", async () => {
    const libre = await contact("Pia");
    const lienPia = (await proposition.proposerSms({ action: "ENVOYER_LIEN", dossierId: libre.dossierId })).lien!;
    const note = await copie.noterSmsCopie({ code: "LIBRE", texte: `Voici votre espace, comme promis : ${lienPia}`, dossierId: libre.dossierId, origine: "ASSISTANT" });
    assert.equal(note.lien, true);
    assert.deepEqual([(await dossierDe(libre.dossierId)).main, (await dossierDe(libre.dossierId)).mainMotif], ["CLIENT", "Lien de son espace envoyé : en attente du client"]);
    assert.ok(!(await signaux(libre.dossierId)).includes("NON_ENVOYE"));

    const sansLien = await contact("Quentin");
    const retire = await copie.noterSmsCopie({ code: "LIEN_ESPACE", texte: "Bonjour Quentin, c'est Lucas de CoverSwap. Je vous envoie le lien de votre espace dans un instant.", dossierId: sansLien.dossierId, origine: "ECRAN" });
    assert.equal(retire.lien, false);
    assert.notEqual((await dossierDe(sansLien.dossierId)).mainMotif, "Lien de son espace envoyé : en attente du client");
    assert.ok((await signaux(sansLien.dossierId)).includes("NON_ENVOYE"), "le lien n'est pas parti");
  });

  test("lead sans dossier → échange SMS sur le lead, une seule fois ; LIBRE accepté par la route, un code inconnu refusé", async () => {
    const l = await lead("Kylian");
    const texte = "Bonjour, c'est Lucas de CoverSwap. J'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle demain vers 18 h, ou dites-moi le moment qui vous arrange.";
    const a = await copie.noterSmsCopie({ code: "PAS_DE_REPONSE", texte, leadId: l.id, origine: "ECRAN" });
    const b = await copie.noterSmsCopie({ code: "PAS_DE_REPONSE", texte, leadId: l.id, origine: "ECRAN" });
    assert.deepEqual([a.cible, a.dossierId, b.deja, b.id], ["CONTACT", null, true, a.id]);
    const echanges = await prisma.interaction.findMany({ where: { leadId: l.id, type: "SMS" } });
    assert.deepEqual(echanges.map((e) => e.contenu), [`SMS PAS_DE_REPONSE copié : « ${texte} »`]);

    const { POST } = await import("@/app/api/sms/copie/route");
    const requete = (corps: unknown) => new NextRequest("http://localhost/api/sms/copie", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) });
    const libre = await POST(requete({ code: "LIBRE", texte: "Je passe demain matin vers 9 h, ça vous va ?", leadId: l.id }));
    assert.equal(libre.status, 200);
    assert.equal(((await libre.json()) as { copie: { cible: string } }).copie.cible, "CONTACT");
    assert.ok(await prisma.interaction.findFirst({ where: { leadId: l.id, type: "SMS", contenu: "SMS copié : « Je passe demain matin vers 9 h, ça vous va ? »" } }));
    const inconnu = await POST(requete({ code: "DEVIS_PRET", texte: "…", leadId: l.id }));
    assert.equal(inconnu.status, 400);
    assert.match(((await inconnu.json()) as { error: string }).error, /Code SMS inconnu/);
    const vide = await POST(requete({ code: "LIBRE", texte: "   ", leadId: l.id }));
    assert.equal(vide.status, 400);
  });

  test("la route de proposition rend le SMS prérempli", async () => {
    const l = await lead("Lison", { tentatives: 1 });
    const { POST } = await import("@/app/api/sms/proposition/route");
    const reponse = await POST(new NextRequest("http://localhost/api/sms/proposition", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "A_RAPPELER", leadId: l.id }) }));
    assert.equal(reponse.status, 200);
    const { proposition: p } = (await reponse.json()) as { proposition: { code: string; texte: string; nom: string } };
    assert.deepEqual([p.code, p.nom], ["A_RAPPELER", "Lison Cinq"]);
    assert.match(p.texte, /je vous rappelle prochainement\./);
  });
});

describe("rapatriement : plus aucun texte SMS en dur", () => {
  test("« lien_espace » (assistant) compose depuis le catalogue ; son lien communiqué fait tomber « Lien pas encore envoyé »", async () => {
    // Venu du simulateur, sans simulation dans son espace : le premier lien ordinaire (comme avant cette partie).
    const site = await lead("Mael", { source: "SITE_SIMULATEUR" });
    const p = await lienEspace.proposerLienParSms({ leadId: site.id, code: "LIEN_ESPACE" });
    assert.equal(p.code, "LIEN_ESPACE");
    assert.equal(p.sms, `Bonjour Mael, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. ${p.lien}`);
    assert.ok(!(await signaux(p.dossierId)).includes("NON_ENVOYE"), "ESPACE_LIEN_COMMUNIQUE compte comme lien envoyé");
    const injoignable = await lienEspace.proposerLienParSms({ dossierId: p.dossierId, code: "INJOIGNABLE_LIEN" });
    assert.match(injoignable.sms, /^Bonjour Mael, c'est Lucas de CoverSwap\. J'ai essayé de vous joindre au sujet de votre projet\./);
    // Sa simulation rangée avec son rendu : la variante, comme sur l'écran SMS.
    await prisma.simulation.create({ data: { leadId: site.id, dossierId: p.dossierId, source: "SITE_SIMULATEUR", imageAfterPath: "essai/rendu-mael.png", rangeeLe: new Date() } });
    const variante = await lienEspace.proposerLienParSms({ dossierId: p.dossierId, code: "LIEN_ESPACE" });
    assert.equal(variante.code, "LIEN_ESPACE_SIMULATION");
    assert.equal(variante.sms, `Bonjour Mael, c'est Lucas de CoverSwap. Comme convenu, votre simulation vous attend dans votre espace personnel, avec la suite de votre projet : ${variante.lien}`);
  });

  test("nouveau lien (LIEN_ESPACE_NOUVEAU) et simulation en ligne (SIMULATION_PRETE) lisent le catalogue", async () => {
    const c = await contact("Nora");
    const d = await dossierDe(c.dossierId);
    assert.equal((await gestion.espaceDuClient(d.clientId!)).smsNouveauLien, "Bonjour Nora, c'est Lucas de CoverSwap. Voici le nouveau lien de votre espace, l'ancien ne fonctionne plus : {lien}");
    const publication = await simulations.texteSmsPublication(c.dossierId);
    assert.match(publication.texte ?? "", /^Bonjour Nora, c'est Lucas de CoverSwap\. Votre simulation est en ligne dans votre espace, dites-moi ce que vous en pensez : https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+$/);
  });
});

describe("migration catalogue-sms-14-5", () => {
  test("textes de l'espace réécrits (le journal garde l'ancien), code manquant posé, coupures sans interrupteur levées, DEVIS_PRET et MERCI_ACCORD archivés, rejouable", async () => {
    const ancien = "Bonjour {prenom}, c'est Lucas de CoverSwap. Comme convenu, voici votre espace personnel pour déposer 2 ou 3 photos : {lien} Je vous prépare une simulation dès que je les ai.";
    for (const code of ["LIEN_ESPACE", "LIEN_ESPACE_SIMULATION", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "SIMULATION_PRETE"]) await prisma.modeleSms.update({ where: { code }, data: { texte: code === "LIEN_ESPACE" ? ancien : `Ancien texte de ${code} : {lien} Lucas, CoverSwap` } });
    // L'ancien circuit (retiré du catalogue à la partie 6) tel qu'il était en base : cette migration n'y touche pas.
    await prisma.modeleSms.create({ data: { code: "RELANCE_PHOTOS", libelle: "Relance J+2 : photos non déposées", texte: "Texte retouché par Lucas : {lien}", ordre: 30 } });
    await prisma.modeleSms.create({ data: { code: "RELANCE_DERNIERE", libelle: "Dernière relance J+10", texte: "Bonjour {prenom}, dernier message : {lien}", ordre: 31 } });
    // Coupés par l'écran d'avant : un code sans interrupteur est remis actif, l'ancien circuit garde sa coupure.
    for (const code of ["LIEN_ESPACE_NOUVEAU", "PAS_DE_REPONSE", "RELANCE_DERNIERE"]) await prisma.modeleSms.update({ where: { code }, data: { actif: false } });
    for (const [code, texte] of [["DEVIS_PRET", "Bonjour {prenom}, votre devis est dans votre espace : {lien}"], ["MERCI_ACCORD", "Merci {prenom}, votre accord est bien enregistré !"]]) {
      await prisma.modeleSms.create({ data: { code, libelle: code, texte, ordre: 40 } });
    }
    assert.equal(await prisma.modeleSms.findUnique({ where: { code: "RELANCE_DEVIS_2" } }), null, "renommé plus haut : absent");

    const premier = await avecActeur(MIGRATION, () => migration.migrationCatalogueSms14.executer(prisma));
    assert.deepEqual(premier, { crees: 1, reecrits: 5, reactives: 2, archives: 2 });
    assert.deepEqual([(await modele("LIEN_ESPACE_NOUVEAU")).actif, (await modele("PAS_DE_REPONSE")).actif, (await modele("RELANCE_DERNIERE")).actif], [true, true, false]);
    await prisma.modeleSms.update({ where: { code: "RELANCE_DERNIERE" }, data: { actif: true } });
    for (const code of ["LIEN_ESPACE", "LIEN_ESPACE_SIMULATION", "INJOIGNABLE_LIEN", "LIEN_ESPACE_RAPPEL", "SIMULATION_PRETE", "RELANCE_DEVIS_2"]) assert.equal((await modele(code)).texte, catalogue.definitionSms(code)!.defaut, code);
    assert.equal((await modele("RELANCE_PHOTOS")).texte, "Texte retouché par Lucas : {lien}", "l'ancien circuit ne bouge pas");
    assert.equal((await modele("ACCUSE_RECEPTION")).texte, catalogue.definitionSms("ACCUSE_RECEPTION")!.defaut);
    for (const code of ["DEVIS_PRET", "MERCI_ACCORD"]) {
      const archive = await modele(code);
      assert.ok(archive.archiveLe, code);
      assert.equal(archive.archiveMotif, "Mission 14 : plus utilisé");
    }
    assert.equal(await modeles.lireModele("DEVIS_PRET"), null);
    const trace = await prisma.journalModification.findFirst({ where: { modele: "ModeleSms", enregistrementId: (await modele("LIEN_ESPACE")).id, acteur: MIGRATION.acteur }, orderBy: { horodatage: "desc" } });
    assert.match(trace?.avant ?? "", /Je vous prépare une simulation dès que je les ai\./, "le journal garde l'ancien texte");

    const second = await avecActeur(MIGRATION, () => migration.migrationCatalogueSms14.executer(prisma));
    assert.deepEqual(second, { crees: 0, reecrits: 0, reactives: 0, archives: 0 });
  });

  test("elle ne tourne qu'une fois : un texte modifié ensuite par Lucas n'est jamais écrasé ; inscrite à la fin, sous son nom définitif", async () => {
    assert.ok(await prisma.migrationDonnees.findUnique({ where: { nom: "catalogue-sms-14-5" } }), "passée au démarrage");
    const lienEspaceModele = await modele("LIEN_ESPACE");
    await modeles.modifierModele(lienEspaceModele.id, { texte: "Bonjour {prenom}, voici votre espace : {lien}" });
    const { executerMigrationsDonnees } = await import("@/lib/base/preparation");
    assert.deepEqual(await executerMigrationsDonnees(), []);
    assert.equal((await modele("LIEN_ESPACE")).texte, "Bonjour {prenom}, voici votre espace : {lien}");
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    // Partie 6 : la migration « relances-un-circuit-14-6 » vient après elle.
    assert.ok(noms.indexOf("relances-un-circuit-14-6") > noms.indexOf("catalogue-sms-14-5"), noms.join(", "));
    assert.ok(noms.indexOf("catalogue-sms-14-5") > noms.indexOf("appels-des-leads-14-3") && noms.includes("appels-des-leads-14-3"), noms.join(", "));
  });
});
