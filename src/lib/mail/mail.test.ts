import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import type { EntreeTriMail } from "./tri";
import type { MessageSortant } from "./envoi";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mail-"));

/**
 * Mission 7 (22/09/2026) : l'onglet Mail. Ce qui est rangé sans que Lucas le
 * voie, ce qui reste sous ses yeux ; la garde qui empêche l'IA d'inventer un
 * prix ou une date ; les notifications de l'espace, parties une seule fois ;
 * les séquences, prêtes mais inactives, qui s'arrêtent d'elles-mêmes ; la
 * désinscription, définitive.
 */

let prisma: typeof import("@/lib/prisma").default;
let tri: typeof import("./tri");
let redaction: typeof import("./redaction");
let notifications: typeof import("./notifications");
let envoiCrm: typeof import("./envoi-crm");
let envoi: typeof import("./envoi");
let vues: typeof import("./vues");
let sequences: typeof import("./sequences");
let liens: typeof import("@/lib/espace/liens");
let main: typeof import("@/lib/dossiers/main");
let registre: typeof import("@/lib/taches/registre");
let boite: typeof import("./boite");

const envoyes: MessageSortant[] = [];
const JOUR = 86_400_000;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  delete process.env.ESPACE_CLIENT_SECRET;
  process.env.SITE_URL = "https://coverswap.fr";
  await (await import("@/lib/base/preparation")).preparerBase();
  tri = await import("./tri");
  redaction = await import("./redaction");
  notifications = await import("./notifications");
  envoiCrm = await import("./envoi-crm");
  envoi = await import("./envoi");
  vues = await import("./vues");
  sequences = await import("./sequences");
  liens = await import("@/lib/espace/liens");
  main = await import("@/lib/dossiers/main");
  registre = await import("@/lib/taches/registre");
  boite = await import("./boite");
  // Une boîte Gmail d'essai : chaque mail « parti » est noté ici, rien ne sort.
  envoi.definirEnvoyeurMailEssai({
    nom: "essai",
    envoyer: async (message) => {
      envoyes.push(message);
      return { identifiant: `gmail-${envoyes.length}`, fil: `fil-envoi-${envoyes.length}`, compte: "coverswap.contact@gmail.com" };
    },
  });
});

after(async () => {
  envoi.oublierEnvoyeurMailEssai();
  await prisma.$disconnect();
});

const entree = (partiel: Partial<EntreeTriMail>): EntreeTriMail => ({
  sens: "ENTRANT",
  de: "inconnu@exemple.fr",
  deNom: null,
  a: ["coverswap.contact@gmail.com"],
  compte: "coverswap.contact@gmail.com",
  objet: null,
  texte: null,
  entetes: {},
  libelles: ["INBOX"],
  pieces: [],
  regles: [],
  contact: null,
  filDUnContact: false,
  ...partiel,
});

