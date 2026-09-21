import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-relances-"));

let prisma: typeof import("@/lib/prisma").default;
let relances: typeof import("./relances");
let appels: typeof import("./appels");
let liens: typeof import("@/lib/espace/liens");
let envoi: typeof import("@/lib/sms/envoi");
let reception: typeof import("@/lib/sms/reception");
let validation: typeof import("@/lib/validation/service");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;

const LUCAS = { acteur: "HUMAIN:lucas@exemple.test" };
const JOUR = 86_400_000;
const contexte = { tacheId: "essai", tentative: 1, signal: new AbortController().signal };

function reglerEnvironnement(): void {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
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
  return { leadId: lead.id, dossierId, espaceId: espace.id };
}

const propositionsDe = (dossierId: string, type = "ENVOI_SMS") => prisma.proposition.findMany({ where: { dossierId, type }, orderBy: { createdAt: "asc" } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  reglerEnvironnement();
  relances = await import("./relances");
  appels = await import("./appels");
  liens = await import("@/lib/espace/liens");
  envoi = await import("@/lib/sms/envoi");
  reception = await import("@/lib/sms/reception");
  validation = await import("@/lib/validation/service");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  await (await import("@/lib/sms/modeles")).poserModelesParDefaut();
});
after(async () => {
  await prisma.$disconnect();
});

