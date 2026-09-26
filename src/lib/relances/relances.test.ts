import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import type { MessageSortant } from "@/lib/mail/envoi";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let relances: typeof import("./service");
let validation: typeof import("@/lib/validation/service");
let envoi: typeof import("@/lib/mail/envoi");
let parametres: typeof import("@/lib/parametres/service");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 24 * 60 * 60_000;
const envoyes: MessageSortant[] = [];
let rangDevis = 500;

async function dossierAvecDevis(entree: { clientNom: string; email: string | null; ilYaJours: number; consentement?: string }) {
  const client = await prisma.client.create({ data: { nom: entree.clientNom, prenom: entree.clientNom.split(" ")[0], source: "ENTRANT", premierContactLe: new Date() } });
  if (entree.consentement) {
    await prisma.consentementMail.create({ data: { clientId: client.id, statut: entree.consentement, recueilliLe: new Date(), moyen: "EMAIL" } });
  }
  const dossier = await prisma.dossier.create({
    data: {
      clientNom: entree.clientNom,
      clientAdresse: "2 rue des Essais",
      clientCp: "34000",
      clientVille: "Montpellier",
      clientTelephone: "0600000010",
      clientEmail: entree.email,
      objet: "Recouvrement cuisine",
      source: "ENTRANT",
      etape: "DEVIS_ENVOYE",
      clientId: client.id,
    },
  });
  const devis = await prisma.document.create({
    data: {
      dossierId: dossier.id,
      clientId: client.id,
      type: "DEVIS",
      numero: `2026-${++rangDevis}`,
      dateEmission: new Date(Date.now() - entree.ilYaJours * JOUR),
      objet: "Recouvrement cuisine",
      lignes: JSON.stringify([{ type: "PRESTATION", designation: "Revêtement", quantite: 3, unite: "ml", prixUnitaire: 110 }]),
      totalHt: 330,
      acomptePct: 30,
      statut: "GENERE",
      destinataire: JSON.stringify({ nom: entree.clientNom, adresse: "2 rue des Essais", codePostal: "34000", ville: "Montpellier", siret: null, categorie: "PARTICULIER" }),
      categorieClient: "PARTICULIER",
    },
  });
  return { dossier, devis };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  relances = await import("./service");
  validation = await import("@/lib/validation/service");
  envoi = await import("@/lib/mail/envoi");
  parametres = await import("@/lib/parametres/service");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/base/preparation")).preparerBase();
  envoi.definirEnvoyeurMailEssai({
    nom: "essai",
    async envoyer(message) {
      envoyes.push(message);
      return { identifiant: `essai-${envoyes.length}` };
    },
  });
});

after(async () => {
  envoi.definirEnvoyeurMailEssai(null);
  await prisma.$disconnect();
});