describe("le tri de la boîte", () => {
  test("bruit rangé d'office : notifications techniques, plateformes, newsletters, confirmations", () => {
    const bruits: Partial<EntreeTriMail>[] = [
      { de: "notifications@railway.app", objet: "Deploy failed for crm-coverswap" },
      { de: "notifications@vercel.com", objet: "Deployment ready" },
      { de: "noreply@github.com", objet: "[coverswap] Run failed" },
      { de: "notification@facebookmail.com", objet: "Votre publicité a été approuvée" },
      { de: "ads-account-noreply@google.com", objet: "Recommandations pour votre compte Google Ads" },
      { de: "googlemapsplatform-noreply@google.com", objet: "[Legal Update] Google Maps Platform Terms" },
      { de: "workspace-noreply@google.com", objet: "Important : votre essai sans frais se termine" },
      { de: "no-reply@zapier.com", objet: "Your Zap has an error" },
      { de: "noreply@tm.openai.com", objet: "Your API usage" },
      { de: "news@magasin-bricolage.fr", objet: "-20 % sur la peinture", entetes: { "list-unsubscribe": "<mailto:stop@magasin-bricolage.fr>" }, libelles: ["INBOX", "CATEGORY_PROMOTIONS"] },
      { de: "noreply@boutique.fr", objet: "Confirmation de votre commande n° 1234" },
    ];
    for (const partiel of bruits) {
      const decision = tri.trierMail(entree(partiel));
      assert.deepEqual([decision.classe, decision.ranger], ["BRUIT", true], `${partiel.de} devrait être rangé (${decision.motif})`);
    }
  });

  test("administratif : organismes, banques, fournisseurs et partenaires — jamais rangé", () => {
    for (const de of ["ne-pas-repondre@urssaf.fr", "contact@fldtech.fr", "notifications@qonto.com", "service.client@axa.fr"]) {
      const decision = tri.trierMail(entree({ de, objet: "Votre échéancier" }));
      assert.deepEqual([decision.classe, decision.ranger], ["ADMINISTRATIF", false], `${de} (${decision.motif})`);
    }
    // La facture d'une plateforme est une pièce comptable : visible en Administratif, pas rangée avec ses notifications.
    const facture = tri.trierMail(entree({ de: "ads-account-noreply@google.com", objet: "Votre facture Google Ads" }));
    assert.deepEqual([facture.classe, facture.ranger], ["ADMINISTRATIF", false]);
    const recu = tri.trierMail(entree({ de: "noreply@tm.openai.com", objet: "Your receipt", pieces: [{ typeMime: "application/pdf", nom: "Invoice-1234.pdf" }] }));
    assert.deepEqual([recu.classe, recu.ranger], ["ADMINISTRATIF", false]);
  });

  test("un inconnu qui demande un devis n'est jamais rangé — même depuis une adresse iCloud ou un formulaire", () => {
    const icloud = tri.trierMail(entree({ de: "marie.dupont@icloud.com", objet: "Demande", texte: "Bonjour, je souhaiterais un devis pour recouvrir les façades de ma cuisine." }));
    assert.deepEqual([icloud.classe, icloud.ranger, icloud.demandeClient], ["HUMAIN", false, true]);
    // Les adresses de particuliers chez un opérateur (orange.fr, free.fr, sfr.fr) sont des clients, pas de l'administratif.
    for (const de of ["sophie.garnier@orange.fr", "paul.roux@free.fr", "j.blanc@sfr.fr", "m.noir@wanadoo.fr", "l.vert@laposte.net"]) {
      const particulier = tri.trierMail(entree({ de, objet: "Rénovation salle de bain", texte: "Pourriez-vous me faire un devis pour mes meubles ?" }));
      assert.deepEqual([particulier.classe, particulier.ranger, particulier.demandeClient], ["HUMAIN", false, true], `${de} (${particulier.motif})`);
    }
    // … et leur facture d'opérateur reste de l'administratif, reconnue par l'objet.
    assert.equal(tri.trierMail(entree({ de: "no-reply@orange.fr", objet: "Votre facture Orange est disponible" })).classe, "ADMINISTRATIF");
    // Par un formulaire (adresse noreply) : visible, mais pas de lead d'office — l'expéditeur n'est pas la personne.
    const formulaire = tri.trierMail(entree({ de: "no-reply@formulaires.monsite.fr", objet: "Nouveau message", texte: "Nom : Paul. Message : combien pour la rénovation de ma salle de bain ?" }));
    assert.deepEqual([formulaire.classe, formulaire.ranger, formulaire.demandeClient], ["HUMAIN", false, false]);
    // Le site signale une demande perdue : toujours visible.
    const alerte = tri.trierMail(entree({ de: "alertes@resend.dev", objet: "🚨 CONTACT NON ENREGISTRÉ CRM" }));
    assert.equal(alerte.ranger, false);
    // Dans le doute, visible — y compris une personne qui écrit depuis Google (adresse Gmail ou Workspace).
    assert.equal(tri.trierMail(entree({ de: "jean@exemple.fr", objet: "Bonjour" })).ranger, false);
    assert.equal(tri.trierMail(entree({ de: "jean.dupont@google.com", objet: "Question" })).ranger, false);
  });

  test("un contact connu est dans Clients, même s'il écrit depuis un envoi de masse", () => {
    const decision = tri.trierMail(entree({ de: "alice@exemple.fr", entetes: { "list-unsubscribe": "<x>" }, contact: { type: "CLIENT", nom: "Alice Martin" } }));
    assert.deepEqual([decision.classe, decision.ranger], ["CLIENT", false]);
  });

  test("les décisions de Lucas passent avant tout ; « jamais rangé » l'emporte sur les signaux ; un envoi ne se range pas", () => {
    const masque = tri.trierMail(entree({ de: "prospectus@exemple.fr", regles: ["RANGER"] }));
    assert.deepEqual([masque.classe, masque.ranger, masque.par], ["BRUIT", true, "REGLE"]);
    const remonte = tri.trierMail(entree({ de: "notifications@railway.app", regles: ["NE_JAMAIS_RANGER"] }));
    assert.equal(remonte.ranger, false);
    assert.equal(tri.trierMail(entree({ sens: "SORTANT", de: "coverswap.contact@gmail.com", a: ["qui@exemple.fr"] })).ranger, false);
    assert.deepEqual(tri.ciblesDe(" Alice@Exemple.fr "), ["alice@exemple.fr", "@exemple.fr"]);
  });
});

