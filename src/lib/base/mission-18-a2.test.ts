import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-a2-"));

/**
 * Mission 18 (A2) — le dossier s'ouvre tout seul dès qu'un contact envoie des photos, fait une simulation ou demande un
 * devis sur le site : par le webhook (POST /api/webhook, comme le site l'envoie), en Qualification, « Appeler : … » pour
 * aujourd'hui, et la tâche « Appeler · Nom » du dossier remplace celle du lead ; le contact reste dans « À appeler »
 * jusqu'au premier appel. Un lead Meta, un simple message ou un ancien lead sans fait nouveau n'ouvrent rien. Le tunnel
 * du simulateur affiche toujours le lien à un contact neuf. `fetch` est remplacé : une requête réseau fait échouer le
 * test. Aucun mail ni SMS ne part (canaux vidés par `preparerBaseEssai`). Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let webhook: typeof import("@/app/api/webhook/route");
let depuisLead: typeof import("@/lib/dossiers/depuis-lead");
let leads: typeof import("@/lib/prospects/leads");
let quand: typeof import("@/lib/commercial/quand");
let dates: typeof import("@/lib/dossiers/dates");
let detection: typeof import("@/lib/a-faire/detection");
let detecteurDossiers: typeof import("@/lib/a-faire/detecteurs/dossiers").detecteurDossiers;
let detecteurLeads: typeof import("@/lib/a-faire/detecteurs/leads").detecteurLeads;

const fetchOrigine = globalThis.fetch;
const requetesReseau: string[] = [];
const SECRET = "secret-webhook-des-essais-a2";
let ipSuivante = 10;

async function jpegDataUrl(couleur: { r: number; g: number; b: number }): Promise<string> {
  const { default: sharp } = await import("sharp");
  const octets = await sharp({ create: { width: 64, height: 48, channels: 3, background: couleur } }).jpeg({ quality: 70 }).toBuffer();
  return `data:image/jpeg;base64,${octets.toString("base64")}`;
}

/** POST /api/webhook comme le site l'envoie (secret, une IP de visiteur par appel). */
async function envoyer(corps: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const reponse = await webhook.POST(
    new NextRequest("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(corps),
      headers: { "content-type": "application/json", "x-webhook-secret": SECRET, "x-visiteur-ip": `198.51.100.${ipSuivante++}` },
    })
  );
  return { status: reponse.status, json: (await reponse.json()) as Record<string, unknown> };
}

/** Le dossier rendu par le webhook (il doit y en avoir un). */
async function dossierDe(json: Record<string, unknown>) {
  assert.ok(json.dossierId, "le webhook rend le dossier ouvert");
  return prisma.dossier.findUniqueOrThrow({ where: { id: String(json.dossierId) } });
}

