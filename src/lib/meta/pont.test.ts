import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.NTFY_TOPIC;
delete process.env.RESEND_API_KEY;

let prisma: typeof import("@/lib/prisma").default;
let pont: typeof import("./pont");
let leads: typeof import("./leads");
let sante: typeof import("./sante");
let communes: typeof import("./communes");
let serveur: Server;

/** La charge exacte que Zapier envoie depuis le déclencheur Facebook Lead Ads. */
const CHARGE_ZAPIER = {
  full_name: "Camille Martin",
  phone_number: "06 12 34 56 78",
  city: "78660",
  form_name: "Rénovation cuisine — Yvelines",
  form_id: "1122334455667788",
  page_id: "998877665544332",
  leadgen_id: "556677889900112",
  created_time: "2026-09-20T09:12:00+0000",
  campaign_id: "120200000000001",
  campaign_name: "Cuisines — septembre",
  adset_id: "120200000000002",
  adset_name: "Yvelines 25 km — 35-65 ans",
  ad_id: "120200000000003",
  ad_name: "Avant/après cuisine chêne",
};

before(async () => {
  // Faux service des communes : aucun appel réel pendant les essais.
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      const code = new URL(requete.url ?? "", "http://x").searchParams.get("codePostal");
      reponse.writeHead(200, { "Content-Type": "application/json" });
      reponse.end(
        JSON.stringify(
          code === "78660"
            ? [
                { nom: "Ablis", population: 3913 },
                { nom: "Orsonville", population: 325 },
              ]
            : code === "34470"
              ? [{ nom: "Pérols", population: 9615 }]
              : []
        )
      );
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  process.env.API_COMMUNES_URL = `http://127.0.0.1:${port}`;
  prisma = (await import("@/lib/prisma")).default;
  pont = await import("./pont");
  leads = await import("./leads");
  sante = await import("./sante");
  communes = await import("./communes");
});
after(async () => {
  await prisma.$disconnect();
  await new Promise<void>((r) => serveur.close(() => r()));
});

describe("lecture d'une charge Zapier", () => {
  test("les quatorze champs sont lus, aucun n'est jeté", () => {
    const lead = pont.leadDepuisChargePlate(CHARGE_ZAPIER);
    assert.equal(lead.leadgenId, "556677889900112");
    assert.equal(lead.pageId, "998877665544332");
    assert.equal(lead.formId, "1122334455667788");
    assert.equal(lead.formNom, "Rénovation cuisine — Yvelines");
    assert.equal(lead.campagneId, "120200000000001");
    assert.equal(lead.campagneNom, "Cuisines — septembre");
    assert.equal(lead.adsetId, "120200000000002");
    assert.equal(lead.adsetNom, "Yvelines 25 km — 35-65 ans");
    assert.equal(lead.adId, "120200000000003");
    assert.equal(lead.adNom, "Avant/après cuisine chêne");
    assert.equal(lead.soumisLe.toISOString(), "2026-09-20T09:12:00.000Z");
    // full_name séparé, téléphone au format international.
    assert.deepEqual([lead.normalise.prenom, lead.normalise.nom], ["Camille", "Martin"]);
    assert.equal(lead.normalise.telephone, "+33612345678");
    // « 78660 » est un code postal, pas une ville.
    assert.equal(lead.normalise.codePostal, "78660");
    assert.equal(lead.normalise.ville, null);
    assert.equal(lead.normalise.email, null);
  });

  test("une ville en toutes lettres reste une ville, une adresse rend les deux", () => {
    assert.equal(pont.leadDepuisChargePlate({ city: "Ablis" }).normalise.ville, "Ablis");
    const melange = pont.leadDepuisChargePlate({ city: "78660 Ablis" }).normalise;
    assert.deepEqual([melange.ville, melange.codePostal], ["Ablis", "78660"]);
    const adresse = pont.leadDepuisChargePlate({ city: "12 rue des Lilas, 34470 Pérols" }).normalise;
    assert.equal(adresse.codePostal, "34470");
    assert.match(adresse.ville ?? "", /Pérols/);
  });

  test("les clés inconnues deviennent des réponses de formulaire", () => {
    const lead = pont.leadDepuisChargePlate({ ...CHARGE_ZAPIER, "Quel est votre projet ?": "Refaire ma cuisine", budget: "3000" });
    const libres = lead.normalise.reponsesLibres.map((r) => `${r.question} : ${r.reponse}`);
    assert.ok(libres.includes("Quel est votre projet ? : Refaire ma cuisine"));
    assert.ok(libres.includes("Budget : 3000"));
    // Les identifiants d'attribution ne sont pas des réponses.
    assert.equal(
      libres.some((l) => l.includes("120200000000001")),
      false
    );
  });

  test("un horodatage en secondes est accepté, une date absente donne maintenant", () => {
    const secondes = String(Math.floor(Date.parse("2026-09-20T09:12:00Z") / 1000));
    assert.equal(pont.leadDepuisChargePlate({ created_time: secondes }).soumisLe.toISOString(), "2026-09-20T09:12:00.000Z");
    assert.ok(Date.now() - pont.leadDepuisChargePlate({}).soumisLe.getTime() < 5000);
  });
});

