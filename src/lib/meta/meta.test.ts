import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.META_APP_SECRET = "secret-essai-meta";
process.env.META_VERIFY_TOKEN = "jeton-verification-essai";
// Aucun canal de notification pendant les essais : rien ne part vers l'extérieur.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.NTFY_TOPIC;
delete process.env.RESEND_API_KEY;

let prisma: typeof import("@/lib/prisma").default;
let signature: typeof import("./signature");
let champs: typeof import("./champs");
let leads: typeof import("./leads");
let conversions: typeof import("./conversions");
let taches: typeof import("./taches");
let essai: typeof import("./essai");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  signature = await import("./signature");
  champs = await import("./champs");
  leads = await import("./leads");
  conversions = await import("./conversions");
  taches = await import("./taches");
  essai = await import("./essai");
});
after(async () => {
  await prisma.$disconnect();
});

const CHARGE = {
  object: "page",
  entry: [
    {
      id: "153125381133",
      time: 1438292065,
      changes: [{ field: "leadgen", value: { leadgen_id: "123123123123", page_id: "123123123", form_id: "12312312312", adgroup_id: "12312312312", created_time: 1440120384 } }],
    },
  ],
};

describe("signature du webhook Meta", () => {
  const corps = JSON.stringify(CHARGE);

  test("la signature de Meta est acceptée, tout le reste est refusé", () => {
    const bonne = signature.signerCommeMeta(corps, "secret-essai-meta");
    assert.deepEqual(signature.verifierSignatureMeta(corps, bonne, "secret-essai-meta"), { ok: true });
    // Un faux secret ne passe pas.
    assert.equal(signature.verifierSignatureMeta(corps, signature.signerCommeMeta(corps, "autre-secret"), "secret-essai-meta").ok, false);
    // Le corps modifié d'un seul caractère ne passe pas non plus.
    assert.equal(signature.verifierSignatureMeta(`${corps} `, bonne, "secret-essai-meta").ok, false);
  });

  test("les formes invalides sont nommées, et sans secret configuré rien ne passe", () => {
    const attendue = `sha256=${createHmac("sha256", "secret-essai-meta").update(corps).digest("hex")}`;
    assert.equal(signature.verifierSignatureMeta(corps, attendue, undefined).ok, false);
    assert.deepEqual(signature.verifierSignatureMeta(corps, attendue, undefined), { ok: false, raison: "secret-absent" });
    assert.deepEqual(signature.verifierSignatureMeta(corps, null, "secret-essai-meta"), { ok: false, raison: "entete-absente" });
    assert.deepEqual(signature.verifierSignatureMeta(corps, "sha1=abc", "secret-essai-meta"), { ok: false, raison: "format" });
    assert.deepEqual(signature.verifierSignatureMeta(corps, "sha256=pastroplong", "secret-essai-meta"), { ok: false, raison: "format" });
  });
});

describe("lecture de la charge du webhook", () => {
  test("l'événement leadgen est lu tel que Meta l'envoie", () => {
    assert.deepEqual(leads.evenementsDeLaCharge(CHARGE), [
      { leadgenId: "123123123123", pageId: "123123123", formId: "12312312312", adId: "12312312312", adsetId: null, creeLe: 1440120384 },
    ]);
  });

  test("tout ce qui n'est pas un leadgen exploitable est ignoré", () => {
    assert.deepEqual(leads.evenementsDeLaCharge({ object: "page", entry: [{ changes: [{ field: "feed", value: { post_id: "1" } }] }] }), []);
    assert.deepEqual(leads.evenementsDeLaCharge({ object: "instagram", entry: [] }), []);
    assert.deepEqual(leads.evenementsDeLaCharge({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "abc" } }] }] }), []);
    assert.deepEqual(leads.evenementsDeLaCharge(null), []);
  });
});