describe("relances proposées, jamais envoyées seules", () => {
  test("photos non déposées à J+2 : un message pré-rédigé avec le lien, proposé une seule fois", async () => {
    const recent = await dossierOuvert("Trop", 1);
    const mur = await dossierOuvert("Camille", 3);
    const resume = await relances.proposerRelancesSms();
    assert.ok(resume.proposees >= 1);
    assert.equal((await propositionsDe(recent.dossierId)).length, 0, "un jour seulement : trop tôt");
    const [proposition] = await propositionsDe(mur.dossierId);
    assert.equal(proposition.statut, "EN_ATTENTE");
    const contenu = JSON.parse(proposition.contenu) as { motif: string; texte: string };
    assert.equal(contenu.motif, "RELANCE_PHOTOS");
    assert.match(contenu.texte, /^Bonjour Camille, Lucas de CoverSwap\. Avez-vous pu prendre 2 ou 3 photos \? .*https:\/\/coverswap\.fr\/e\//);
    assert.equal(await prisma.sms.count({ where: { dossierId: mur.dossierId } }), 0, "rien n'est parti");

    await relances.proposerRelancesSms();
    assert.equal((await propositionsDe(mur.dossierId)).length, 1, "proposée une seule fois");
  });

  test("Lucas corrige puis valide : le SMS part avec SON texte, et les deux versions sont gardées", async () => {
    const { dossierId } = await dossierOuvert("Élise", 3);
    await relances.proposerRelancesSms();
    const [proposition] = await propositionsDe(dossierId);
    const propose = (JSON.parse(proposition.contenu) as { texte: string }).texte;
    const corrige = "Bonjour Élise, c'est Lucas. Vous avez pu faire les photos de la cuisine ? Je vous prépare la simulation dès que je les ai.";

    await assert.rejects(avecActeur({ acteur: "SYSTEME:relances" }, () => validation.validerProposition(proposition.id)), /Seule une personne/, "rien ne part sans une décision humaine");
    await avecActeur(LUCAS, () => validation.validerProposition(proposition.id, { texte: corrige }));
    await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte);
    await validation.executerPropositionValidee({ propositionId: proposition.id }, contexte); // tâche rejouée

    const envoyes = await prisma.sms.findMany({ where: { dossierId, sens: "SORTANT" } });
    assert.equal(envoyes.length, 1, "un seul SMS, même si la tâche est rejouée");
    assert.ok(envoyes[0].texte.startsWith(corrige));
    assert.deepEqual([envoyes[0].textePropose, envoyes[0].origine, envoyes[0].modele, envoyes[0].contexteEtape], [propose, "RELANCE", "RELANCE_PHOTOS", "QUALIFICATION"]);
    const relue = await prisma.proposition.findUnique({ where: { id: proposition.id } });
    assert.equal(relue?.modifiee, true, "la correction est mesurée");
  });

  test("le client vient de répondre, a dit STOP, ou a déjà reçu cinq SMS : aucune relance", async () => {
    const repondu = await dossierOuvert("Repond", 5);
    const lead = await prisma.lead.findUnique({ where: { id: repondu.leadId } });
    await reception.enregistrerSmsEntrant({ identifiant: "r-1", numero: lead!.telephone, texte: "Je vous envoie ça demain", recuLe: new Date() }, "essai");

    const stop = await dossierOuvert("Stop", 5);
    const leadStop = await prisma.lead.findUnique({ where: { id: stop.leadId } });
    await reception.enregistrerSmsEntrant({ identifiant: "r-2", numero: leadStop!.telephone, texte: "STOP", recuLe: new Date() }, "essai");

    const sature = await dossierOuvert("Sature", 9);
    const leadSature = await prisma.lead.findUnique({ where: { id: sature.leadId } });
    for (let i = 0; i < 5; i++) {
      const sms = await envoi.envoyerSms({ numero: leadSature!.telephone, rattachement: { leadId: sature.leadId }, texte: `Message ${i + 1}` });
      await prisma.sms.update({ where: { id: sms.id }, data: { createdAt: new Date(Date.now() - (8 - i) * JOUR) } });
    }

    const resume = await relances.proposerRelancesSms();
    assert.equal((await propositionsDe(repondu.dossierId)).length, 0, "il a répondu hier : on le laisse tranquille");
    assert.equal((await propositionsDe(stop.dossierId)).length, 0);
    assert.equal((await propositionsDe(sature.dossierId)).length, 0);
    assert.ok(resume.plafond >= 1, "le plafond de cinq messages en dix jours est compté");
    assert.ok(resume.stop >= 1);
  });

  test("devis non signé à J+4 ; et si le client répond avant la validation, la proposition devient sans objet", async () => {
    const { dossierId, leadId } = await dossierOuvert("Hugo", 8);
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "DEVIS_ENVOYE", photos: JSON.stringify(["dossiers/x/photos/a-12345678.jpg"]) } });
    await prisma.document.create({ data: { dossierId, type: "DEVIS", numero: "D-REL-0001", dateEmission: new Date(Date.now() - 5 * JOUR), objet: "Cuisine", lignes: "[]", totalHt: 1500, statut: "ENVOYE" } });
    await relances.proposerRelancesSms();
    const [proposition] = await propositionsDe(dossierId);
    const contenu = JSON.parse(proposition.contenu) as { motif: string; texte: string };
    assert.equal(contenu.motif, "RELANCE_DEVIS");
    assert.match(contenu.texte, /je bloque mes prochains chantiers/);

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    await reception.enregistrerSmsEntrant({ identifiant: "r-3", numero: lead!.telephone, texte: "C'est bon pour moi, je signe ce soir", recuLe: new Date() }, "essai");
    await assert.rejects(avecActeur(LUCAS, () => validation.validerProposition(proposition.id)), /sans objet|répondu/i);
    assert.equal(await prisma.sms.count({ where: { dossierId, sens: "SORTANT" } }), 0);
  });

  test("appel sans réponse : rappel posé au lendemain, second SMS proposé à J+3", async () => {
    const { dossierId } = await dossierOuvert("Injoignable", 4);
    const suite = await appels.noterAppel({ dossierId, issue: "PAS_DE_REPONSE", note: "" });
    assert.equal(suite.messagePropose, "INJOIGNABLE_LIEN");
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
    assert.match(dossier?.prochaineAction ?? "", /Rappeler/);
    assert.ok(dossier?.prochaineActionDate && dossier.prochaineActionDate > new Date());

    await prisma.dossierEvenement.updateMany({ where: { dossierId, type: "APPEL" }, data: { createdAt: new Date(Date.now() - 3.2 * JOUR) } });
    await relances.proposerRelancesSms();
    const [proposition] = await propositionsDe(dossierId);
    assert.equal((JSON.parse(proposition.contenu) as { motif: string }).motif, "INJOIGNABLE_J3");
  });

  test("silence de dix jours : dernière relance ; restée sans réponse, le dossier est proposé « perdu — sans réponse »", async () => {
    const { dossierId, leadId } = await dossierOuvert("Silence", 12);
    await relances.proposerRelancesSms();
    const [derniere] = await propositionsDe(dossierId);
    assert.equal((JSON.parse(derniere.contenu) as { motif: string }).motif, "RELANCE_DERNIERE");
    await avecActeur(LUCAS, () => validation.validerProposition(derniere.id));
    await validation.executerPropositionValidee({ propositionId: derniere.id }, contexte);
    const sms = await prisma.sms.findFirst({ where: { dossierId, modele: "RELANCE_DERNIERE" } });
    assert.ok(sms, "la dernière relance est partie");

    // Six jours plus tard, toujours rien.
    await prisma.sms.update({ where: { id: sms!.id }, data: { createdAt: new Date(Date.now() - 6 * JOUR) } });
    const resume = await relances.proposerRelancesSms();
    assert.ok(resume.perdusProposes >= 1);
    const [perdu] = await propositionsDe(dossierId, "CHANGEMENT_ETAPE");
    assert.deepEqual([(JSON.parse(perdu.contenu) as { vers: string; motifPerte: string }).vers, (JSON.parse(perdu.contenu) as { motifPerte: string }).motifPerte], ["PERDU", "SANS_REPONSE"]);
    assert.equal((await propositionsDe(dossierId)).length, 1, "plus aucun SMS n'est proposé après la dernière relance");
    assert.ok(leadId);
  });
});

