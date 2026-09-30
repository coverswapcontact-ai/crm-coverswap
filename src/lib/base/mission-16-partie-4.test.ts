import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m16-4-"));

/**
 * Mission 16 (partie 4) — le tunnel du site, côté CRM : la route publique GET /api/site/tarifs (forme, `null` sans
 * tarif, trois formats de cuisine, rien d'interne), le webhook qui date le rappel demandé (heure de Paris, week-end →
 * lundi) et met l'agenda en file, qui ouvre l'espace après un rendu du simulateur et renvoie son lien (idempotent), qui
 * reconnaît `SITE_PRO` et range estimation, format, canal et page d'entrée sur le lead ; l'entonnoir en sept étapes.
 * `fetch` est remplacé pendant tout le fichier : une requête réseau fait échouer le test. Aucun SMS, aucun mail ne
 * part (canaux vidés par `preparerBaseEssai`). Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let quand: typeof import("@/lib/commercial/quand");
let tarifs: typeof import("@/lib/site/tarifs-publics");
let routeTarifs: typeof import("@/app/api/site/tarifs/route");
let webhook: typeof import("@/app/api/webhook/route");
let tunnel: typeof import("@/lib/site/tunnel");
let evenements: typeof import("@/lib/site/evenements");
let routeEvenements: typeof import("@/app/api/site/evenements/route");
let routesPubliques: typeof import("@/lib/acces/routes-publiques");
let constantes: typeof import("@/lib/prospects/constantes");

const fetchOrigine = globalThis.fetch;
const requetesReseau: string[] = [];
const SECRET = "secret-webhook-des-essais";
let ipSuivante = 10;

async function jpegDataUrl(couleur: { r: number; g: number; b: number }): Promise<string> {
  const { default: sharp } = await import("sharp");
  const octets = await sharp({ create: { width: 64, height: 48, channels: 3, background: couleur } }).jpeg({ quality: 70 }).toBuffer();
  return `data:image/jpeg;base64,${octets.toString("base64")}`;
}

/** POST /api/webhook comme le site l'envoie (secret, IP du visiteur : une IP par appel, la limite par IP ne gêne pas). */
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

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.ESPACE_CLIENT_SECRET = "secret-espace-des-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.WEBHOOK_SECRET = SECRET;
  process.env.WEBHOOK_SECRET_PRECEDENT = "";
  process.env.EMAIL_FROM = "";
  process.env.TACHES_DESACTIVEES = "1";
  globalThis.fetch = (async (entree: string | URL | Request) => {
    requetesReseau.push(String(entree instanceof Request ? entree.url : entree));
    throw new Error("Aucune requête réseau dans les essais");
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  quand = await import("@/lib/commercial/quand");
  tarifs = await import("@/lib/site/tarifs-publics");
  routeTarifs = await import("@/app/api/site/tarifs/route");
  webhook = await import("@/app/api/webhook/route");
  tunnel = await import("@/lib/site/tunnel");
  evenements = await import("@/lib/site/evenements");
  routeEvenements = await import("@/app/api/site/evenements/route");
  routesPubliques = await import("@/lib/acces/routes-publiques");
  constantes = await import("@/lib/prospects/constantes");
});

after(async () => {
  globalThis.fetch = fetchOrigine;
  await prisma.$disconnect();
});