describe("code postal seul : la commune est déduite, jamais inventée", () => {
  test("une commune unique est certaine, plusieurs rendent la plus peuplée et le disent", async () => {
    communes.viderCacheCommunes();
    assert.deepEqual(await communes.communeDuCodePostal("34470"), { nom: "Pérols", certaine: true, autres: [] });
    assert.deepEqual(await communes.communeDuCodePostal("78660"), { nom: "Ablis", certaine: false, autres: ["Orsonville"] });
    assert.equal(await communes.communeDuCodePostal("00000"), null);
    assert.equal(await communes.communeDuCodePostal("Ablis"), null);
  });
});

describe("un lead Zapier entre par la même porte qu'un lead direct", () => {
  test("tout est stocké : identité, code postal, campagne, ensemble, publicité", async () => {
    const resultat = await leads.recevoirLeadDuPont(CHARGE_ZAPIER);
    assert.ok(resultat.leadId);
    assert.equal(resultat.nouveau, true);
    assert.equal(resultat.rattache, false);

    const lead = await prisma.lead.findUnique({ where: { id: resultat.leadId! } });
    assert.equal(lead?.prenom, "Camille");
    assert.equal(lead?.nom, "Martin");
    assert.equal(lead?.telephone, "+33612345678");
    assert.equal(lead?.email, null);
    assert.equal(lead?.codePostal, "78660");
    assert.equal(lead?.ville, "Ablis");
    assert.equal(lead?.source, "META_ADS");
    assert.equal(lead?.campagne, "Cuisines — septembre");
    assert.equal(lead?.publicite, "Avant/après cuisine chêne");
    assert.equal(lead?.formulaire, "Rénovation cuisine — Yvelines");
    assert.equal(lead?.metaLeadgenId, "556677889900112");
    assert.equal(lead?.createdAt.toISOString(), "2026-09-20T09:12:00.000Z");
    // La déduction de la ville est écrite noir sur blanc dans la fiche.
    assert.match(lead?.notes ?? "", /déduite du code postal 78660 ; aussi Orsonville/);
    assert.ok(lead?.clientId, "le client pérenne doit être rattaché");

    // L'événement Meta existe : c'est ce qui rend le lead visible dans l'écran Publicité.
    const evenement = await prisma.metaLead.findUnique({ where: { leadgenId: "556677889900112" } });
    assert.equal(evenement?.campagneId, "120200000000001");
    assert.equal(evenement?.adsetId, "120200000000002");
    assert.equal(evenement?.adsetNom, "Yvelines 25 km — 35-65 ans");
    assert.equal(evenement?.adId, "120200000000003");
    assert.equal(evenement?.statut, "TRAITE");
    assert.equal(evenement?.leadId, resultat.leadId);

    // La relance à trente minutes est armée.
    const relance = await prisma.tache.findUnique({ where: { cle: "meta-relance:556677889900112" } });
    assert.equal(relance?.statut, "EN_ATTENTE");
    assert.ok(relance && relance.prochainEssaiLe.getTime() - Date.now() > 25 * 60_000);
  });

  test("le même lead renvoyé par Zapier ne crée pas de second contact", async () => {
    const avant = await prisma.lead.count();
    const rejeu = await leads.recevoirLeadDuPont(CHARGE_ZAPIER);
    assert.equal(rejeu.nouveau, false);
    assert.equal(await prisma.lead.count(), avant);
  });

  test("sans e-mail, la déduplication se fait sur le téléphone seul et ne rattache rien à tort", async () => {
    // Un autre contact, sans e-mail lui aussi : il ne doit pas capter le lead.
    await prisma.lead.create({ data: { prenom: "Autre", nom: "Personne", telephone: "+33699999999", ville: "Lattes", source: "SITE_DEVIS" } });
    const autre = await leads.recevoirLeadDuPont({ ...CHARGE_ZAPIER, leadgen_id: "556677889900999", phone_number: "07 11 22 33 44", full_name: "Léa Bernard" });
    assert.equal(autre.rattache, false, "aucun rattachement sans numéro commun");

    // Le même numéro, lui, rattache à la fiche existante et la complète.
    const meme = await leads.recevoirLeadDuPont({
      ...CHARGE_ZAPIER,
      leadgen_id: "556677889901000",
      phone_number: "+33 6 12 34 56 78",
      email: "camille.martin@example.com",
    });
    assert.equal(meme.rattache, true);
    const lead = await prisma.lead.findUnique({ where: { id: meme.leadId! } });
    assert.equal(lead?.email, "camille.martin@example.com");
    // Deux leads Meta pour une seule personne : les deux événements pointent la même fiche.
    assert.equal(await prisma.metaLead.count({ where: { leadId: meme.leadId! } }), 2);
  });
});

describe("résultats par campagne et par publicité", () => {
  test("l'écran Publicité regroupe les leads par campagne puis par publicité", async () => {
    // Un lead archivé (essai, mis de côté) ne compte pas dans le jugement d'une campagne.
    await prisma.metaLead.update({ where: { leadgenId: "556677889900999" }, data: { archiveLe: new Date(), archiveMotif: "essai" } });
    const resultats = await sante.resultatsMeta(21);
    const campagne = resultats.parCampagne.find((c) => c.nom === "Cuisines — septembre");
    assert.ok(campagne, "la campagne doit apparaître");
    assert.equal(campagne!.leads, 2, "trois leads reçus, un archivé : deux comptés");
    const publicite = resultats.parPublicite.find((p) => p.nom === "Avant/après cuisine chêne");
    assert.equal(publicite?.leads, 2);
    assert.equal(resultats.jours, 21);
  });
});
