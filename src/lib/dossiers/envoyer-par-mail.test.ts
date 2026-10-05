import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import type { MessageSortant } from "@/lib/mail/envoi";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-envoyer-par-mail-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B2, écart 2) : un devis envoyé par le mail du CRM (bouton du dossier ou outil « envoyer_document ») a les
 * mêmes effets qu'un devis rendu visible — visible dans l'espace, étape « Devis envoyé », main au client, « Attendre
 * l'accord », relances datées de l'envoi, tâche « Envoyer le devis » cochée — et un seul mail part : la nouvelle
 * tentative (outil relancé, double clic, tâche rejouée) est sans effet. Chaque cas se lit des deux côtés
 * (`etatDesDeuxCotes`). Rien ne part hors du poste : l'envoyeur des essais garde les mails en mémoire.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let documents: typeof import("./documents");
let transitions: typeof import("./transitions");
let mail: typeof import("@/lib/mail/service");
let envoi: typeof import("@/lib/mail/envoi");
let validation: typeof import("@/lib/validation/service");
let relances: typeof import("@/lib/relances/service");
let dossiers: typeof import("./dossiers");
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let session: import("@/lib/assistant/execution").Session;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const envoyes: MessageSortant[] = [];
const contexte = (tacheId: string) => ({ tacheId, tentative: 1, signal: new AbortController().signal });
const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
const genererMasque = (dossierId: string) =>
  avecActeur(LUCAS, () =>
    documents.genererDocument(dossierId, documents.schemaGeneration.parse({ type: "DEVIS", objet: "Recouvrement cuisine", lignes: [ligne("Revêtement adhésif — façades", 8, 140)], noteMl: true, acomptePct: 30, remplaceDocumentId: null, notifier: false }))
  );
const appeler = (nom: string, entree: Record<string, unknown>) => execution.executerOutil(catalogue.outilParNom(nom)!, entree, session, new Date());

async function contact(prenom: string) {
  const email = `${prenom.toLowerCase()}.essai@example.test`;
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3362${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", email } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  await prisma.dossier.update({ where: { id: ouvert.dossierId }, data: { clientEmail: email } });
  return { leadId: lead.id, dossierId: ouvert.dossierId, nom: `${prenom} Essai`, email };
}

/** Un devis généré masqué (pas encore envoyé), sur un dossier en Simulation dont le client a choisi. */
async function devisPasEncoreEnvoye(prenom: string) {
  const c = await contact(prenom);
  await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIMULATION" }));
  await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: "Préparer le devis (simulation choisie)" } });
  const { document: devis } = await genererMasque(c.dossierId);
  assert.equal(devis.visibleEspace, false);
  return { ...c, devis };
}

const mailsDuDossier = (dossierId: string) => prisma.dossierEvenement.count({ where: { dossierId, type: "MAIL_ENVOYE" } });
const propositionsDuDossier = (dossierId: string) => prisma.proposition.count({ where: { dossierId, type: "ENVOI_MAIL" } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  documents = await import("./documents");
  transitions = await import("./transitions");
  mail = await import("@/lib/mail/service");
  envoi = await import("@/lib/mail/envoi");
  validation = await import("@/lib/validation/service");
  relances = await import("@/lib/relances/service");
  dossiers = await import("./dossiers");
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: "essai", clientNom: "Essai", utilisateur: "essai@local" });
  envoi.definirEnvoyeurMailEssai({
    nom: "essai",
    async envoyer(message) {
      envoyes.push(message);
      return { identifiant: `essai-${envoyes.length}` };
    },
  });
});
after(async () => {
  envoi.oublierEnvoyeurMailEssai();
  await prisma.$disconnect();
});