describe("réponses du formulaire Meta", () => {
  test("les champs standard vont dans les bons champs du CRM", () => {
    const n = champs.normaliserLeadMeta([
      { name: "full_name", values: ["Camille Martin"] },
      { name: "phone_number", values: ["06 12 34 56 78"] },
      { name: "email", values: [" Camille.Martin@Example.COM "] },
      { name: "city", values: ["Pérols"] },
      { name: "post_code", values: ["34470"] },
    ]);
    assert.equal(n.prenom, "Camille");
    assert.equal(n.nom, "Martin");
    assert.equal(n.telephone, "+33612345678");
    assert.equal(n.email, "camille.martin@example.com");
    assert.equal(n.ville, "Pérols");
    assert.equal(n.codePostal, "34470");
  });

  test("les questions personnalisées sont gardées mot pour mot et donnent le type de projet", () => {
    const n = champs.normaliserLeadMeta([
      { name: "first_name", values: ["Léa"] },
      { name: "last_name", values: ["Dupont"] },
      { name: "phone_number", values: ["+33 6 98 76 54 32"] },
      { name: "quelle_pièce_souhaitez-vous_rénover_?", values: ["Ma salle de bain"] },
      { name: "quel_est_votre_budget_?", values: ["2 000 à 3 000 €"] },
      { name: "êtes-vous_propriétaire_?", values: ["Oui"] },
    ]);
    assert.equal(n.typeProjet, "SDB");
    assert.equal(n.reponses.length, 6);
    const libres = n.reponsesLibres.map((r) => `${r.question} : ${r.reponse}`);
    assert.deepEqual(libres, [
      "Quelle pièce souhaitez-vous rénover ? : Ma salle de bain",
      "Quel est votre budget ? : 2 000 à 3 000 €",
      "Êtes-vous propriétaire ? : Oui",
    ]);
    // Le nom du champ Meta reste disponible pour retrouver l'origine d'une réponse.
    assert.equal(n.reponses[3].cle, "quelle_pièce_souhaitez-vous_rénover_?");
  });

  test("une question en français remplace un champ standard absent", () => {
    const n = champs.normaliserLeadMeta([
      { name: "full_name", values: ["Jean"] },
      { name: "votre_ville_?", values: ["34000 Montpellier"] },
      { name: "votre_numéro_de_téléphone", values: ["0499887766"] },
      { name: "votre_courriel", values: ["jean@example.com"] },
    ]);
    assert.equal(n.ville, "Montpellier");
    assert.equal(n.codePostal, "34000");
    assert.equal(n.telephone, "+33499887766");
    assert.equal(n.email, "jean@example.com");
    // Un prénom seul reste exploitable.
    assert.deepEqual([n.prenom, n.nom], ["Jean", "Jean"]);
  });

  test("un formulaire vide ne fait jamais planter la chaîne", () => {
    const n = champs.normaliserLeadMeta([]);
    assert.deepEqual([n.prenom, n.nom, n.telephone, n.typeProjet], ["Inconnu", "Inconnu", "", "CUISINE"]);
  });
});

describe("conversions renvoyées à Meta", () => {
  test("le hachage suit la normalisation imposée par Meta", () => {
    assert.equal(conversions.normaliserPourHachage("em", "  Camille.Martin@Example.COM "), "camille.martin@example.com");
    // Format international, sans le « + », sans zéro initial.
    assert.equal(conversions.normaliserPourHachage("ph", "06 12 34 56 78"), "33612345678");
    assert.equal(conversions.normaliserPourHachage("fn", "Léa-Marie"), "leamarie");
    assert.equal(conversions.normaliserPourHachage("ct", "Saint-Jean-de-Védas"), "saintjeandevedas");
    assert.equal(conversions.normaliserPourHachage("zp", "34 470"), "34470");
    assert.equal(conversions.normaliserPourHachage("em", "pas-un-email"), null);
  });

  test("chaque étape du dossier a son événement, et le perdu est un signal négatif", () => {
    assert.equal(conversions.ETAPES_CONVERSION.DEVIS_ENVOYE.positif, true);
    assert.equal(conversions.ETAPES_CONVERSION.SIGNE.positif, true);
    assert.equal(conversions.ETAPES_CONVERSION.ENCAISSE.positif, true);
    assert.equal(conversions.ETAPES_CONVERSION.PERDU.positif, false);
    const noms = Object.values(conversions.ETAPES_CONVERSION).map((e) => e.evenement);
    assert.equal(new Set(noms).size, noms.length, "deux étapes ne doivent pas partager le même nom d'événement");
  });

  test("sans identifiant à rattacher, rien n'est envoyé", async () => {
    const resultat = await conversions.envoyerConversion({ etape: "SIGNE", evenementId: "essai-sans-rattachement" });
    assert.equal(resultat.ok, false);
    assert.equal(resultat.inactif, true);
    assert.equal(resultat.trace.rattachement, "aucun");
  });
});

describe("échéance du jeton Meta", () => {
  const maintenant = new Date("2026-09-20T12:00:00Z");
  const dans = (jours: number) => new Date(maintenant.getTime() + jours * 86_400_000).toISOString();

  test("un jeton de page sans expiration est sain", () => {
    assert.equal(taches.verdictJeton({ valide: true, expireLe: null, accesExpireLe: null }, maintenant).etat, "sain");
  });

  test("l'échéance la plus proche l'emporte, et l'alerte part sept jours avant", () => {
    assert.equal(taches.verdictJeton({ valide: true, expireLe: null, accesExpireLe: dans(30) }, maintenant).etat, "sain");
    assert.equal(taches.verdictJeton({ valide: true, expireLe: dans(60), accesExpireLe: dans(5) }, maintenant).etat, "proche");
    assert.equal(taches.verdictJeton({ valide: true, expireLe: dans(-1), accesExpireLe: dans(60) }, maintenant).etat, "expire");
    assert.equal(taches.verdictJeton({ valide: false, expireLe: null, accesExpireLe: null, erreur: "Session invalidée" }, maintenant).etat, "invalide");
    assert.equal(taches.verdictJeton(null, maintenant).etat, "absent");
  });
});