const aujourdhuiMidi = () => `${dates.jourParis(new Date())}T12:00:00.000Z`;
const dansAAppeler = async (leadId: string) => (await leads.listerLeads({ vue: "A_APPELER", limite: 500 })).lignes.find((l) => l.id === leadId) ?? null;

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.ESPACE_CLIENT_SECRET = "secret-espace-des-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  process.env.WEBHOOK_SECRET = SECRET;
  process.env.WEBHOOK_SECRET_PRECEDENT = "";
  process.env.EMAIL_FROM = "";
  process.env.TACHES_DESACTIVEES = "1";
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  webhook = await import("@/app/api/webhook/route");
  depuisLead = await import("@/lib/dossiers/depuis-lead");
  leads = await import("@/lib/prospects/leads");
  quand = await import("@/lib/commercial/quand");
  dates = await import("@/lib/dossiers/dates");
  detection = await import("@/lib/a-faire/detection");
  detecteurDossiers = (await import("@/lib/a-faire/detecteurs/dossiers")).detecteurDossiers;
  detecteurLeads = (await import("@/lib/a-faire/detecteurs/leads")).detecteurLeads;
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("mission 18 (A2) — le dossier s'ouvre tout seul depuis le site", () => {
  test("demande de devis sans photo : dossier en Qualification, « Appeler : demande de devis » pour aujourd'hui ; dans « À appeler » ; aucun envoi", async () => {
    const debut = new Date();
    const mails = await prisma.envoiMail.count();
    const { status, json } = await envoyer({ prenom: "Lina", nom: "Essai", telephone: "0611180001", email: "lina.essai@example.test", ville: "Lattes", codePostal: "34970", source: "SITE_CONTACT", typeProjet: "CUISINE", message: "Un devis pour ma cuisine" });
    assert.equal(status, 200);
    const dossier = await dossierDe(json);
    assert.deepEqual(
      [dossier.leadId, dossier.etape, dossier.source, dossier.clientNom, dossier.prochaineAction, dossier.prochaineActionDate?.toISOString()],
      [json.leadId, "QUALIFICATION", "ENTRANT", "Lina Essai", "Appeler : demande de devis", aujourdhuiMidi()]
    );
    // Le lead sort des leads sans dossier, mais la file des appels le garde jusqu'au premier appel.
    assert.equal(await prisma.lead.count({ where: { AND: [leads.LEAD_SANS_DOSSIER, { id: String(json.leadId) }] } }), 0);
    assert.equal((await dansAAppeler(String(json.leadId)))?.dossierId, dossier.id);
    // Rien ne part de plus vers le client : seul l'accusé de réception automatique habituel (nouveau contact).
    assert.equal(await prisma.envoiMail.count(), mails, "aucun mail");
    assert.equal(await prisma.sms.count({ where: { createdAt: { gte: debut }, origine: { not: "ACCUSE_AUTO" } } }), 0, "aucun SMS hors accusé");
    assert.deepEqual(requetesReseau, [], "aucune requête réseau");
  });

  test("la tâche « Appeler · Nom » est sur le dossier, avec son motif ; aucune tâche « Appeler » sur le lead", async () => {
    const { json } = await envoyer({ prenom: "Malo", nom: "Essai", telephone: "0611180002", ville: "Pérols", source: "SITE_PRO", typeProjet: "PRO", message: "Hôtel, 8 chambres" });
    const dossier = await dossierDe(json);
    const maintenant = new Date();
    await detection.passeComplete(maintenant, { detecteurs: [detecteurDossiers, detecteurLeads] });
    const tache = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: `RAPPELER:dossier:${dossier.id}` } });
    const raccourci = JSON.parse(tache.raccourci) as { genre: string; libelle: string; dossierId: string };
    assert.deepEqual([tache.statut, tache.titre, tache.niveau], ["A_FAIRE", "Appeler · Malo Essai", 2]);
    assert.match(tache.raison, /^demande de devis, prévu le \d{2}\/\d{2}$/);
    assert.deepEqual([raccourci.genre, raccourci.libelle, raccourci.dossierId], ["APPEL", "Appeler", dossier.id]);
    assert.equal(await prisma.tacheAFaire.count({ where: { cle: `APPELER:lead:${String(json.leadId)}` } }), 0, "pas de doublon sur le lead");
    // Ouvrir n'est pas appeler : un second passage ne coche rien.
    await detection.passeComplete(new Date(maintenant.getTime() + 60_000), { detecteurs: [detecteurDossiers, detecteurLeads] });
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: tache.cle } })).statut, "A_FAIRE");
    // L'appel noté « Intéressé » y répond : l'action automatique s'efface, la tâche est cochée par le CRM.
    const { noterAppel } = await import("@/lib/commercial/appels");
    await noterAppel({ leadId: String(json.leadId), issue: "INTERESSE", note: "" });
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).prochaineAction, null);
    await detection.passeComplete(new Date(Date.now() + 120_000), { detecteurs: [detecteurDossiers, detecteurLeads] });
    const cochee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { cle: tache.cle } });
    assert.equal(cochee.statut, "FAITE");
    assert.match(cochee.reponseTexte ?? "", /appel noté/);
    // Une action écrite par Lucas, elle, survit à l'appel.
    await prisma.dossier.update({ where: { id: dossier.id }, data: { prochaineAction: "Appeler : rendez-vous à fixer" } });
    await noterAppel({ dossierId: dossier.id, issue: "INTERESSE", note: "" });
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).prochaineAction, "Appeler : rendez-vous à fixer");
  });

  test("simulation du site sans le drapeau du tunnel : dossier ouvert, simulation rangée, aucun espace", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const parcoursId = "a2a2a2a2-1804-4000-8000-000000000001";
    const simulation = await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 120, g: 110, b: 100 }), imageApresBase64: await jpegDataUrl({ r: 20, g: 30, b: 40 }) });
    const { json } = await envoyer({ prenom: "Noé", nom: "Essai", telephone: "0611180003", ville: "Mauguio", source: "SITE_SIMULATEUR", parcoursId, simulationIds: [simulation.id] });
    const dossier = await dossierDe(json);
    assert.deepEqual([dossier.etape, dossier.prochaineAction, dossier.prochaineActionDate?.toISOString()], ["QUALIFICATION", "Appeler : simulation faite sur le site", aujourdhuiMidi()]);
    assert.equal(await prisma.simulation.count({ where: { leadId: String(json.leadId), dossierId: dossier.id } }), 1, "rangée dans le dossier");
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: dossier.id } }), 0, "aucun espace : le site ne l'a pas demandé");
    assert.equal(json.lienEspace, null);
  });

  test("photos jointes à une demande : dossier ouvert, photos rangées", async () => {
    const { json } = await envoyer({ prenom: "Oriane", nom: "Essai", telephone: "0611180004", ville: "Sète", source: "SITE_DEVIS", typeProjet: "SDB", photos: [await jpegDataUrl({ r: 200, g: 10, b: 10 }), await jpegDataUrl({ r: 10, g: 200, b: 10 })] });
    assert.equal(json.photos, 2);
    const dossier = await dossierDe(json);
    assert.equal(dossier.prochaineAction, "Appeler : demande de devis");
    assert.equal(await prisma.photoLead.count({ where: { leadId: String(json.leadId), dossierId: dossier.id } }), 2);
  });

  test("rappel demandé avec la demande : « Rappeler » à l'heure exacte sur le dossier, plus sur le lead", async () => {
    const rappel = quand.rappelDuCreneau("demain-10h", new Date());
    const { json } = await envoyer({ prenom: "Pia", nom: "Essai", telephone: "0611180005", ville: "Lunel", source: "SITE_CONTACT", typeProjet: "MEUBLES", rappelCreneau: "demain-10h" });
    const dossier = await dossierDe(json);
    assert.deepEqual([dossier.prochaineAction, dossier.prochaineActionInstant?.toISOString()], ["Rappeler", rappel.toISOString()]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: String(json.leadId) } })).rappelLe, null);
  });

  test("tunnel du simulateur : un contact neuf voit toujours son lien ; un seul dossier, avec son espace", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const parcoursId = "a2a2a2a2-1804-4000-8000-000000000002";
    const simulation = await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 60, g: 60, b: 60 }), imageApresBase64: await jpegDataUrl({ r: 90, g: 80, b: 70 }) });
    const { json } = await envoyer({ prenom: "Quentin", nom: "Essai", telephone: "0611180006", ville: "Agde", source: "SITE_SIMULATEUR", parcoursId, simulationIds: [simulation.id], afficherLienEspace: true });
    assert.match(String(json.lienEspace), /^https:\/\/coverswap\.fr\/e\//, "le dossier ouvert d'abord ne le rend pas « déjà connu »");
    const dossier = await dossierDe(json);
    assert.equal(await prisma.dossier.count({ where: { leadId: String(json.leadId) } }), 1);
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: dossier.id } }), 1);
    assert.equal(dossier.prochaineAction, "Appeler : simulation faite sur le site");
  });

  test("rien ne s'ouvre : lead Meta, simple message du site, ancien lead qui réécrit sans fait nouveau ; le filet non plus", async () => {
    const meta = await envoyer({ first_name: "Rémi", last_name: "Essai", phone: "0611180007", city: "Lattes", form_name: "Cuisine", campaign_name: "Cuisine octobre" });
    assert.equal(meta.status, 200);
    assert.equal(meta.json.dossierId, null, "un lead Meta n'a rien fait sur le site : il se qualifie au téléphone");
    const message = await envoyer({ prenom: "Sacha", nom: "Essai", telephone: "0611180008", ville: "Lattes", source: "SITE_CONTACT", typeProjet: "AUTRE", message: "Une question" });
    assert.equal(message.json.dossierId, null);
    // Un lead d'avant la règle, avec une simulation d'avant la règle, réécrit un simple message : il reste un lead.
    const avant = new Date(depuisLead.DEBUT_OUVERTURE_AUTO.getTime() - 20 * 86_400_000);
    const ancien = await prisma.lead.create({ data: { prenom: "Tess", nom: "Essai", telephone: "0611180009", ville: "Lattes", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", createdAt: avant } });
    await prisma.simulation.create({ data: { leadId: ancien.id, createdAt: avant, imageAfterPath: `${ancien.id}/s/after.png` } });
    const retour = await envoyer({ prenom: "Tess", nom: "Essai", telephone: "0611180009", ville: "Lattes", source: "SITE_CONTACT", typeProjet: "AUTRE", message: "Toujours intéressée" });
    assert.deepEqual([retour.json.deduped, retour.json.leadId, retour.json.dossierId], [true, ancien.id, null]);
    await depuisLead.rattraperSimulationsSansDossier();
    const ids = [String(meta.json.leadId), String(message.json.leadId), ancien.id];
    assert.equal(await prisma.dossier.count({ where: { leadId: { in: ids } } }), 0);
  });
});