describe("GET /api/site/tarifs", () => {
  test("forme : quatre familles, sous-parties avec prix ou null, trois formats de cuisine, rien d'interne ; cache et CORS", async () => {
    const reponse = await routeTarifs.GET(new NextRequest("http://localhost/api/site/tarifs", { headers: { "x-forwarded-for": "203.0.113.60" } }));
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=3600");
    assert.equal(reponse.headers.get("Access-Control-Allow-Origin"), "*");
    const texte = await reponse.text();
    for (const interdit of ["designation", "presetId", "explicite", "mots", "Revêtement adhésif"]) assert.ok(!texte.includes(interdit), `rien d'interne : ${interdit}`);
    const corps = JSON.parse(texte) as import("@/lib/site/tarifs-publics").TarifsPublics;
    assert.equal(corps.version, 1);
    assert.deepEqual(corps.familles.map((f) => f.id), ["CUISINE", "SDB", "MEUBLES", "PRO"]);
    const cuisine = corps.familles[0];
    assert.deepEqual(cuisine.formats.map((f) => [f.id, f.libelle, f.metres]), [["une-rangee", "Petite", 3], ["en-l", "Moyenne", 5], ["ilot", "Grande", 8]]);
    assert.equal(cuisine.formats[1].aide, "En L, ≈ 5 m");
    // Tarifs de départ (amorcés) : « cuisine / façades » à 110 €/ml chiffre les façades ; la crédence n'a aucun tarif.
    const facades = cuisine.sousParties.find((s) => s.id === "facades-hautes")!;
    assert.deepEqual([facades.metrage, facades.prixUnitaire, facades.unite], [true, 110, "ml"]);
    const credence = cuisine.sousParties.find((s) => s.id === "credence")!;
    assert.deepEqual([credence.metrage, credence.prixUnitaire], [false, null]);
    // Salle de bain : ses deux repères ; mobilier (taille en portes) et pro (sans repère) : aucun format.
    assert.deepEqual(corps.familles[1].formats.map((f) => f.metres), [0.8, 1.4]);
    assert.deepEqual([corps.familles[2].formats.length, corps.familles[3].formats.length], [0, 0]);
  });

  test("un tarif attribué par Lucas est lu ; sans tarif : null partout, la forme reste (repli du site)", async () => {
    const { attribuerTarif } = await import("@/lib/prestations/tarifs");
    const preset = await prisma.presetTarif.create({ data: { designation: "Film vasque (interne)", unite: "ml", prixUnitaire: 92.5, ordre: 99 } });
    await attribuerTarif("SDB.meuble-vasque", preset.id);
    const lu = (await tarifs.tarifsPublics()).familles.find((f) => f.id === "SDB")!.sousParties.find((s) => s.id === "meuble-vasque")!;
    assert.deepEqual([lu.prixUnitaire, lu.unite, lu.metrage], [92.5, "ml", true]);
    const sansPrix = tarifs.tarifsPublicsSansPrix();
    assert.ok(sansPrix.familles.every((f) => f.sousParties.every((s) => s.prixUnitaire === null)));
    assert.equal(sansPrix.familles[0].formats.length, 3);
    // Un prix nul, négatif ou illisible n'est pas un prix.
    const lignes = [0, -5, Number.NaN].map((prixUnitaire) => ({ famille: "CUISINE" as const, sousPartie: "facades-hautes", prixUnitaire, unite: "ml" }));
    for (const ligne of lignes) assert.equal(tarifs.versTarifsPublics([ligne]).familles[0].sousParties[0].prixUnitaire, null);
  });

  test("route publique exacte, déclarée avec sa protection", () => {
    assert.ok(routesPubliques.estRoutePublique("/api/site/tarifs"));
    assert.equal(routesPubliques.estRoutePublique("/api/site/tarifs/autre"), false);
    assert.ok(routesPubliques.ROUTES_PUBLIQUES.find((r) => r.chemin === "/api/site/tarifs")!.protection.includes("aucune désignation interne"));
  });
});