describe("chaîne complète, sans appeler Meta", () => {
  test("un formulaire rempli devient un contact, et le même rejoué n'en crée pas un second", async () => {
    const rapport = await essai.lancerEssaiMeta({ notifier: false });
    const echecs = rapport.etapes.filter((e) => !e.ok);
    assert.deepEqual(
      echecs.map((e) => `${e.etape} : ${e.detail}`),
      [],
      "toutes les étapes de l'essai doivent passer"
    );
    assert.ok(rapport.leadId);

    // Le contact existe avec ses champs, archivé par le ménage de l'essai.
    const lead = await prisma.lead.findUnique({ where: { id: rapport.leadId! } });
    assert.equal(lead?.source, "META_ADS");
    assert.equal(lead?.metaLeadgenId, rapport.leadgenId);
    assert.equal(lead?.campagne, "Campagne d'essai — Cuisines septembre");
    assert.ok(lead?.archiveLe, "le contact d'essai doit être archivé");

    // Un seul événement Meta, un seul contact, quoi qu'il arrive.
    const evenements = await prisma.metaLead.count({ where: { leadgenId: rapport.leadgenId, archiveLe: undefined } });
    assert.equal(evenements, 1);
  });

  test("la relance ne part pas quand la fiche a été ouverte", async () => {
    const leadgenId = "99999990000000001";
    await prisma.metaLead.create({ data: { leadgenId, soumisLe: new Date() } });
    const lead = await prisma.lead.create({
      data: { prenom: "ESSAI", nom: "Relance", telephone: "+33600000098", ville: "Pérols", source: "META_ADS", statut: "NOUVEAU", metaLeadgenId: leadgenId },
    });
    await prisma.metaLead.update({ where: { leadgenId }, data: { leadId: lead.id, statut: "TRAITE" } });

    // Fiche ouverte : plus de relance.
    await leads.marquerFicheVue(lead.id);
    assert.equal(await leads.relancerSiNonTraite(leadgenId, lead.id), false);

    // Fiche jamais ouverte et contact resté « à traiter » : la relance part.
    await prisma.lead.update({ where: { id: lead.id }, data: { vuLe: null } });
    assert.equal(await leads.relancerSiNonTraite(leadgenId, lead.id), true);

    // Un appel déjà passé vaut traitement : plus de relance.
    await prisma.interaction.create({ data: { type: "APPEL", contenu: "Rappelé", leadId: lead.id } });
    assert.equal(await leads.relancerSiNonTraite(leadgenId, lead.id), false);

    await prisma.lead.update({ where: { id: lead.id }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
    await prisma.metaLead.update({ where: { leadgenId }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
  });

  test("un lead Meta qui correspond à un contact existant est rattaché, pas dupliqué", async () => {
    const existant = await prisma.lead.create({
      data: { prenom: "ESSAI", nom: "Doublon", telephone: "+33600000097", ville: "Non renseignée", source: "SITE_DEVIS", statut: "NOUVEAU" },
    });
    const leadgenId = "99999990000000002";
    await prisma.metaLead.create({ data: { leadgenId, soumisLe: new Date() } });
    const resultat = await leads.traiterLeadMeta(leadgenId, async () => ({
      normalise: champs.normaliserLeadMeta([
        { name: "full_name", values: ["ESSAI Doublon"] },
        { name: "phone_number", values: ["06 00 00 00 97"] },
        { name: "email", values: ["doublon@example.com"] },
        { name: "city", values: ["Lattes"] },
      ]),
      soumisLe: new Date(),
      formId: null,
      formNom: null,
      adId: null,
      adNom: null,
      adsetId: null,
      adsetNom: null,
      campagneId: null,
      campagneNom: null,
      plateforme: null,
      organique: false,
    }));

    assert.equal(resultat.leadId, existant.id, "le lead doit être rattaché au contact existant");
    assert.equal(resultat.rattache, true);
    const apres = await prisma.lead.findUnique({ where: { id: existant.id } });
    // Enrichi : l'e-mail et la ville manquants sont complétés, le reste est laissé tel quel.
    assert.equal(apres?.email, "doublon@example.com");
    assert.equal(apres?.ville, "Lattes");
    assert.equal(await prisma.lead.count({ where: { telephone: { contains: "600000097" } } }), 1);

    await prisma.lead.update({ where: { id: existant.id }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
    await prisma.metaLead.update({ where: { leadgenId }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
  });
});