describe("devis envoyé par mail depuis le CRM (mission 18, B2)", () => {
  test("bouton du dossier : mêmes effets qu'un devis rendu visible, relance datée de l'envoi ; le même envoi refait et la tâche rejouée sont sans effet", async () => {
    const c = await devisPasEncoreEnvoye("Bouton");
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.equal(avant.etape, "SIMULATION");
    assert.equal(avant.prochaineAction, "Envoyer le devis au client");
    assert.deepEqual([avant.main, avant.mainCalculee], ["MOI", "MOI"]);
    assert.equal(avant.taches.filter((t) => t.type === "ENVOYER_DEVIS").length, 1);
    assert.deepEqual(avant.relances, { proposables: [], devis: [] });

    const brouillon = await mail.brouillonEnvoiDocument(c.dossierId, c.devis.id);
    assert.equal(brouillon.a, c.email);
    const premier = await avecActeur(LUCAS, () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, brouillon));
    assert.deepEqual([premier.deja, premier.proposition.statut], [false, "VALIDEE"]);
    // Double clic avant le départ : la même proposition, rien de plus.
    const double = await avecActeur(LUCAS, () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, brouillon));
    assert.deepEqual([double.deja, double.proposition.id], [true, premier.proposition.id]);
    assert.equal(await propositionsDuDossier(c.dossierId), 1);

    await validation.executerPropositionValidee({ propositionId: premier.proposition.id }, contexte("bouton"));
    const parti = envoyes.filter((m) => m.a === c.email);
    assert.equal(parti.length, 1);
    assert.equal(parti[0].pieces?.length, 1);
    assert.equal(await mailsDuDossier(c.dossierId), 1);

    const devis = await prisma.document.findUniqueOrThrow({ where: { id: c.devis.id } });
    assert.deepEqual([devis.statut, devis.visibleEspace], ["ENVOYE", true], "visible dans son espace, « Envoyé »");
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } });
    assert.deepEqual(JSON.parse(evenement.metadata), { documentId: c.devis.id, canal: "MAIL", propositionId: premier.proposition.id });
    assert.equal(await prisma.envoiMail.count({ where: { cle: `notif:DEVIS_DISPONIBLE:${c.devis.id}` } }), 0, "le mail vaut notification : pas de « Devis disponible » en plus");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "DEVIS_ENVOYE");
    assert.deepEqual([etat.main, etat.mainCalculee, etat.mainMotif], ["CLIENT", "CLIENT", "Devis envoyé : en attente de sa réponse"]);
    assert.equal(etat.prochaineAction, "Attendre l'accord du client sur le devis");
    assert.equal(etat.statutLead, "DEVIS_ENVOYE");
    assert.equal(etat.etapeEspace, "DEVIS");
    const { jours } = await relances.lireDelaiRelance();
    assert.deepEqual(etat.relances.proposables, []);
    assert.deepEqual(etat.relances.devis.map((r) => [r.numero, r.rang]), [[c.devis.numero, 1]]);
    assert.equal(new Date(etat.relances.devis[0].le!).getTime(), evenement.createdAt.getTime() + jours * JOUR);
    // La relance part de l'envoi, pas de l'émission (un document émis ne se modifie plus : c'est l'envoi qu'on décale,
    // comme un mail parti trois jours après la génération).
    const emission = devis.dateEmission!.getTime();
    assert.equal(relances.referenceDuDevis({ dateEmission: devis.dateEmission!, createdAt: devis.createdAt }, new Date(emission + 3 * JOUR)).getTime(), emission + 3 * JOUR);
    await prisma.dossierEvenement.update({ where: { id: evenement.id }, data: { createdAt: new Date(evenement.createdAt.getTime() + 3 * JOUR) } });
    const decale = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.equal(new Date(decale.relances.devis[0].le!).getTime(), evenement.createdAt.getTime() + (3 + jours) * JOUR);
    await prisma.dossierEvenement.update({ where: { id: evenement.id }, data: { createdAt: evenement.createdAt } });
    assert.equal(etat.taches.filter((t) => t.type === "ENVOYER_DEVIS").length, 0);
    const cochee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: `ENVOYER_DEVIS:dossier:${c.dossierId}` } });
    assert.equal(cochee.statut, "FAITE");
    assert.equal(cochee.reponseTexte, `coché par le CRM : devis ${c.devis.numero} envoyé par mail`);

    // Tâche rejouée après l'envoi, puis le même envoi refait dans la demi-heure : rien ne repart, rien ne change.
    await prisma.proposition.update({ where: { id: premier.proposition.id }, data: { statut: "VALIDEE" } });
    await validation.executerPropositionValidee({ propositionId: premier.proposition.id }, contexte("bouton-rejouee"));
    const encore = await avecActeur(LUCAS, () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, brouillon));
    assert.equal(encore.deja, true);
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 1);
    assert.equal(await mailsDuDossier(c.dossierId), 1);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } }), 1);
    assert.equal(await propositionsDuDossier(c.dossierId), 1);
    assert.deepEqual(await etatDesDeuxCotes(c.dossierId), etat);
  });

  test("outil « envoyer_document » confirmé, puis relancé : une seule validation (plus de 409), un seul mail ; une action posée à la main n'est pas écrasée", async () => {
    const c = await devisPasEncoreEnvoye("Outil");
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Rappeler jeudi pour le devis" }));

    const apercu = await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id });
    assert.ok(apercu.confirmation, "sensible : aperçu");
    const fait = await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id, confirmation: apercu.confirmation!.jeton });
    assert.match(fait.texte, /^Mail validé : il part dans quelques secondes à outil\.essai@example\.test/);
    const propositionId = (fait.donnees as { propositionId: string }).propositionId;
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: propositionId } })).statut, "VALIDEE");

    // Claude relance l'outil (coupure, doute) : nouvel aperçu, nouvelle confirmation — sans effet.
    const apercu2 = await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id });
    const refait = await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id, confirmation: apercu2.confirmation!.jeton });
    assert.match(refait.texte, /déjà en cours d'envoi : nouvelle tentative sans effet, aucun second mail/);
    assert.equal((refait.donnees as { propositionId: string }).propositionId, propositionId);
    assert.equal(await propositionsDuDossier(c.dossierId), 1);

    await validation.executerPropositionValidee({ propositionId }, contexte("outil"));
    const apres = await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id, confirmation: (await appeler("envoyer_document", { dossierId: c.dossierId, documentId: c.devis.id })).confirmation!.jeton });
    assert.match(apres.texte, /est déjà parti : nouvelle tentative sans effet/);
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 1);
    assert.equal(await mailsDuDossier(c.dossierId), 1);

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "DEVIS_ENVOYE");
    assert.deepEqual([etat.main, etat.mainCalculee], ["CLIENT", "CLIENT"]);
    assert.equal(etat.etapeEspace, "DEVIS");
    // « Rappeler jeudi… » posé à la main n'est pas écrasé ; « Attendre l'accord » ne remplace que « Préparer / Envoyer
    // le devis » : sa condition n'est pas remplie, rien n'est rangé à la place (docs/SYNCHRO.md § 2).
    assert.deepEqual([etat.prochaineAction, etat.actionManuelle], ["Rappeler jeudi pour le devis", "Rappeler jeudi pour le devis"]);
    assert.equal(etat.taches.filter((t) => t.cle.startsWith(`MANUELLE:synchro:${c.dossierId}:`)).length, 0);
    assert.equal(etat.taches.filter((t) => t.type === "ENVOYER_DEVIS").length, 0);
  });

  test("devis annulé entre la validation et l'envoi : rien ne part, rien ne bouge, la proposition est annulée", async () => {
    const c = await devisPasEncoreEnvoye("Annule");
    const avant = await etatDesDeuxCotes(c.dossierId, { taches: false });
    const { proposition } = await avecActeur(LUCAS, async () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, await mail.brouillonEnvoiDocument(c.dossierId, c.devis.id)));
    await avecActeur(LUCAS, () => documents.annulerDevis(c.dossierId, c.devis.id, "erreur de métrage"));

    const sortie = await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte("annule"));
    assert.match(String((sortie as { sansObjet?: string }).sansObjet), /a été annulé/);
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 0);
    assert.equal(await mailsDuDossier(c.dossierId), 0);
    const lue = await prisma.proposition.findUniqueOrThrow({ where: { id: proposition.id } });
    assert.equal(lue.statut, "ANNULEE");
    assert.match(lue.commentaireRejet ?? "", /^Sans objet au moment de l'exécution : le document .* a été annulé$/);
    const devis = await prisma.document.findUniqueOrThrow({ where: { id: c.devis.id } });
    assert.deepEqual([devis.statut, devis.visibleEspace], ["ANNULEE", false]);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.equal(etat.etape, avant.etape);
    assert.equal(etat.etapeEspace, avant.etapeEspace);
    assert.deepEqual(etat.relances, { proposables: [], devis: [] });
  });

  test("coupure juste après l'envoi (trace du mail écrite, effets non) : la tâche rejouée écrit les effets sans renvoyer le mail", async () => {
    const c = await devisPasEncoreEnvoye("Coupure");
    const { proposition } = await avecActeur(LUCAS, async () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, await mail.brouillonEnvoiDocument(c.dossierId, c.devis.id)));
    // Le mail est parti (sa trace est écrite en premier), puis le processus s'est arrêté.
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Envoi du devis (essai de coupure)", metadata: JSON.stringify({ propositionId: proposition.id, motif: "ENVOI_DEVIS", documentIds: [c.devis.id] }) } });

    await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte("coupure"));
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 0, "le mail ne repart pas");
    const devis = await prisma.document.findUniqueOrThrow({ where: { id: c.devis.id } });
    assert.deepEqual([devis.statut, devis.visibleEspace], ["ENVOYE", true]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.prochaineAction, etat.etapeEspace], ["DEVIS_ENVOYE", "CLIENT", "Attendre l'accord du client sur le devis", "DEVIS"]);
    assert.equal(etat.taches.filter((t) => t.type === "ENVOYER_DEVIS").length, 0);
    // Rejouée encore : rien de plus.
    await prisma.proposition.update({ where: { id: proposition.id }, data: { statut: "VALIDEE" } });
    await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte("coupure-2"));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } }), 1);
  });

  test("relecture : coupure après l'envoi, puis devis annulé avant la reprise : la proposition est notée exécutée (le mail est parti), jamais « sans objet », rien ne repart", async () => {
    const c = await devisPasEncoreEnvoye("Coupeannule");
    const { proposition } = await avecActeur(LUCAS, async () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, await mail.brouillonEnvoiDocument(c.dossierId, c.devis.id)));
    // Le mail est parti (sa trace est écrite en premier), puis le processus s'est arrêté ; Lucas annule ensuite le devis.
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: "Envoi du devis (essai de coupure)", metadata: JSON.stringify({ propositionId: proposition.id, motif: "ENVOI_DEVIS", documentIds: [c.devis.id] }) } });
    await avecActeur(LUCAS, () => documents.annulerDevis(c.dossierId, c.devis.id, "erreur de métrage"));

    await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte("coupure-annule"));
    const apres = await prisma.proposition.findUniqueOrThrow({ where: { id: proposition.id } });
    assert.equal(apres.statut, "EXECUTEE", "l'historique dit vrai : le mail est parti");
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 0, "le mail ne repart pas");
    assert.equal(await mailsDuDossier(c.dossierId), 1);
    // Le devis annulé ne revit pas : ni « Devis envoyé » ni passage d'étape.
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "DEVIS_ENVOYE" } }), 0);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.relances.devis], ["SIMULATION", []]);
    // La clé d'unicité reste prise : le même envoi, refait, rend la proposition exécutée au lieu d'en créer une autre.
    assert.equal(await propositionsDuDossier(c.dossierId), 1);
  });

  test("écarté (annulé, rejeté…) ou parti depuis plus d'une demi-heure, le même envoi peut être refait", async () => {
    const c = await devisPasEncoreEnvoye("Refait");
    const brouillon = await mail.brouillonEnvoiDocument(c.dossierId, c.devis.id);
    const premier = await avecActeur(LUCAS, () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, brouillon));
    await validation.executerPropositionValidee({ propositionId: premier.proposition.id }, contexte("refait-1"));
    await prisma.proposition.update({ where: { id: premier.proposition.id }, data: { executeLe: new Date(Date.now() - 2 * 60 * 60_000) } });

    const second = await avecActeur(LUCAS, () => mail.envoyerDocumentParMail(c.dossierId, c.devis.id, brouillon));
    assert.equal(second.deja, false);
    assert.notEqual(second.proposition.id, premier.proposition.id);
    const ancienne = await prisma.proposition.findUniqueOrThrow({ where: { id: premier.proposition.id } });
    assert.equal(ancienne.cleUnicite, `${mail.cleEnvoiDocument(c.devis.id, brouillon)}:${premier.proposition.id}`, "l'ancienne garde sa trace sous une clé close");
    assert.equal(ancienne.statut, "EXECUTEE");
    await validation.executerPropositionValidee({ propositionId: second.proposition.id }, contexte("refait-2"));
    assert.equal(envoyes.filter((m) => m.a === c.email).length, 2);
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "DEVIS_ENVOYE");
  });
});