describe("rappelDuCreneau : heure de Paris, week-end → lundi", () => {
  const iso = (d: Date) => d.toISOString();
  test("mercredi : ce soir avant 17:30, demain au-delà ; demain 10 h et 18 h ; l'hiver aussi", () => {
    const mercredi10h = new Date("2026-09-30T08:00:00Z"); // 10:00 à Paris (été, UTC+2)
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", mercredi10h)), "2026-09-30T16:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("demain-10h", mercredi10h)), "2026-10-01T08:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("demain-18h", mercredi10h)), "2026-10-01T16:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", new Date("2026-09-30T15:29:00Z"))), "2026-09-30T16:00:00.000Z", "17:29 : ce soir");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", new Date("2026-09-30T15:30:00Z"))), "2026-10-01T16:00:00.000Z", "17:30 : demain 18 h");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", new Date("2026-11-04T09:00:00Z"))), "2026-11-04T17:00:00.000Z", "hiver (UTC+1)");
  });

  test("vendredi, samedi, dimanche : ce qui tombe un samedi ou un dimanche passe au lundi, même heure", () => {
    const vendredi12h = new Date("2026-10-02T10:00:00Z");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", vendredi12h)), "2026-10-02T16:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("demain-10h", vendredi12h)), "2026-10-05T08:00:00.000Z", "samedi → lundi 10 h");
    assert.equal(iso(quand.rappelDuCreneau("demain-18h", vendredi12h)), "2026-10-05T16:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", new Date("2026-10-02T17:00:00Z"))), "2026-10-05T16:00:00.000Z", "vendredi 19 h : lundi 18 h");
    const samedi = new Date("2026-10-03T09:00:00Z");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", samedi)), "2026-10-05T16:00:00.000Z");
    assert.equal(iso(quand.rappelDuCreneau("demain-10h", samedi)), "2026-10-05T08:00:00.000Z");
    const dimanche = new Date("2026-10-04T09:00:00Z");
    assert.equal(iso(quand.rappelDuCreneau("demain-10h", dimanche)), "2026-10-05T08:00:00.000Z", "dimanche : demain = lundi");
    assert.equal(iso(quand.rappelDuCreneau("ce-soir-18h", dimanche)), "2026-10-05T16:00:00.000Z");
  });
});