describe("fin d'appel", () => {
  test("intéressé : contact « contacté », et le lien de son espace est le message proposé", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Nadia", nom: "Roux", telephone: "+33612000099", ville: "Sète", source: "META_ADS" } });
    const suite = await appels.noterAppel({ leadId: lead.id, issue: "INTERESSE", note: "Cuisine en U, veut du chêne" });
    assert.deepEqual([suite.cible, suite.messagePropose], ["CONTACT", "LIEN_ESPACE"]);
    assert.equal((await prisma.lead.findUnique({ where: { id: lead.id } }))?.statut, "CONTACTE");
    assert.match((await prisma.interaction.findFirst({ where: { leadId: lead.id, type: "APPEL" } }))?.contenu ?? "", /Intéressé : Cuisine en U/);
  });

  test("à rappeler : demain 10 h à Paris par défaut ; pas intéressé : sans suite", async () => {
    const dixHeures = appels.demainDixHeures(new Date("2026-09-21T15:00:00Z"));
    assert.equal(dixHeures.toISOString(), "2026-09-22T08:00:00.000Z", "10 h à Paris en été = 8 h UTC");
    assert.equal(appels.demainDixHeures(new Date("2026-12-01T15:00:00Z")).toISOString(), "2026-12-02T09:00:00.000Z", "10 h à Paris en hiver = 9 h UTC");

    const lead = await prisma.lead.create({ data: { prenom: "Paul", nom: "Morel", telephone: "+33612000098", ville: "Lattes", source: "META_ADS" } });
    await appels.noterAppel({ leadId: lead.id, issue: "A_RAPPELER", note: "En réunion" });
    assert.ok((await prisma.lead.findUnique({ where: { id: lead.id } }))?.rappelLe);
    await appels.noterAppel({ leadId: lead.id, issue: "PAS_INTERESSE", note: "A déjà fait refaire" });
    const apres = await prisma.lead.findUnique({ where: { id: lead.id } });
    assert.deepEqual([apres?.statut, apres?.rappelLe], ["PERDU", null]);
  });
});
