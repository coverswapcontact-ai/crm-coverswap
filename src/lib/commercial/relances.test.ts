import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-relances-"));

/**
 * Mission 14 (partie 6) : l'ancien circuit de relances par SMS (`commercial/relances.ts`, travail « relances-sms » :
 * SMS proposés puis envoyés par le fournisseur après validation) est retiré — les relances sont des SMS à copier
 * (`relances/proposables.ts`, testées dans `base/mission-14-partie-6.test.ts`). Restent ici : les propositions
 * « Envoyer un SMS » déjà en base, toujours validables jusqu'à leur expiration, et la fin d'appel.
 */

let prisma: typeof import("@/lib/prisma").default;
let appels: typeof import("./appels");
let liens: typeof import("@/lib/espace/liens");
let conversations: typeof import("@/lib/sms/conversations");
let reception: typeof import("@/lib/sms/reception");
let validation: typeof import("@/lib/validation/service");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;

const LUCAS = { acteur: "HUMAIN:lucas@exemple.test" };
const JOUR = 86_400_000;
const contexte = { tacheId: "essai", tentative: 1, signal: new AbortController().signal };

function reglerEnvironnement(): void {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.SMS_FOURNISSEUR = "simulateur";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
}

let compteur = 10;
/** Un contact, son dossier et son espace, ouverts il y a `jours` jours. */
async function dossierOuvert(prenom: string, jours: number) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336120000${compteur++}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
  const { espace, dossierId } = await liens.ouvrirEspaceDuContact(lead.id);
  const quand = new Date(Date.now() - jours * JOUR);
  await prisma.espaceClient.update({ where: { id: espace.id }, data: { createdAt: quand } });
  return { leadId: lead.id, dossierId, espaceId: espace.id, telephone: lead.telephone };
}

/** Une proposition « Envoyer un SMS » de l'ancien circuit, telle qu'il en reste en base. */
async function ancienneProposition(contact: { dossierId: string; leadId: string; telephone: string }, motif: string, texte: string) {
  const { dossierId } = contact;
  const conversation = await conversations.conversationDuNumero(contact.telephone, { leadId: contact.leadId });
  return avecActeur({ acteur: "SYSTEME:relances" }, () =>
    validation.proposer({
      type: "ENVOI_SMS",
      titre: `Relance (ancien circuit) : ${motif}`,
      contenu: { motif, conversationId: conversation.id, dossierId, modele: motif, texte, proposeLe: new Date().toISOString() },
      cleUnicite: `relance-sms:${dossierId}:${motif}`,
      dossierId,
      expireLe: new Date(Date.now() + 7 * JOUR),
    })
  );
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  reglerEnvironnement();
  appels = await import("./appels");
  liens = await import("@/lib/espace/liens");
  conversations = await import("@/lib/sms/conversations");
  reception = await import("@/lib/sms/reception");
  validation = await import("@/lib/validation/service");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/sms/modeles")).poserModelesParDefaut();
});
after(async () => {
  await prisma.$disconnect();
});