describe("Gmail suit le CRM, le CRM reflète Gmail (interrupteur coupé ou non)", () => {
  const range = { lu: true, rangeLe: new Date(), rangePar: "TRI", traiteLe: null, remonteLe: null, sens: "ENTRANT" };

  test("rangement d'office inactif : un mail rangé par le tri ne touche pas à Gmail ; actif : libellé, lu, hors de la boîte", () => {
    assert.equal(boite.etatGmailVoulu(range, ["INBOX", "UNREAD"], "Label_7", false), null);
    assert.deepEqual(boite.etatGmailVoulu(range, ["INBOX", "UNREAD"], "Label_7", true), { ajouter: ["Label_7"], retirer: ["INBOX", "UNREAD"] });
    // Rangé par Lucas lui-même (« ne plus me montrer ») : part toujours.
    assert.deepEqual(boite.etatGmailVoulu({ ...range, rangePar: "LUCAS" }, ["INBOX"], "Label_7", false), { ajouter: ["Label_7"], retirer: ["INBOX"] });
    // Un mail ordinaire lu dans le CRM : lu dans Gmail ; archivé : hors de la boîte ; remonté : de retour dans la boîte.
    assert.deepEqual(boite.etatGmailVoulu({ ...range, rangeLe: null, rangePar: null }, ["INBOX", "UNREAD"], null, false), { ajouter: [], retirer: ["UNREAD"] });
    assert.deepEqual(boite.etatGmailVoulu({ ...range, rangeLe: null, rangePar: null, traiteLe: new Date() }, ["INBOX"], null, false), { ajouter: [], retirer: ["INBOX"] });
    assert.deepEqual(boite.etatGmailVoulu({ ...range, rangeLe: null, rangePar: null, remonteLe: new Date() }, ["Label_7"], "Label_7", false), { ajouter: ["INBOX"], retirer: ["Label_7"] });
  });

  test("« remonté par Lucas » seulement si le CRM avait vraiment sorti le mail de la boîte", () => {
    // Rangé d'office, interrupteur coupé : toujours dans la boîte Gmail sans libellé — ce n'est PAS un remonté (le bogue du 22/09).
    const encoreDansLaBoite = boite.changementsDepuisGmail({ lu: true, dansBoite: true, rangeLe: new Date(), traiteLe: null }, ["INBOX", "UNREAD"], "Label_7");
    assert.equal(encoreDansLaBoite.remonte, false);
    assert.deepEqual(encoreDansLaBoite.data, { lu: false });
    // Rangé dans Gmail (sorti de la boîte), puis Lucas le remet dans la boîte et retire le libellé : remonté.
    const remonte = boite.changementsDepuisGmail({ lu: true, dansBoite: false, rangeLe: new Date(), traiteLe: null }, ["INBOX"], "Label_7");
    assert.equal(remonte.remonte, true);
    assert.equal(remonte.data.rangeLe, null);
    // Remis dans la boîte mais le libellé y est encore : pas remonté.
    assert.equal(boite.changementsDepuisGmail({ lu: true, dansBoite: false, rangeLe: new Date(), traiteLe: null }, ["INBOX", "Label_7"], "Label_7").remonte, false);
    // Archivé dans Gmail : traité ; remis dans la boîte : de nouveau à traiter.
    assert.ok(boite.changementsDepuisGmail({ lu: true, dansBoite: true, rangeLe: null, traiteLe: null }, [], null).data.traiteLe instanceof Date);
    assert.equal(boite.changementsDepuisGmail({ lu: true, dansBoite: false, rangeLe: null, traiteLe: new Date() }, ["INBOX"], null).data.traiteLe, null);
  });

  test("migration du 22/09 : les règles « jamais rangé » fantômes sont archivées, les mails rendus au tri et rangés de nouveau", async () => {
    const { migrationMailRemontesFantomes } = await import("@/lib/base/migrations/mail-remontes-fantomes");
    await prisma.regleExpediteur.create({ data: { cible: "notifications@railway.app", action: "NE_JAMAIS_RANGER", motif: "Remonté dans Gmail par Lucas", par: "LUCAS:gmail" } });
    await prisma.regleExpediteur.create({ data: { cible: "pub@exemple.fr", action: "RANGER", motif: "Ne plus me montrer", par: "LUCAS" } });
    const fantome = await prisma.message.create({
      data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "fantome-1", sens: "ENTRANT", de: "notifications@railway.app", objet: "Deploy crashed", recuLe: new Date(), classe: "HUMAIN", classePar: "TRI", remonteLe: new Date(), lu: false },
    });
    const bilan = await migrationMailRemontesFantomes.executer(prisma);
    assert.deepEqual(bilan, { reglesArchivees: 1, mailsRendusAuTri: 1, rangesDeNouveau: 1 });
    assert.equal((await prisma.regleExpediteur.findFirst({ where: { cible: "pub@exemple.fr" } }))?.archiveLe, null, "la décision de Lucas reste");
    const apres = await prisma.message.findUniqueOrThrow({ where: { id: fantome.id } });
    assert.deepEqual([apres.classe, Boolean(apres.rangeLe), apres.remonteLe], ["BRUIT", true, null]);
    assert.deepEqual(await migrationMailRemontesFantomes.executer(prisma), { reglesArchivees: 0, mailsRendusAuTri: 0, rangesDeNouveau: 0 }, "rejouable sans effet");
  });
});