describe("relances de devis", () => {
  let propositionId: string;
  let dossierId: string;
  let devisId: string;

  test("sans délai paramétré, 5 jours s'appliquent (mission 13) ; le paramètre prend le relais ; une proposition par devis dû", async () => {
    const { dossier, devis } = await dossierAvecDevis({ clientNom: "Alice Durand", email: "alice@example.test", ilYaJours: 10 });
    dossierId = dossier.id;
    devisId = devis.id;
    await dossierAvecDevis({ clientNom: "Bruno Marchal", email: null, ilYaJours: 10 });
    await dossierAvecDevis({ clientNom: "Chantal Vidal", email: "chantal@example.test", ilYaJours: 10, consentement: "RETIRE" });
    await dossierAvecDevis({ clientNom: "Denis Roux", email: "denis@example.test", ilYaJours: 2 });

    // Mission 13 (B16) : sans paramètre, le délai par défaut (5 jours) suit déjà les devis — Alice (10 jours) est proposée, Denis (2 jours) non.
    assert.deepEqual(await relances.lireDelaiRelance(new Date("2026-09-25T12:00:00Z")), { jours: 5, parametre: false });
    assert.deepEqual(await relances.proposerRelances(), { proposees: 1, dejaProposees: 0, parametreManquant: false, sansAdresse: 1, refusMail: 1 });

    await parametres.enregistrerParametre({ cle: "DELAI_RELANCE_DEVIS", valeur: 7, valableDu: new Date() });
    assert.deepEqual(await relances.lireDelaiRelance(), { jours: 7, parametre: true });
    assert.deepEqual(await relances.proposerRelances(), { proposees: 0, dejaProposees: 1, parametreManquant: false, sansAdresse: 1, refusMail: 1 });
    assert.equal((await relances.proposerRelances()).dejaProposees, 1);

    const proposition = await prisma.proposition.findFirstOrThrow({ where: { type: "ENVOI_MAIL", dossierId } });
    propositionId = proposition.id;
    const contenu = JSON.parse(proposition.contenu);
    assert.equal(contenu.a, "alice@example.test");
    assert.deepEqual(contenu.documentIds, [devisId]);
    assert.match(contenu.texte, /^Bonjour Alice,/);
    assert.equal(proposition.cleUnicite, `relance:${devisId}:1`);
    assert.equal(envoyes.length, 0);
  });

  test("rien ne part sans validation humaine, ni en lot, ni par un agent", async () => {
    await assert.rejects(avecActeur({ acteur: "AGENT:mail" }, () => validation.validerProposition(propositionId)), /Seule une personne/);
    await assert.rejects(
      () => validation.executerSansValidation({ type: "ENVOI_MAIL", titre: "x", contenu: { motif: "RELANCE_DEVIS", a: "a@b.fr", objet: "x", texte: "x" }, confiance: 1 }, 0.5),
      /interdite/
    );
    assert.equal(envoyes.length, 0);
  });

  test("validée : le mail part avec le devis joint, s'inscrit au dossier, ne repart pas si la tâche est rejouée", async () => {
    await avecActeur(LUCAS, () => validation.validerProposition(propositionId, { texte: "Bonjour Alice,\n\nOù en est votre projet ?\n\nLucas" }));
    const contexte = { tacheId: "essai", tentative: 1, signal: new AbortController().signal };
    await validation.executerPropositionValidee({ propositionId }, contexte);

    assert.equal(envoyes.length, 1);
    assert.equal(envoyes[0].a, "alice@example.test");
    assert.equal(envoyes[0].texte, "Bonjour Alice,\n\nOù en est votre projet ?\n\nLucas");
    assert.equal(envoyes[0].pieces?.length, 1);
    assert.match(envoyes[0].pieces![0].nom, /^Devis-2026-\d+-ALICE-DURAND\.pdf$/);
    assert.ok(envoyes[0].pieces![0].contenu.subarray(0, 4).toString() === "%PDF");

    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "MAIL_ENVOYE" } });
    assert.match(evenement.metadata, new RegExp(propositionId));
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devisId } })).statut, "ENVOYE");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "RELANCE");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: propositionId } })).statut, "EXECUTEE");

    // Rejouée (tâche relancée après un envoi réussi) : rien ne repart.
    await prisma.proposition.update({ where: { id: propositionId }, data: { statut: "VALIDEE" } });
    await validation.executerPropositionValidee({ propositionId }, contexte);
    assert.equal(envoyes.length, 1);
  });

  test("seconde relance après le délai, jamais de troisième", async () => {
    const plusTard = new Date(Date.now() + 8 * JOUR);
    const deuxieme = await relances.proposerRelances(plusTard);
    // La seconde d'Alice, et la première de Denis dont le devis a maintenant dix jours.
    assert.equal(deuxieme.proposees, 2);
    const proposition = await prisma.proposition.findFirstOrThrow({ where: { cleUnicite: `relance:${devisId}:2` } });
    assert.match(JSON.parse(proposition.contenu).texte, /une dernière fois/);

    await avecActeur(LUCAS, () => validation.validerProposition(proposition.id));
    await validation.executerPropositionValidee({ propositionId: proposition.id }, { tacheId: "essai-2", tentative: 1, signal: new AbortController().signal });
    assert.equal(envoyes.length, 2);
    assert.equal((await relances.proposerRelances(new Date(Date.now() + 30 * JOUR))).proposees, 0);
  });

  test("sans envoyeur configuré : échec définitif, rien ne part", async () => {
    const { dossier, devis } = await dossierAvecDevis({ clientNom: "Emma Blanc", email: "emma@example.test", ilYaJours: 9 });
    await relances.proposerRelances();
    const proposition = await prisma.proposition.findFirstOrThrow({ where: { cleUnicite: `relance:${devis.id}:1` } });
    await avecActeur(LUCAS, () => validation.validerProposition(proposition.id));
    envoi.definirEnvoyeurMailEssai(null);
    await assert.rejects(
      () => validation.executerPropositionValidee({ propositionId: proposition.id }, { tacheId: "essai-3", tentative: 1, signal: new AbortController().signal }),
      (erreur: unknown) => erreur instanceof Error && erreur.name === "ErreurDefinitive" && /Aucun envoi de mail configuré/.test(erreur.message)
    );
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: dossier.id, type: "MAIL_ENVOYE" } }), 0);
  });
});