describe("POST /api/webhook — le tunnel du site", () => {
  test("rappel demandé sans simulation : rappelLe juste, le lead est « À rappeler », agenda et notification en file ; aucun espace", async () => {
    const attendu = quand.rappelDuCreneau("demain-10h", new Date());
    const { status, json } = await envoyer({ prenom: "Aline", nom: "Aline", telephone: "0611000001", ville: "Lattes", source: "SITE_SIMULATEUR", typeProjet: "CUISINE", rappelCreneau: "demain-10h", afficherLienEspace: true });
    assert.equal(status, 200);
    assert.equal(json.lienEspace, null, "rien à montrer dans un espace : pas d'espace");
    assert.equal(json.rappelLe, attendu.toISOString());
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: String(json.leadId) } });
    assert.equal(lead.rappelLe?.toISOString(), attendu.toISOString());
    const { lireRappel, cleAgendaRappel, cleNotificationRappel } = await import("@/lib/agenda/rappels");
    assert.equal((await lireRappel({ type: "LEAD", id: lead.id }))?.rappelLe?.toISOString(), attendu.toISOString(), "rappel actif : liste « À rappeler »");
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: cleAgendaRappel({ type: "LEAD", id: lead.id }) } })).type, "AGENDA_RAPPEL");
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: cleNotificationRappel({ type: "LEAD", id: lead.id }, attendu) } })).type, "RAPPEL_NOTIFICATION");
    const note = await prisma.interaction.findFirstOrThrow({ where: { leadId: lead.id } });
    assert.match(note.contenu, /Rappel demandé : (demain|lundi) à 10:00/);
    assert.equal(await prisma.sms.count(), 0, "aucun SMS");
  });

  test("SITE_SIMULATEUR avec simulation : espace ouvert, lien renvoyé, rappel sur le dossier ; second envoi du même parcours = même lien", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const parcoursId = "aaaaaaaa-1604-4000-8000-000000000001";
    const simulation = await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [{ zone: "meubles-bas", libelle: "Meubles bas", ref: "K1", nom: "Black Mat" }], imageAvantBase64: await jpegDataUrl({ r: 200, g: 190, b: 180 }), imageApresBase64: await jpegDataUrl({ r: 20, g: 20, b: 20 }) });
    const rappel = quand.rappelDuCreneau("demain-18h", new Date());
    const corps = {
      prenom: "Basile", nom: "Basile", telephone: "0611000002", ville: "Pérols", codePostal: "34470", source: "SITE_SIMULATEUR", typeProjet: "CUISINE",
      parcoursId, simulationIds: [simulation.id], rappelCreneau: "demain-18h", afficherLienEspace: true,
      estimationMin: 1000, estimationMax: 1200, formatPiece: "Moyenne · En L, ≈ 5 m", canal: "meta/paid", pageEntree: "/prestations/cuisine",
    };
    const premier = await envoyer(corps);
    assert.equal(premier.status, 200);
    assert.match(String(premier.json.lienEspace), /^https:\/\/coverswap\.fr\/e\/[A-Za-z0-9]+-[A-Za-z0-9_-]+$/);
    const dossierId = String(premier.json.dossierId);
    const espace = await prisma.espaceClient.findFirstOrThrow({ where: { dossierId } });
    assert.ok(espace.permanentId, "projet de l'espace permanent du client");
    assert.equal(await prisma.simulationEspace.count({ where: { espaceId: espace.id } }), 1, "le rendu est dans l'espace");
    // Le rappel vit sur le dossier, à l'heure exacte (le lead sort des listes Leads) ; son agenda est en file.
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.deepEqual([dossier.prochaineAction, dossier.prochaineActionInstant?.toISOString()], ["Rappeler", rappel.toISOString()]);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: String(premier.json.leadId) } });
    assert.equal(lead.rappelLe, null);
    assert.ok(await prisma.tache.findUnique({ where: { cle: `agenda-rappel:DOSSIER:${dossierId}` } }));
    // Estimation, format, canal et page d'entrée rangés sur le lead ; la note le dit.
    assert.deepEqual([lead.estimationMin, lead.estimationMax, lead.formatPiece, lead.canal, lead.pageEntree], [1000, 1200, "Moyenne · En L, ≈ 5 m", "meta/paid", "/prestations/cuisine"]);
    const note = await prisma.interaction.findFirstOrThrow({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    assert.match(note.contenu, /Estimation vue sur le site : 1 000 à 1 200 € \(taille : Moyenne · En L, ≈ 5 m\)/);
    assert.match(note.contenu, /Arrivé par meta\/paid, sur \/prestations\/cuisine/);

    const second = await envoyer({ ...corps, rappelCreneau: undefined, estimationMin: 1500, estimationMax: 1900 });
    assert.equal(second.status, 200);
    assert.equal(second.json.deduped, true);
    assert.equal(second.json.lienEspace, premier.json.lienEspace, "même lien");
    assert.equal(second.json.dossierId, dossierId);
    assert.equal(await prisma.espaceClient.count({ where: { dossier: { leadId: lead.id } } }), 1, "un seul projet");
    const apres = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.deepEqual([apres.estimationMin, apres.estimationMax], [1500, 1900], "la dernière estimation vue compte");
    assert.equal(await prisma.sms.count(), 0, "aucun SMS");
    assert.deepEqual(requetesReseau, [], "aucune requête réseau");
    // La demande est écrite au dossier (lien affiché à ce parcours) et la main revient à Lucas : il rappelle.
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: tunnel.EVENEMENT_DEMANDE_SITE }, orderBy: { createdAt: "asc" } });
    assert.deepEqual([evenement.direction, JSON.parse(evenement.metadata)], ["ENTRANT", { parcoursId, lienAffiche: true }]);
    const apresDossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.deepEqual([apresDossier.main, apresDossier.mainMotif], ["MOI", "Demande du site : le rappeler"]);

    // Un autre navigateur avec le même téléphone (quelqu'un qui connaît son numéro) : la demande est prise, le lien n'est PAS affiché.
    const autreParcours = "aaaaaaaa-1604-4000-8000-00000000000f";
    const { enregistrerSimulationSite: enregistrer } = await import("@/lib/site/simulations");
    const autre = await enregistrer({ parcoursId: autreParcours, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 1, g: 2, b: 3 }), imageApresBase64: await jpegDataUrl({ r: 4, g: 5, b: 6 }) });
    const intrus = await envoyer({ ...corps, prenom: "Quelqu'un", parcoursId: autreParcours, simulationIds: [autre.id], rappelCreneau: undefined });
    assert.equal(intrus.status, 200);
    assert.equal(intrus.json.deduped, true);
    assert.equal(intrus.json.lienEspace, null, "jamais le lien d'un contact déjà connu");
    const refusee = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: tunnel.EVENEMENT_DEMANDE_SITE, metadata: { contains: autreParcours } } });
    assert.equal(JSON.parse(refusee.metadata).lienAffiche, false);
    assert.match(refusee.contenu, /PAS été affiché/);
  });

  test("un contact neuf voit son lien ; un client déjà connu (fiche archivée, même téléphone) ne le voit pas", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const simuler = async (parcoursId: string) => (await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 9, g: 9, b: 9 }), imageApresBase64: await jpegDataUrl({ r: 8, g: 8, b: 8 }) })).id;
    const p1 = "dddddddd-1604-4000-8000-000000000001";
    const premier = await envoyer({ prenom: "Hélène", nom: "Hélène", telephone: "0611000010", ville: "Sète", source: "SITE_SIMULATEUR", parcoursId: p1, simulationIds: [await simuler(p1)], afficherLienEspace: true });
    assert.ok(premier.json.lienEspace);
    await prisma.lead.update({ where: { id: String(premier.json.leadId) }, data: { archiveLe: new Date() } });
    // Nouvelle fiche (l'ancienne est archivée), rattachée au même client par le téléphone : ce n'est pas un contact neuf.
    const p2 = "dddddddd-1604-4000-8000-000000000002";
    const second = await envoyer({ prenom: "Hélène", nom: "Hélène", telephone: "0611000010", ville: "Sète", source: "SITE_SIMULATEUR", parcoursId: p2, simulationIds: [await simuler(p2)], afficherLienEspace: true });
    assert.equal(second.status, 200);
    assert.notEqual(second.json.leadId, premier.json.leadId);
    assert.equal(second.json.lienEspace, null);
  });

  test("au-delà de deux projets en cours, c'est Lucas qui ouvre : pas de lien, le lead est bien créé", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const liens = await import("@/lib/espace/liens");
    const simuler = async (parcoursId: string) => (await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 90, g: 90, b: 90 }), imageApresBase64: await jpegDataUrl({ r: 30, g: 60, b: 90 }) })).id;
    const telephone = "0611000009";
    const p1 = "cccccccc-1604-4000-8000-000000000001";
    const premier = await envoyer({ prenom: "Gaëlle", nom: "Gaëlle", telephone, ville: "Mauguio", source: "SITE_SIMULATEUR", parcoursId: p1, simulationIds: [await simuler(p1)], afficherLienEspace: true });
    assert.ok(premier.json.lienEspace, "premier projet : ouvert");
    const d1 = await prisma.dossier.findUniqueOrThrow({ where: { id: String(premier.json.dossierId) } });
    // Un deuxième projet ouvert par Lucas dans le même espace, puis un troisième dossier vivant, sans espace, plus récent.
    const autre = (objet: string) => prisma.dossier.create({ data: { clientId: d1.clientId, clientNom: "Gaëlle Essai", clientAdresse: "", clientCp: "34130", clientVille: "Mauguio", clientTelephone: telephone, objet, source: "ENTRANT" } });
    await liens.ouvrirEspace((await autre("Dressing")).id);
    const d3 = await autre("Salle de bain");
    // L'ancienne fiche archivée : la nouvelle demande crée un lead, rattaché au même client par son téléphone.
    await prisma.lead.update({ where: { id: String(premier.json.leadId) }, data: { archiveLe: new Date() } });
    const p2 = "cccccccc-1604-4000-8000-000000000002";
    const second = await envoyer({ prenom: "Gaëlle", nom: "Gaëlle", telephone, ville: "Mauguio", source: "SITE_SIMULATEUR", parcoursId: p2, simulationIds: [await simuler(p2)], afficherLienEspace: true });
    assert.equal(second.status, 200);
    assert.notEqual(second.json.leadId, premier.json.leadId);
    assert.equal(second.json.lienEspace, null, "Lucas ouvre le troisième projet");
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: d3.id } }), 0);
    assert.equal((await prisma.espacePermanent.findFirstOrThrow({ where: { clientId: d1.clientId! } })).projetsAccordes, 0, "aucun accord noté à la place de Lucas");
  });

  test("sans le drapeau du site (ancien site, demande après un échec de génération) : aucun espace ouvert, aucun « lien affiché »", async () => {
    const { enregistrerSimulationSite } = await import("@/lib/site/simulations");
    const parcoursId = "eeeeeeee-1604-4000-8000-000000000001";
    const simulation = await enregistrerSimulationSite({ parcoursId, projet: "cuisine", references: [], imageAvantBase64: await jpegDataUrl({ r: 50, g: 60, b: 70 }), imageApresBase64: await jpegDataUrl({ r: 70, g: 60, b: 50 }) });
    // L'ancien site : un rendu rattaché, pas de drapeau.
    const ancien = await envoyer({ prenom: "Julien", nom: "Julien", telephone: "0611000021", ville: "Agde", source: "SITE_SIMULATEUR", parcoursId, simulationIds: [simulation.id] });
    assert.equal(ancien.status, 200);
    assert.equal(ancien.json.lienEspace, null);
    // La demande après un échec : la photo seule, pas de drapeau (le site ne montrerait pas le lien).
    const echec = await envoyer({ prenom: "Katia", nom: "Katia", telephone: "0611000022", email: "katia@example.test", ville: "Agde", source: "SITE_SIMULATEUR", photos: [await jpegDataUrl({ r: 10, g: 200, b: 10 })], notes: "SIMULATION À RÉALISER À LA MAIN" });
    assert.equal(echec.status, 200);
    assert.equal(echec.json.lienEspace, null);
    for (const leadId of [String(ancien.json.leadId), String(echec.json.leadId)]) {
      assert.equal(await prisma.espaceClient.count({ where: { dossier: { leadId } } }), 0, "aucun espace ouvert par le site");
      assert.equal(await prisma.dossierEvenement.count({ where: { type: tunnel.EVENEMENT_DEMANDE_SITE, dossier: { leadId } } }), 0, "aucun « lien affiché » écrit");
    }
  });

  test("le lien affiché : l'événement du dossier rappelle que le téléphone n'est pas vérifié", async () => {
    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { type: tunnel.EVENEMENT_DEMANDE_SITE, metadata: { contains: '"lienAffiche":true' } } });
    assert.ok(evenement.contenu.includes(tunnel.AVERTISSEMENT_TELEPHONE_NON_VERIFIE));
  });

  test("SITE_PRO : score de source 40 (contre 35 pour le contact), libellé, surface rangée ; demande de devis", async () => {
    const debut = new Date(Date.now() - 1000);
    const commun = { nom: "Martin", telephone: "", ville: "Sète", typeProjet: "PRO", email: "" };
    const pro = await envoyer({ ...commun, prenom: "Chloé", telephone: "0611000003", email: "chloe.pro@example.test", source: "SITE_PRO", surfaceM2: 40, message: "Hôtel, 12 chambres" });
    const contact = await envoyer({ ...commun, prenom: "Denis", telephone: "0611000004", email: "denis.contact@example.test", source: "SITE_CONTACT" });
    const [lp, lc] = await Promise.all([prisma.lead.findUniqueOrThrow({ where: { id: String(pro.json.leadId) } }), prisma.lead.findUniqueOrThrow({ where: { id: String(contact.json.leadId) } })]);
    assert.equal(lp.scoreSignature - lc.scoreSignature, 5);
    assert.equal(lp.source, "SITE_PRO");
    assert.match(lp.notes ?? "", /Surface approximative : 40 m²/);
    assert.equal(constantes.libelleSourceLead("SITE_PRO"), "Site : devis pro");
    assert.ok((constantes.SOURCES_LEAD as readonly string[]).includes("SITE_PRO"));
    const enMetres = await envoyer({ ...commun, prenom: "Emma", telephone: "0611000005", source: "SITE_PRO", surfaceMl: 12.5 });
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: String(enMetres.json.leadId) } })).mlEstimes, 12.5);
    assert.equal(pro.json.lienEspace, null, "pas d'espace ouvert pour un pro");
    // Une demande de devis partout : classée Prioritaire, intention « Devis », comptée au point du jour (le site n'émet plus SITE_DEVIS).
    const classe = await prisma.lead.findUniqueOrThrow({ where: { id: lp.id }, select: { priorite: true, prioriteMotif: true, statut: true } });
    assert.equal(classe.priorite, "PRIORITAIRE");
    assert.match(classe.prioriteMotif ?? "", /a demandé un devis de lui-même/);
    assert.equal(constantes.intentionDuLead({ ...lp, simulations: [] }), "DEVIS");
    assert.ok(constantes.estDemandeDeDevis(lp));
    // Un message de /contact sans projet (« Autre ») n'est pas une demande de devis.
    const message = await envoyer({ ...commun, prenom: "Gilles", telephone: "0611000007", source: "SITE_CONTACT", typeProjet: "AUTRE", message: "Une question" });
    const lm = await prisma.lead.findUniqueOrThrow({ where: { id: String(message.json.leadId) } });
    assert.equal(constantes.intentionDuLead({ ...lm, simulations: [] }), "CONTACT");
    assert.equal(lm.priorite, "STANDARD");
    const { calculerPointDuJour } = await import("@/lib/assistant/outils/point-du-jour");
    const point = await calculerPointDuJour(new Date(), { depuis: debut, memoriser: false });
    // Chloé et Emma (/pro), Denis (/contact avec un projet) ; pas Gilles (« Autre »).
    assert.equal(point.nouveautes.demandesDevis, 3);
  });

  test("un contact déjà connu qui écrit par /contact : Lucas est prévenu (push) ; avec un projet, la demande relève son statut", async () => {
    const commun = { prenom: "Inès", nom: "Garnier", telephone: "0611000023", email: "ines.contact@example.test", ville: "Lattes", source: "SITE_CONTACT" };
    const premier = await envoyer({ ...commun, typeProjet: "AUTRE", message: "Je ne retrouve pas le lien de mon espace" });
    assert.equal(premier.status, 200);
    const leadId = String(premier.json.leadId);
    // Le même contact réécrit (« Autre ») : pas une demande de devis, mais un message à ne pas rater.
    const second = await envoyer({ ...commun, typeProjet: "AUTRE", message: "Je vous relance" });
    assert.deepEqual([second.json.deduped, second.json.leadId], [true, leadId]);
    assert.ok((second.json.notifications as unknown[]).length > 0, "le push part pour un contact déjà connu");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).statut, "NOUVEAU");
    // Puis il demande un devis pour sa cuisine : statut relevé, classé Prioritaire, intention « Devis ».
    const troisieme = await envoyer({ ...commun, typeProjet: "CUISINE", message: "Un devis pour ma cuisine" });
    assert.ok((troisieme.json.notifications as unknown[]).length > 0);
    const apres = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    assert.deepEqual([apres.statut, apres.priorite], ["DEVIS_DEMANDE", "PRIORITAIRE"]);
    assert.equal(constantes.intentionDuLead({ ...apres, simulations: [] }), "DEVIS");
  });

  test("prénom seul (le simulateur le recopie en nom) : deux homonymes de la même ville ne sont pas des doublons", async () => {
    const { nomNormalise } = await import("@/lib/prospects/doublons");
    assert.equal(nomNormalise("Marie", "Marie"), "marie");
    assert.equal(nomNormalise("Jean", "Dupont Dupont"), "dupont jean");
    const a = await envoyer({ prenom: "Marie", nom: "Marie", telephone: "0611000024", ville: "Frontignan", codePostal: "34110", source: "SITE_SIMULATEUR" });
    const b = await envoyer({ prenom: "Marie", nom: "Marie", telephone: "0611000025", ville: "Frontignan", codePostal: "34110", source: "SITE_SIMULATEUR" });
    assert.notEqual(a.json.leadId, b.json.leadId);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: String(b.json.leadId) } })).doublonDe, null);
  });

  test("valeurs illisibles : ignorées, jamais une raison de perdre le lead ; textes coupés", async () => {
    const { status, json } = await envoyer({ prenom: "Farid", nom: "Farid", telephone: "0611000006", source: "SITE_SIMULATEUR", rappelCreneau: "dans-une-heure", estimationMin: 1900, estimationMax: 1500, canal: "x".repeat(90), formatPiece: 12 });
    assert.equal(status, 200);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: String(json.leadId) } });
    assert.deepEqual([lead.rappelLe, lead.estimationMin, lead.estimationMax, lead.formatPiece], [null, null, null, null]);
    assert.equal(lead.canal, "x".repeat(60));
  });

  test("complementsDeLaDemande et texteEstimation", () => {
    const maintenant = new Date("2026-09-30T08:00:00Z");
    assert.deepEqual(tunnel.complementsDeLaDemande({}, maintenant), []);
    assert.deepEqual(tunnel.complementsDeLaDemande({ estimationMin: 1500, estimationMax: 1900, rappelLe: new Date("2026-10-01T08:00:00Z"), pageEntree: "/" }, maintenant), [
      "Estimation vue sur le site : 1 500 à 1 900 €",
      "Rappel demandé : demain à 10:00",
      "Arrivé en direct, sur /",
    ]);
    assert.equal(tunnel.texteEstimation(1900, 1500), null);
    assert.equal(tunnel.texteEstimation(12000, 12000), "12 000 €");
  });
});