describe("la garde : l'IA n'invente ni prix, ni date, ni délai, ni lien", () => {
  test("ce qui vient du CRM ou de la consigne reste ; le reste devient [à compléter]", () => {
    const fine = String.fromCharCode(0x202f);
    const sources = JSON.stringify({ devis: { montantTTC: `1${fine}250,00 €`, acomptePourcentage: "30 %" }, dateChantier: "mardi 6 octobre 2026" }) + "\nConsigne de Lucas : dis-lui que je passe jeudi.";
    const brouillon = [
      "Votre devis s'élève à 1 250,00 €, avec un acompte de 30 %.",
      "Le chantier est prévu le mardi 6 octobre 2026 ; je passe jeudi.",
      "La pose se fait sous 3 semaines, pour 980 € de plus, le 12/10 à 14h30.",
      "Votre espace : https://coverswap.fr/e/abcdef.",
    ].join("\n");
    const { texte, corrections } = redaction.garderBrouillon(brouillon, sources);
    assert.match(texte, /1 250,00 €/);
    assert.match(texte, /30 %/);
    assert.match(texte, /mardi 6 octobre 2026/);
    assert.match(texte, /jeudi/);
    for (const invente of ["3 semaines", "980 €", "12/10", "14h30", "https://coverswap.fr/e/abcdef"]) assert.equal(texte.includes(invente), false, `${invente} aurait dû être retiré`);
    assert.equal(corrections.length, 5, corrections.join(" | "));
    assert.match(texte, /\[à compléter\]\.$/m, "la ponctuation après un lien retiré reste");
  });
});