describe("l'ancien circuit : ses propositions restent validables, rien ne part seul", () => {
  test("Lucas corrige puis valide une proposition restée en base : le SMS part avec SON texte, et les deux versions sont gardées", async () => {
    const contact = await dossierOuvert("Élise", 3);
    const { dossierId } = contact;
    const propose = "Bonjour Élise, Lucas de CoverSwap. Avez-vous pu prendre 2 ou 3 photos ?";
    const { id } = await ancienneProposition(contact, "RELANCE_PHOTOS", propose);
    const corrige = "Bonjour Élise, c'est Lucas. Vous avez pu faire les photos de la cuisine ?";

    await assert.rejects(avecActeur({ acteur: "SYSTEME:relances" }, () => validation.validerProposition(id)), /Seule une personne/, "rien ne part sans une décision humaine");
    await avecActeur(LUCAS, () => validation.validerProposition(id, { texte: corrige }));
    await validation.executerPropositionValidee({ propositionId: id }, contexte);
    await validation.executerPropositionValidee({ propositionId: id }, contexte); // tâche rejouée

    const envoyes = await prisma.sms.findMany({ where: { dossierId, sens: "SORTANT" } });
    assert.equal(envoyes.length, 1, "un seul SMS, même si la tâche est rejouée");
    assert.ok(envoyes[0].texte.startsWith(corrige));
    assert.deepEqual([envoyes[0].textePropose, envoyes[0].origine, envoyes[0].modele, envoyes[0].contexteEtape], [propose, "RELANCE", "RELANCE_PHOTOS", "QUALIFICATION"]);
    const relue = await prisma.proposition.findUnique({ where: { id } });
    assert.equal(relue?.modifiee, true, "la correction est mesurée");
  });

  test("le client répond avant la validation : la proposition restée en base devient sans objet", async () => {
    const contact = await dossierOuvert("Hugo", 8);
    const { dossierId, telephone } = contact;
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "DEVIS_ENVOYE" } });
    const { id } = await ancienneProposition(contact, "RELANCE_DEVIS", "Bonjour Hugo, avez-vous pu regarder le devis ?");
    await reception.enregistrerSmsEntrant({ identifiant: "r-3", numero: telephone, texte: "C'est bon pour moi, je signe ce soir", recuLe: new Date(Date.now() + 1000) }, "essai");
    await assert.rejects(avecActeur(LUCAS, () => validation.validerProposition(id)), /sans objet|répondu/i);
    assert.equal(await prisma.sms.count({ where: { dossierId, sens: "SORTANT" } }), 0);
  });

  test("appel sans réponse : rappel posé, le SMS à copier est proposé (plus de second SMS du fournisseur à J+3)", async () => {
    const { dossierId } = await dossierOuvert("Injoignable", 4);
    const suite = await appels.noterAppel({ dossierId, issue: "PAS_DE_REPONSE", note: "" });
    // Mission 14 (partie 4) : le SMS « j'ai essayé de vous joindre » est proposé à l'écran (plus de mail).
    assert.equal(suite.sms?.code, "PAS_DE_REPONSE");
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
    assert.match(dossier?.prochaineAction ?? "", /Rappeler/);
    assert.ok(dossier?.prochaineActionDate && dossier.prochaineActionDate > new Date());
    // Partie 6 : plus aucune proposition « Envoyer un SMS » n'est créée — le 2ᵉ appel sans réponse propose le SMS D à copier.
    const deuxieme = await appels.noterAppel({ dossierId, issue: "PAS_DE_REPONSE", note: "" });
    assert.equal(deuxieme.sms?.code, "PAS_DE_REPONSE_2");
    assert.equal(await prisma.proposition.count({ where: { dossierId, type: "ENVOI_SMS" } }), 0);
  });
});

describe("fin d'appel", () => {
  // Mission 14 (partie 4) : « intéressé » ouvre le dossier et l'espace ; le SMS avec le lien est proposé (plus de mail).
  test("intéressé : dossier et espace ouverts, contact « contacté », le SMS avec le lien de son espace est proposé", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Nadia", nom: "Roux", telephone: "+33612000099", ville: "Sète", source: "META_ADS" } });
    const suite = await appels.noterAppel({ leadId: lead.id, issue: "INTERESSE", note: "Cuisine en U, veut du chêne" });
    assert.deepEqual([suite.cible, suite.sms?.code], ["DOSSIER", "LIEN_ESPACE"]);
    assert.ok(suite.dossierId && (await prisma.espaceClient.findUnique({ where: { dossierId: suite.dossierId } })), "son espace est ouvert");
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.statut, "CONTACTE");
    assert.match((await prisma.dossierEvenement.findFirst({ where: { dossierId: suite.dossierId!, type: "APPEL" } }))?.contenu ?? "", /Intéressé : Cuisine en U/);
  });

  test("à rappeler sans date : aucun rappel inventé ; pas de réponse : demain 18 h à Paris ; pas intéressé : sans suite, avec son motif", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Paul", nom: "Morel", telephone: "+33612000098", ville: "Lattes", source: "META_ADS" } });
    await appels.noterAppel({ leadId: lead.id, issue: "A_RAPPELER", note: "En réunion" });
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.rappelLe, null, "plus de défaut à demain 10 h");
    const suite = await appels.noterAppel({ leadId: lead.id, issue: "PAS_DE_REPONSE", note: "" }, new Date("2026-09-21T15:00:00Z"));
    assert.equal(suite.rappelLe, "2026-09-22T16:00:00.000Z", "18 h à Paris en été = 16 h UTC");
    await appels.noterAppel({ leadId: lead.id, issue: "PAS_INTERESSE", note: "A déjà fait refaire", motifPerte: "PROJET_ABANDONNE" });
    const apres = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.deepEqual([apres?.statut, apres?.rappelLe, apres?.motifPerte], ["PERDU", null, "PROJET_ABANDONNE"]);
  });
});