describe("événements : ESTIMATION_VUE, RAPPEL_DEMANDE, entonnoir en sept étapes", () => {
  test("acceptés par la liste blanche et la route ; l'entonnoir compte la visite, l'estimation, et le rappel comme un contact", async () => {
    for (const type of ["ESTIMATION_VUE", "RAPPEL_DEMANDE"]) {
      assert.ok(evenements.estTypeEvenementSite(type), type);
      const reponse = await routeEvenements.POST(
        new NextRequest("http://localhost/api/site/evenements", {
          method: "POST",
          body: JSON.stringify({ parcoursId: "bbbbbbbb-1604-4000-8000-000000000001", type, page: "/simulateur", meta: { format: "en-l", min: 1500, max: 1900 } }),
          headers: { "content-type": "text/plain", origin: "https://coverswap.fr", "x-forwarded-for": "203.0.113.61" },
        })
      );
      assert.equal(reponse.status, 200, type);
    }
    assert.deepEqual(evenements.ETAPES_ENTONNOIR.map((e) => e.cle), ["visite", "piece", "photo", "generation", "resultat", "estimation", "contact"]);
    const e = (parcoursId: string, type: string) => ({ parcoursId, type });
    const etapes = ["PAGE_VUE", "PIECE_CHOISIE", "PHOTO_CHARGEE", "GENERATION_LANCEE", "RESULTAT_VU", "ESTIMATION_VUE"];
    const entonnoir = evenements.calculerEntonnoir([
      ...etapes.map((t) => e("a", t)), e("a", "RAPPEL_DEMANDE"),
      ...etapes.map((t) => e("b", t)), e("b", "DEVIS_DEMANDE"),
      ...etapes.slice(0, 5).map((t) => e("c", t)), e("c", "DEVIS_DEMANDE"),
      e("d", "PAGE_VUE"),
    ]);
    assert.deepEqual(entonnoir.etapes.map((x) => [x.cle, x.parcours, x.abandons]), [
      ["visite", 4, null],
      ["piece", 3, 1],
      ["photo", 3, 0],
      ["generation", 3, 0],
      ["resultat", 3, 0],
      // L'estimation est facultative : sans abandons ; « c » (demande sans taille choisie) compte au contact.
      ["estimation", 2, null],
      ["contact", 3, 0],
    ]);
    assert.equal(entonnoir.etapes.find((x) => x.cle === "estimation")?.facultative, true);
    const jour = new Date().toISOString().slice(0, 10);
    const synthese = await evenements.syntheseSite(jour, jour);
    assert.equal(synthese.parType.find((t) => t.cle === "RAPPEL_DEMANDE")?.libelle, "Rappels demandés");
  });
});