describe("les notifications de l'espace, par mail", () => {
  let dossierId: string;

  before(async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Alice", nom: "Martin", email: "alice.martin@exemple.fr", telephone: "+33611223344", ville: "Lattes", codePostal: "34970", source: "SITE_WEB" } });
    dossierId = (await liens.ouvrirEspaceDuContact(lead.id)).dossierId;
  });

  test("un événement = un mail, jamais deux ; il part de la boîte, s'inscrit dans le dossier et l'onglet Mail, sans déplacer la main", async () => {
    const premier = await notifications.notifierClient("SIMULATION_PUBLIEE", dossierId, "sim-a");
    assert.deepEqual(premier, { programme: true });
    const second = await notifications.notifierClient("SIMULATION_PUBLIEE", dossierId, "sim-a");
    assert.equal(second.programme, false);
    const lignes = await prisma.envoiMail.findMany({ where: { cle: "notif:SIMULATION_PUBLIEE:sim-a" } });
    assert.equal(lignes.length, 1);
    assert.equal(lignes[0].a, "alice.martin@exemple.fr");
    assert.equal(await prisma.tache.count({ where: { type: envoiCrm.TYPE_TACHE_ENVOI_MAIL, cle: `mail-envoi:${lignes[0].id}` } }), 1);

    const mainAvant = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).main;
    const avant = envoyes.length;
    assert.equal((await envoiCrm.executerEnvoi(lignes[0].id)).envoye, true);
    assert.equal((await envoiCrm.executerEnvoi(lignes[0].id)).envoye, false, "rejouée, la tâche ne renvoie rien");
    assert.equal(envoyes.length, avant + 1);
    const parti = envoyes.at(-1)!;
    assert.equal(parti.a, "alice.martin@exemple.fr");
    assert.match(parti.texte, /^Bonjour Alice,/);
    assert.match(parti.html ?? "", /https:\/\/coverswap\.fr\/e\/[^"]+#simulations/);

    const ligne = await prisma.envoiMail.findUniqueOrThrow({ where: { id: lignes[0].id } });
    assert.equal(ligne.statut, "ENVOYE");
    const message = await prisma.message.findUniqueOrThrow({ where: { id: ligne.messageId! } });
    assert.deepEqual([message.sens, message.automatique, message.dossierId], ["SORTANT", true, dossierId]);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "MAIL_NOTIFICATION" } }), 1);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).main, mainAvant, "une notification ne passe pas la main");
  });

  test("rien ne part sans adresse valide, ni quand le modèle est coupé dans Paramètres", async () => {
    const sansMail = await prisma.lead.create({ data: { prenom: "Bruno", nom: "Sans", telephone: "+33655667788", ville: "Pérols", codePostal: "34470", source: "SITE_WEB" } });
    const autre = (await liens.ouvrirEspaceDuContact(sansMail.id)).dossierId;
    const resultat = await notifications.notifierClient("DEVIS_DISPONIBLE", autre, "doc-x");
    assert.equal(resultat.programme, false);
    assert.match(resultat.raison ?? "", /adresse/i);

    await notifications.enregistrerModeleNotification("PAIEMENT_RECU", { ...notifications.MODELES_PAR_DEFAUT.PAIEMENT_RECU, actif: false }, "LUCAS");
    const coupe = await notifications.notifierClient("PAIEMENT_RECU", dossierId, "enc-1", { montant: "300,00 €" });
    assert.deepEqual(coupe, { programme: false, raison: "Modèle désactivé dans Paramètres." });
  });

  test("Google coupé : l'envoi attend la reconnexion (rien de perdu, rien d'échoué)", async () => {
    const { id } = await envoiCrm.programmerEnvoi({ cle: "essai:attente", nature: "NOUVEAU", a: "alice.martin@exemple.fr", objet: "Essai", texte: "Bonjour" });
    envoi.definirEnvoyeurMailEssai(null);
    try {
      await assert.rejects(() => envoiCrm.executerEnvoi(id), (erreur: unknown) => erreur instanceof registre.AttenteExterne);
    } finally {
      envoi.definirEnvoyeurMailEssai({
        nom: "essai",
        envoyer: async (message) => {
          envoyes.push(message);
          return { identifiant: `gmail-${envoyes.length}`, fil: `fil-envoi-${envoyes.length}`, compte: "coverswap.contact@gmail.com" };
        },
      });
    }
    assert.equal((await prisma.envoiMail.findUniqueOrThrow({ where: { id } })).statut, "A_ENVOYER");
  });

  test("qui a la main : ma réponse la donne au client, une notification ne la bouge pas", () => {
    assert.equal(main.passageDeMain({ type: "MAIL_ENVOYE", direction: "SORTANT", metadata: "{}", contenu: "" })?.qui, "CLIENT");
    assert.equal(main.passageDeMain({ type: "MAIL_RECU", direction: "ENTRANT", metadata: "{}", contenu: "" })?.qui, "MOI");
    assert.equal(main.passageDeMain({ type: "MAIL_NOTIFICATION", direction: "SORTANT", metadata: "{}", contenu: "" }), null);
  });
});

describe("les vues de l'onglet Mail", () => {
  test("À traiter : ce qui attend ma réponse, un envoi resté sans réponse 5 jours, l'administratif non lu ; le rangé à part", async () => {
    const maintenant = new Date();
    let n = 0;
    const mail = (donnees: { fil: string; sens: "ENTRANT" | "SORTANT"; de: string; a?: string; classe: string; ilYA: number; lu?: boolean; rangeLe?: Date | null; objet?: string }) =>
      prisma.message.create({
        data: {
          canal: "EMAIL",
          compte: "coverswap.contact@gmail.com",
          identifiantCanal: `vue-${++n}`,
          filCanal: donnees.fil,
          sens: donnees.sens,
          de: donnees.de,
          a: JSON.stringify([donnees.a ?? "coverswap.contact@gmail.com"]),
          objet: donnees.objet ?? donnees.fil,
          recuLe: new Date(maintenant.getTime() - donnees.ilYA * JOUR),
          classe: donnees.classe,
          lu: donnees.lu ?? false,
          rangeLe: donnees.rangeLe ?? null,
          dansBoite: !donnees.rangeLe,
        },
      });
    await mail({ fil: "vue-client", sens: "ENTRANT", de: "client@exemple.fr", classe: "CLIENT", ilYA: 1 });
    await mail({ fil: "vue-relance", sens: "SORTANT", de: "coverswap.contact@gmail.com", a: "silence@exemple.fr", classe: "CLIENT", ilYA: 6 });
    await mail({ fil: "vue-recent", sens: "SORTANT", de: "coverswap.contact@gmail.com", a: "patient@exemple.fr", classe: "CLIENT", ilYA: 2 });
    await mail({ fil: "vue-admin", sens: "ENTRANT", de: "contact@urssaf.fr", classe: "ADMINISTRATIF", ilYA: 1 });
    await mail({ fil: "vue-bruit", sens: "ENTRANT", de: "notifications@railway.app", classe: "BRUIT", ilYA: 1, lu: true, rangeLe: maintenant });

    const lignes = (await vues.conversations(maintenant)).filter((l) => l.fil.startsWith("vue-"));
    const parFil = (fil: string) => lignes.find((l) => l.fil === fil)!;
    assert.deepEqual(vues.filtrerVue(lignes, "A_TRAITER").map((l) => l.fil).sort(), ["vue-admin", "vue-client", "vue-relance"]);
    assert.equal(parFil("vue-relance").mention, "Sans réponse depuis 6 jours");
    assert.equal(parFil("vue-client").mention, "Attend votre réponse");
    assert.deepEqual(vues.filtrerVue(lignes, "RANGES").map((l) => l.fil), ["vue-bruit"]);
    assert.equal(vues.filtrerVue(lignes, "CLIENTS").some((l) => l.fil === "vue-bruit"), false);

    // L'administratif lu sort d'« À traiter » mais reste dans Administratif.
    await prisma.message.updateMany({ where: { filCanal: "vue-admin" }, data: { lu: true } });
    const apres = (await vues.conversations(maintenant)).filter((l) => l.fil.startsWith("vue-"));
    assert.equal(vues.filtrerVue(apres, "A_TRAITER").some((l) => l.fil === "vue-admin"), false);
    assert.equal(vues.filtrerVue(apres, "ADMINISTRATIF").some((l) => l.fil === "vue-admin"), true);
  });
});

describe("les séquences : tout est prêt, rien n'est actif", () => {
  let leadId: string;

  before(async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Claire", nom: "Injoignable", email: "claire@exemple.fr", telephone: "+33699887766", ville: "Lunel", codePostal: "34400", source: "SITE_WEB", statut: "NOUVEAU" } });
    leadId = lead.id;
    await prisma.noteAppel.create({ data: { leadId, issue: "PAS_DE_REPONSE", appelLe: new Date(Date.now() - 2 * JOUR) } });
    await prisma.noteAppel.create({ data: { leadId, issue: "PAS_DE_REPONSE", appelLe: new Date(Date.now() - JOUR) } });
  });

  test("quatre séquences livrées inactives, en mode validation, plafonnées ; le moteur ne fait rien", async () => {
    await sequences.assurerSequences();
    const toutes = await prisma.sequenceMail.findMany({ orderBy: { code: "asc" } });
    assert.deepEqual(toutes.map((s) => s.code), ["AVIS", "DEVIS_NON_SIGNE", "INJOIGNABLE", "REACTIVATION"]);
    assert.ok(toutes.every((s) => !s.active && s.mode === "VALIDATION" && s.plafondJour === 10));
    assert.equal(await sequences.sequencesActives(), false);
    assert.deepEqual(await sequences.avancerSequences(), { inscrits: 0, arretes: 0, prepares: 0, programmes: 0 });
  });

  test("activée en mode validation : le mail attend mon clic, porte la désinscription, et la séquence s'arrête quand le client répond", async () => {
    await prisma.sequenceMail.update({ where: { code: "INJOIGNABLE" }, data: { active: true } });
    try {
      const bilan = await sequences.avancerSequences();
      assert.equal(bilan.inscrits, 1);
      assert.equal(bilan.prepares, 1);
      assert.equal(bilan.programmes, 0, "rien ne part seul en mode validation");
      const inscription = await prisma.inscriptionSequence.findUniqueOrThrow({ where: { cle: `INJOIGNABLE:lead:${leadId}` } });
      assert.equal(inscription.statut, "EN_VALIDATION");

      const apercu = await sequences.apercuEtape("INJOIGNABLE", 1, inscription.cle);
      assert.equal(apercu.candidat?.adresse, "claire@exemple.fr");
      assert.match(apercu.texte, /^Bonjour Claire,/);
      assert.match(apercu.texte, /désinscription en un clic : https:\/\/coverswap\.fr\/desinscription\?e=/i);

      const { envoiId } = await sequences.envoyerEtape(inscription.id);
      const ligne = await prisma.envoiMail.findUniqueOrThrow({ where: { id: envoiId } });
      assert.equal(ligne.nature, "SEQUENCE");
      assert.match(ligne.entetes ?? "", /List-Unsubscribe/);
      const suite = await prisma.inscriptionSequence.findUniqueOrThrow({ where: { id: inscription.id } });
      assert.deepEqual([suite.etapeFaite, suite.statut], [1, "EN_COURS"]);

      // Le client répond : au passage suivant, la séquence s'arrête.
      await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: "reponse-claire", sens: "ENTRANT", de: "claire@exemple.fr", recuLe: new Date(), classe: "CLIENT" } });
      await prisma.inscriptionSequence.update({ where: { id: inscription.id }, data: { prochainEnvoiLe: new Date(Date.now() - 1000) } });
      assert.equal((await sequences.avancerSequences()).arretes, 1);
      assert.deepEqual(
        await prisma.inscriptionSequence.findUniqueOrThrow({ where: { id: inscription.id }, select: { statut: true, arretMotif: true } }),
        { statut: "ARRETEE", arretMotif: "Le client a répondu" }
      );
    } finally {
      await prisma.sequenceMail.update({ where: { code: "INJOIGNABLE" }, data: { active: false } });
    }
  });

  test("réactivation à 6 mois : seulement avec l'accord aux e-mails commerciaux", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Denis", nom: "Perdu", email: "denis@exemple.fr", telephone: "+33612121212", ville: "Mauguio", codePostal: "34130", source: "SITE_WEB" } });
    const { dossierId } = await liens.ouvrirEspaceDuContact(lead.id);
    const clientId = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).clientId!;
    await prisma.dossier.update({ where: { id: dossierId }, data: { archiveLe: new Date() } });
    await prisma.$executeRawUnsafe(`UPDATE "Lead" SET "statut" = 'PERDU', "updatedAt" = ? WHERE "id" = ?`, Date.now() - 185 * JOUR, lead.id);
    const cles = async () => (await sequences.apercuEtape("REACTIVATION", 1)).candidats.map((c) => c.cle);
    assert.equal((await cles()).includes(`REACTIVATION:lead:${lead.id}`), false, "sans accord : jamais");
    await prisma.consentementMail.create({ data: { clientId, statut: "ACCORDE", moyen: "FORMULAIRE_SITE", recueilliLe: new Date(Date.now() - 200 * JOUR) } });
    assert.equal((await cles()).includes(`REACTIVATION:lead:${lead.id}`), true);
  });

  test("désinscription : jeton vérifié, définitive, séquences arrêtées, retrait de l'accord noté sur la fiche", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Emma", nom: "Stop", email: "emma@exemple.fr", telephone: "+33634343434", ville: "Lattes", codePostal: "34970", source: "SITE_WEB" } });
    const { dossierId } = await liens.ouvrirEspaceDuContact(lead.id);
    const clientId = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).clientId!;
    const sequence = await prisma.sequenceMail.findUniqueOrThrow({ where: { code: "DEVIS_NON_SIGNE" } });
    await prisma.inscriptionSequence.create({ data: { sequenceId: sequence.id, cle: `DEVIS_NON_SIGNE:dossier:${dossierId}`, adresse: "emma@exemple.fr", dossierId, prochainEnvoiLe: new Date() } });

    const lien = new URL(sequences.lienDesinscription("Emma@Exemple.fr"));
    const e = lien.searchParams.get("e")!;
    await assert.rejects(() => sequences.desinscrire(e, "jeton-faux-0123456789"), /invalide/);
    assert.equal(await prisma.desinscription.count({ where: { adresse: "emma@exemple.fr" } }), 0);

    await sequences.desinscrire(e, lien.searchParams.get("j")!);
    await sequences.desinscrire(e, lien.searchParams.get("j")!);
    assert.equal(await prisma.desinscription.count({ where: { adresse: "emma@exemple.fr" } }), 1);
    assert.equal((await prisma.inscriptionSequence.findUniqueOrThrow({ where: { cle: `DEVIS_NON_SIGNE:dossier:${dossierId}` } })).statut, "ARRETEE");
    const consentements = await prisma.consentementMail.findMany({ where: { clientId } });
    assert.deepEqual(consentements.map((c) => c.statut), ["RETIRE"], "une seule déclaration, même cliqué deux fois");
  });
});
