import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p8-"));

/**
 * Mission 14 (29/09/2026), partie 8 — le MCP suit : « leads_a_rappeler » (la
 * liste « À rappeler », même ordre que l'écran), « noter_appel » qui rend le SMS
 * proposé et renvoie à « noter_sms », « noter_sms » (mêmes effets que « Copier »),
 * « espaces_clients » filtré sur les espaces sans photo ni simulation, le
 * catalogue SMS dans « etat_crm » PARAMETRES / « modifier » MODELE_SMS (ex-« voir_parametres » / « modifier_parametres »), la main d'un
 * dossier perdu dans « dossiers_par_etape », les consignes. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let couverture: typeof import("@/lib/assistant/couverture");
let consignes: typeof import("@/lib/assistant/consignes");
let liens: typeof import("@/lib/espace/liens");
let suivi: typeof import("@/lib/espace/suivi");
let modeles: typeof import("@/lib/sms/modeles");
let relances: typeof import("@/lib/relances/service");
let session: import("@/lib/assistant/execution").Session;

/** Lundi 28 septembre 2026, 10 h à Paris (heure d'été). */
const LUNDI = new Date("2026-09-28T08:00:00.000Z");
const JOUR = 86_400_000;
const dans = (jours: number, depuis = LUNDI) => new Date(depuis.getTime() + jours * JOUR);
const LIEN = /https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+/;

let numero = 0;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Huit", telephone: `+3361408${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", ...donnees } });
const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const signaux = async (dossierId: string, maintenant = LUNDI) => ((await suivi.listerEspaces(maintenant)).find((l) => l.dossierId === dossierId)?.signaux ?? []).map((s) => s.code);
const jetonDe = (t: string) => /confirmation = « ([A-Za-z0-9_-]+) »/.exec(t)?.[1] ?? null;

/** Un outil du catalogue, exécuté par le moteur (validation, aperçu, journal), à l'instant donné. */
async function appeler(nom: string, entree: Record<string, unknown>, maintenant = LUNDI) {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session, maintenant);
}

/** Un lead, son dossier et son espace, ouvert il y a `jours` jours (vu de LUNDI), jamais ouvert par le client. */
async function contact(prenom: string, jours: number) {
  const l = await lead(prenom);
  const ouvert = await liens.ouvrirEspaceDuContact(l.id);
  await prisma.espaceClient.update({ where: { id: ouvert.espace.id }, data: { createdAt: dans(-jours) } });
  return { leadId: l.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}

let rangDevis = 800;
/** Un dossier en « Devis envoyé » sans e-mail et son devis, remis au client il y a `jours` jours (vu de LUNDI). */
async function dossierAvecDevis(nom: string, jours: number) {
  const client = await prisma.client.create({ data: { nom, prenom: nom.split(" ")[0], source: "ENTRANT", premierContactLe: LUNDI } });
  const dossier = await prisma.dossier.create({
    data: { clientNom: nom, clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: `06000008${String(++numero).padStart(2, "0")}`, objet: "Recouvrement de salle de bains", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: client.id },
  });
  const quand = dans(-jours);
  const devis = await prisma.document.create({
    data: { dossierId: dossier.id, clientId: client.id, type: "DEVIS", numero: `2026-${++rangDevis}`, dateEmission: quand, createdAt: quand, objet: "Meuble vasque", lignes: "[]", totalHt: 630, acomptePct: 30, statut: "ENVOYE" },
  });
  return { dossierId: dossier.id, devisId: devis.id, numero: devis.numero! };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  process.env.TACHES_DESACTIVEES = "1";
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  couverture = await import("@/lib/assistant/couverture");
  consignes = await import("@/lib/assistant/consignes");
  liens = await import("@/lib/espace/liens");
  suivi = await import("@/lib/espace/suivi");
  modeles = await import("@/lib/sms/modeles");
  relances = await import("@/lib/relances/service");
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  await prisma.$disconnect();
});

describe("le catalogue expose les deux nouveaux outils", () => {
  test("53 outils (mission 17, partie C : les outils génériques remplacent 45 outils d'un seul geste) : « lister » (ex-« leads_a_rappeler ») en lecture, « noter_sms » en écriture réversible ; le serveur MCP les expose tous", async () => {
    const registre = couverture.registreOutils();
    assert.equal(registre.nombre, 53);
    const rappeler = registre.outils.find((o) => o.nom === "lister");
    const noterSms = registre.outils.find((o) => o.nom === "noter_sms");
    assert.deepEqual([rappeler?.niveau, rappeler?.famille, rappeler?.parametres], ["LECTURE", "LECTURE", ["filtres", "liste", "page", "par_page", "recherche", "vue"]]);
    assert.deepEqual([noterSms?.niveau, noterSms?.famille, noterSms?.parametres], ["REVERSIBLE", "ECRITURE", ["clientId", "code", "dossierId", "leadId", "nom", "texte"]]);

    // Un vrai client MCP, en mémoire : « tools/list » vaut le catalogue, rien de plus, rien de moins.
    const { construireServeur } = await import("@/lib/mcp/serveur");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const [versClient, versServeur] = InMemoryTransport.createLinkedPair();
    const { mcp } = construireServeur(session);
    await mcp.connect(versServeur);
    const client = new Client({ name: "essai", version: "1.0" });
    await client.connect(versClient);
    const outils = await client.listTools();
    assert.deepEqual(couverture.ecartAvecLeServeur(outils.tools.map((t) => t.name)), { manquants: [], enTrop: [] });
    assert.equal(outils.tools.length, 53);
    const niveau = (nom: string) => outils.tools.find((t) => t.name === nom)?.description?.match(/^\[([^\]]+)\]/)?.[1];
    assert.deepEqual([niveau("lister"), niveau("noter_sms")], ["Lecture", "Écriture réversible"]);
    const ressource = await client.readResource({ uri: "coverswap://consignes" });
    assert.match((ressource.contents[0] as { text: string }).text, /^## Appels, rappels, SMS \(mission 14\)/m);
    await client.close();
    await mcp.close();
  });

  test("les consignes par défaut disent : le SMS proposé après l'appel, « noter_sms » quand il est envoyé, « lister » LEADS A_RAPPELER, aucun SMS ne part seul", async () => {
    const { texte } = await consignes.lireConsignes();
    assert.match(texte, /« Qui dois-je rappeler \? » → « lister » LEADS vue A_RAPPELER/);
    assert.match(texte, /Quand Lucas dit avoir envoyé un SMS .*« noter_sms »/);
    assert.match(texte, /Aucun SMS ne part tout seul/);
    assert.match(texte, /« lien_espace » rend le lien et le SMS prêt à copier .*quand Lucas dit l'avoir envoyé : « noter_sms »/);
    // Un texte de Lucas qui n'a pas la section la reçoit quand même, à la lecture.
    const texteDeLucas = "# Consignes pour Claude\n\nTutoie Lucas.\n";
    await consignes.enregistrerConsignes(texteDeLucas, "essai", "essai partie 8");
    const lu = (await consignes.lireConsignes()).texte;
    assert.ok(lu.startsWith(texteDeLucas.trim()), lu.slice(0, 80));
    assert.match(lu, /^## Appels, rappels, SMS \(mission 14\)/m);
    assert.equal(lu.includes(consignes.CONSIGNES_DEFAUT.trim()), false, "le texte de Lucas remplace bien le défaut");
    await consignes.enregistrerConsignes(consignes.CONSIGNES_DEFAUT, "essai", "retour au défaut");
    assert.equal(consignes.CONSIGNES_DEFAUT.includes("## Appels, rappels, SMS"), false, "la section est jointe à la lecture, pas dans le texte de départ");
  });
});

describe("lister LEADS A_RAPPELER (ex-« leads_a_rappeler ») : la liste « À rappeler », même ordre que l'écran", () => {
  let hier: { id: string };
  let tantot: { id: string };
  let jeudi: { id: string };
  let ancien: { id: string };
  let recent: { id: string };
  let jamais: { id: string };

  before(async () => {
    // Rappel dimanche 27 sept. 18 h (Paris) : en retard ; dernier appel vendredi 25 sept. 11 h, sans réponse.
    hier = await lead("Hier", { rappelLe: new Date("2026-09-27T16:00:00.000Z"), dernierAppelLe: new Date("2026-09-25T09:00:00.000Z"), tentatives: 1 });
    await prisma.interaction.create({ data: { leadId: hier.id, type: "APPEL", contenu: "Appel — Pas de réponse", createdAt: new Date("2026-09-25T09:00:00.000Z") } });
    // Rappel aujourd'hui 16 h (Paris).
    tantot = await lead("Tantot", { rappelLe: new Date("2026-09-28T14:00:00.000Z"), dernierAppelLe: new Date("2026-09-24T09:00:00.000Z") });
    // Rappel jeudi 1er octobre 10 h.
    jeudi = await lead("Jeudi", { rappelLe: new Date("2026-10-01T08:00:00.000Z"), dernierAppelLe: new Date("2026-09-26T09:00:00.000Z") });
    // Sans date : le plus ancien appel d'abord.
    ancien = await lead("Ancien", { dernierAppelLe: new Date("2026-09-20T10:00:00.000Z"), statut: "CONTACTE" });
    await prisma.interaction.create({ data: { leadId: ancien.id, type: "APPEL", contenu: "Appel — À rappeler : veut réfléchir", createdAt: new Date("2026-09-20T10:00:00.000Z") } });
    recent = await lead("Recent", { dernierAppelLe: new Date("2026-09-26T10:00:00.000Z"), tentatives: 2 });
    jamais = await lead("Jamais");
  });

  test("en-tête, ordre (datés croissants, retards en tête, puis sans date), rappel « jeu. 1 oct. 10:00 », EN RETARD, sans date, dernier appel et son issue", async () => {
    const r = await appeler("lister", { liste: "LEADS", vue: "A_RAPPELER" });
    const donnees = r.donnees as { lignes: { id: string }[]; compteurs: { aRappeler: number; enRetard: number; aujourdhui: number } };
    assert.deepEqual(donnees.lignes.map((l) => l.id), [hier.id, tantot.id, jeudi.id, ancien.id, recent.id]);
    assert.deepEqual([donnees.compteurs.aRappeler, donnees.compteurs.enRetard, donnees.compteurs.aujourdhui], [5, 1, 1]);
    assert.match(r.texte, /^5 leads à rappeler dont 1 en retard, 1 aujourd'hui\. Compteurs de l'écran : [^\n]*\n/);
    assert.match(r.texte, new RegExp(`- Hier Huit \\(Lattes\\) — Publicité Meta, 06 14 08 \\d\\d \\d\\d, 1 tentative, rappel dim\\. 27 sept\\. 18:00 EN RETARD, dernier appel ven\\. 25 sept\\. 11:00 \\(pas de réponse\\) \\[lead:${hier.id}\\]`));
    assert.match(r.texte, new RegExp(`- Tantot Huit \\(Lattes\\) — Publicité Meta, [0-9 ]+, 0 tentative, rappel lun\\. 28 sept\\. 16:00, dernier appel jeu\\. 24 sept\\. 11:00 \\[lead:${tantot.id}\\]`));
    assert.match(r.texte, new RegExp(`- Jeudi Huit \\(Lattes\\) — Publicité Meta, [0-9 ]+, 0 tentative, rappel jeu\\. 1 oct\\. 10:00, dernier appel`));
    assert.match(r.texte, new RegExp(`- Ancien Huit \\(Lattes\\) — Publicité Meta, [0-9 ]+, 0 tentative, rappel sans date, dernier appel dim\\. 20 sept\\. 12:00 \\(à rappeler\\) \\[lead:${ancien.id}\\]`));
    assert.match(r.texte, new RegExp(`- Recent Huit \\(Lattes\\) — Publicité Meta, [0-9 ]+, 2 tentatives, rappel sans date, dernier appel sam\\. 26 sept\\. 12:00 \\[lead:${recent.id}\\]`));
    assert.doesNotMatch(r.texte, /Jamais Huit/, "un lead jamais appelé est dans « À appeler »");
    assert.ok(!donnees.lignes.some((l) => l.id === jamais.id));
    assert.doesNotMatch(r.texte, /Hier Hier|EN RETARD.*Jeudi Huit.*EN RETARD/);
    assert.deepEqual(r.liens?.map((l) => l.href.endsWith("/leads?vue=A_RAPPELER")), [true]);
  });

  test("pages : « par_page » lignes par page, « page » ; la liste vide le dit", async () => {
    const page2 = await appeler("lister", { liste: "LEADS", vue: "A_RAPPELER", par_page: 2, page: 2 });
    assert.deepEqual((page2.donnees as { lignes: { id: string }[] }).lignes.map((l) => l.id), [jeudi.id, ancien.id]);
    assert.match(page2.texte, /^5 leads à rappeler dont 1 en retard, 1 aujourd'hui \(page 2 sur 3\)\. Compteurs[^\n]*\n- Jeudi Huit/);
    const page9 = await appeler("lister", { liste: "LEADS", vue: "A_RAPPELER", par_page: 2, page: 9 });
    assert.match(page9.texte, /Aucun lead sur cette page\.$/);
    const trop = await appeler("lister", { liste: "LEADS", vue: "A_RAPPELER", par_page: 200 });
    assert.match(trop.texte, /^Paramètres invalides/);
  });
});

describe("noter_appel rend le SMS proposé ; noter_sms note son envoi comme « Copier »", () => {
  test("pas de réponse : le SMS A avec le rappel de demain 18 h, puis « noter_sms » avec le code seul : le texte est recomposé, tracé sur le lead", async () => {
    const u = await lead("Ulysse");
    const appel = await appeler("noter_appel", { leadId: u.id, issue: "PAS_DE_REPONSE", commande: "Ulysse ne répond pas" });
    assert.match(appel.texte, /^Appel noté\. Rappel demain à 18:00\. \(Ulysse Huit\)\nSMS proposé \(PAS_DE_REPONSE\) : « Bonjour, c'est Lucas de CoverSwap\. J'ai essayé de vous joindre au sujet de votre projet de rénovation\. Je vous rappelle demain vers 18 h, ou dites-moi le moment qui vous arrange\. » — une fois envoyé, dis-le-moi \(« noter_sms »\)\.$/);
    assert.equal(await prisma.interaction.count({ where: { leadId: u.id, type: "SMS" } }), 0, "rien n'est tracé tant que Lucas n'a pas envoyé");

    const note = await appeler("noter_sms", { leadId: u.id, code: "PAS_DE_REPONSE", commande: "C'est envoyé" });
    assert.match(note.texte, /^Noté : SMS PAS_DE_REPONSE envoyé à Ulysse Huit \(écrit dans les échanges du lead\)\.\nTexte noté : « Bonjour, c'est Lucas de CoverSwap\. J'ai essayé de vous joindre au sujet de votre projet de rénovation\. Je vous rappelle demain vers 18 h, ou dites-moi le moment qui vous arrange\. »$/);
    const echange = await prisma.interaction.findFirstOrThrow({ where: { leadId: u.id, type: "SMS" } });
    assert.match(echange.contenu, /^SMS PAS_DE_REPONSE copié : « Bonjour, c'est Lucas de CoverSwap\. J'ai essayé/);
    assert.equal((await leadDe(u.id)).rappelLe?.toISOString(), "2026-09-29T16:00:00.000Z", "le rappel de l'appel n'a pas bougé");
    const journal = await prisma.appelOutil.findFirst({ where: { outil: "noter_sms", commande: "C'est envoyé" } });
    assert.deepEqual([journal?.statut, journal?.niveau], ["FAIT", "REVERSIBLE"]);
  });

  test("intéressé : le SMS du lien est dans la réponse ; « noter_sms » LIEN_ESPACE → lien communiqué, main au client, « Lien pas encore envoyé » tombe ; un double toucher ne trace qu'une fois", async () => {
    const v = await lead("Victor");
    const appel = await appeler("noter_appel", { leadId: v.id, issue: "INTERESSE" });
    assert.match(appel.texte, /^Appel noté\. Dossier et espace ouverts\. \(Victor Huit\)\nSMS proposé \(LIEN_ESPACE\) : « Bonjour Victor, c'est Lucas de CoverSwap\. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez\. https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+ » — une fois envoyé, dis-le-moi \(« noter_sms »\)\.$/);
    const { dossierId } = appel.donnees as { dossierId: string };
    assert.ok((await signaux(dossierId)).includes("NON_ENVOYE"), "rien d'envoyé encore");

    // Par le nom : la cible est son dossier (titre « nom — objet »), comme pour tout outil d'écriture.
    const note = await appeler("noter_sms", { nom: "Victor Huit", code: "LIEN_ESPACE", commande: "Je lui ai envoyé le lien" });
    assert.match(note.texte, /^Noté : SMS LIEN_ESPACE envoyé à Victor Huit — Recouvrement de cuisine \(écrit dans l'histoire du dossier, lien de l'espace communiqué : la main passe au client\)\.\nTexte noté : « Bonjour Victor, c'est Lucas de CoverSwap\. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez\. https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+ »$/);
    assert.ok(!(await signaux(dossierId)).includes("NON_ENVOYE"), "le lien est communiqué");
    const d = await dossierDe(dossierId);
    assert.deepEqual([d.main, d.mainMotif], ["CLIENT", "Lien de son espace envoyé : en attente du client"]);
    const traces = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "SMS_COPIE" } });
    assert.equal(traces.length, 1);
    assert.deepEqual([JSON.parse(traces[0].metadata).origine, JSON.parse(traces[0].metadata).code], ["ASSISTANT", "LIEN_ESPACE"]);

    const encore = await appeler("noter_sms", { leadId: v.id, code: "LIEN_ESPACE" }, new Date(LUNDI.getTime() + 5 * 60_000));
    assert.match(encore.texte, /^Noté : SMS LIEN_ESPACE envoyé à Victor Huit \(déjà noté il y a moins de 10 minutes : rien de plus n'est écrit\)\./);
    assert.doesNotMatch(encore.texte, /relance n°|relance photos|la main passe au client/, "rien n'a été écrit : aucun effet annoncé");
    assert.equal((encore.donnees as { deja: boolean; relance: unknown }).deja, true);
    assert.equal((encore.donnees as { relance: unknown }).relance, null);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "SMS_COPIE" } }), 1);
  });

  test("un rappel de dossier noté au jour seul se dit par son jour (« jeudi »), pas par une heure que Lucas n'a pas choisie ; un rappel à l'heure garde l'heure", async () => {
    const z = await lead("Zora");
    const dossier = await prisma.dossier.create({
      data: { clientNom: "Zora Huit", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: z.telephone!, objet: "Recouvrement de cuisine", source: "META_ADS", etape: "QUALIFICATION", leadId: z.id, prochaineAction: "Rappeler", prochaineActionDate: new Date("2026-10-01T12:00:00.000Z"), prochaineActionInstant: null },
    });
    const jourSeul = await appeler("noter_sms", { dossierId: dossier.id, code: "A_RAPPELER" });
    assert.match(jourSeul.texte, /\nTexte noté : « Merci pour votre réponse ! C'est noté, je vous rappelle jeudi\. À très vite, Lucas de CoverSwap\. »$/);
    assert.doesNotMatch(jourSeul.texte, /vers 1[34] h/);
    // Le même rappel choisi à l'heure (fin d'appel, agenda) : l'heure est dite.
    await prisma.dossier.update({ where: { id: dossier.id }, data: { prochaineActionDate: new Date("2026-10-01T08:00:00.000Z"), prochaineActionInstant: new Date("2026-10-01T08:00:00.000Z") } });
    const aLHeure = await appeler("noter_sms", { dossierId: dossier.id, code: "A_RAPPELER" }, new Date(LUNDI.getTime() + 60 * 60_000));
    assert.match(aLHeure.texte, /je vous rappelle jeudi vers 10 h\. À très vite/);
  });

  test("texte seul : noté en texte libre ; ni code ni texte : refusé par le schéma ; un code avec un texte modifié garde ce texte", async () => {
    const w = await lead("Wanda");
    const libre = await appeler("noter_sms", { leadId: w.id, texte: "Bonjour, je passe vous voir jeudi. Lucas" });
    assert.equal(libre.texte, "Noté : SMS envoyé à Wanda Huit (texte libre, écrit dans les échanges du lead).");
    assert.equal((await prisma.interaction.findFirstOrThrow({ where: { leadId: w.id, type: "SMS" } })).contenu, "SMS copié : « Bonjour, je passe vous voir jeudi. Lucas »");
    const rien = await appeler("noter_sms", { leadId: w.id });
    assert.match(rien.texte, /^Paramètres invalides pour « Noter un SMS envoyé par Lucas » : .*Donne le code du SMS \(catalogue\), le texte envoyé, ou les deux\./);
    const modifie = await appeler("noter_sms", { leadId: w.id, code: "A_RAPPELER", texte: "C'est noté, je vous rappelle lundi. Lucas" });
    assert.equal(modifie.texte, "Noté : SMS A_RAPPELER envoyé à Wanda Huit (écrit dans les échanges du lead).");
    assert.equal(await prisma.interaction.count({ where: { leadId: w.id, type: "SMS", contenu: "SMS A_RAPPELER copié : « C'est noté, je vous rappelle lundi. Lucas »" } }), 1);
  });

  test("relance de devis : RELANCE_DEVIS_1 retrouve seul le devis du dossier et son rang, compte la relance et passe le dossier en « Relance » ; puis la 2ᵉ ; puis refus ; refus sans dossier", async () => {
    const b = await dossierAvecDevis("Brunet Zoé", 6);
    const premiere = await appeler("noter_sms", { dossierId: b.dossierId, code: "RELANCE_DEVIS_1", commande: "Relance envoyée à Zoé" });
    assert.match(premiere.texte, new RegExp(`^Noté : SMS RELANCE_DEVIS_1 envoyé à Brunet Zoé \\(écrit dans l'histoire du dossier, relance n° 1 du devis ${b.numero} comptée \\(2 au plus, mail ou SMS\\)\\)\\.\nTexte noté : « Bonjour, c'est Lucas de CoverSwap\\. Avez-vous pu regarder votre devis \\? Il est toujours dans votre espace client\\. Je reste disponible si vous avez des questions\\. »$`));
    assert.deepEqual([(await dossierDe(b.dossierId)).etape, (await dossierDe(b.dossierId)).mainMotif], ["RELANCE", "Relance envoyée : en attente de sa réponse"]);
    const etat = (await relances.listerRelances(LUNDI, { dossierId: b.dossierId })).devis[0];
    assert.deepEqual([etat.relancesFaites, etat.rang, etat.proposable], [1, 2, false]);
    // Double toucher : rien d'écrit, et la réponse ne prétend pas avoir compté une 2ᵉ relance.
    const encore = await appeler("noter_sms", { dossierId: b.dossierId, code: "RELANCE_DEVIS_1" }, new Date(LUNDI.getTime() + 5 * 60_000));
    assert.match(encore.texte, /^Noté : SMS RELANCE_DEVIS_1 envoyé à Brunet Zoé \(déjà noté il y a moins de 10 minutes : rien de plus n'est écrit\)\./);
    assert.doesNotMatch(encore.texte, /relance n° \d/);
    assert.equal((encore.donnees as { relance: unknown }).relance, null);
    assert.equal((await relances.listerRelances(LUNDI, { dossierId: b.dossierId })).devis[0].relancesFaites, 1);

    const seconde = await appeler("noter_sms", { dossierId: b.dossierId, code: "RELANCE_DEVIS_2", texte: "Bonjour, dernier message pour votre devis. Lucas" }, dans(6));
    assert.match(seconde.texte, new RegExp(`relance n° 2 du devis ${b.numero} comptée`));
    assert.equal((await relances.listerRelances(dans(6), { dossierId: b.dossierId })).devis[0].relancesFaites, 2);
    const troisieme = await appeler("noter_sms", { dossierId: b.dossierId, code: "RELANCE_DEVIS_1", texte: "Encore moi" }, dans(12));
    assert.match(troisieme.texte, new RegExp(`^Refusé : Déjà 2 relances faites pour le devis ${b.numero} de Brunet Zoé \\(mail ou SMS\\) : plus de relance à compter\\.`));
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: b.dossierId, type: "SMS_COPIE" } }), 2, "rien d'écrit sur un refus");

    const w = await prisma.lead.findFirstOrThrow({ where: { prenom: "Wanda", nom: "Huit" } });
    const sansDossier = await appeler("noter_sms", { leadId: w.id, code: "RELANCE_DEVIS_1" });
    assert.match(sansDossier.texte, /^Refusé : Wanda Huit n'a pas de dossier : une relance de devis se note sur son dossier\./);
  });
});

describe("lister ESPACES filtré (ex-« espaces_clients ») : les espaces sans photo ni simulation depuis N jours, avec téléphone et SMS", () => {
  test("ouvert il y a 4 jours : présent pour N = 3 (LIEN_ESPACE, lien jamais envoyé), absent pour N = 5 ; après « noter_sms » du lien : LIEN_ESPACE_RAPPEL ; voir_relances suit ; sans filtre, la liste d'avant", async () => {
    const x = await contact("Xavier", 4);
    const trois = await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 3 } });
    assert.match(trois.texte, /^\d+ projets? d'espace sans photo ni simulation depuis 3 jours \(rien n'est envoyé : Lucas copie le SMS, puis « noter_sms »\) :\n/);
    assert.match(trois.texte, new RegExp(`- Xavier Huit : espace ouvert il y a 4 jours, ni photo ni simulation \\(lien jamais envoyé\\), \\+33614080\\d{3} — SMS \\(LIEN_ESPACE\\) : « Bonjour Xavier, c'est Lucas de CoverSwap\\. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez\\. https://coverswap\\.fr/e/[A-Za-z0-9_-]+ » \\[dossier:${x.dossierId}\\]`));
    const projets = trois.donnees as { dossierId: string; sms: { code: string; telephone: string; texte: string } | null }[];
    const xavier = projets.find((p) => p.dossierId === x.dossierId);
    assert.deepEqual([xavier?.sms?.code, xavier?.sms?.telephone], ["LIEN_ESPACE", (await leadDe(x.leadId)).telephone]);
    assert.match(xavier?.sms?.texte ?? "", LIEN);
    const cinq = await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 5 } });
    assert.doesNotMatch(cinq.texte, /Xavier Huit/);
    const relancesVues = await appeler("lister", { liste: "RELANCES" });
    assert.match(relancesVues.texte, /Xavier Huit : espace ouvert il y a 4 jours, ni photo ni simulation — relance photos n° 1 \(lien jamais envoyé\)\. SMS \(LIEN_ESPACE\)/);

    // Le lien communiqué (noter_sms) : plus « jamais envoyé », le SMS devient LIEN_ESPACE_RAPPEL, le délai repart de l'envoi ;
    // le SMS de lien sur un espace à relancer compte la relance photos n° 1, comme « Copier » depuis la feuille Relances.
    const note = await appeler("noter_sms", { dossierId: x.dossierId, code: "LIEN_ESPACE" });
    assert.match(note.texte, /\(écrit dans l'histoire du dossier, lien de l'espace communiqué : la main passe au client, relance photos n° 1 comptée \(2 au plus\)\)\./);
    assert.deepEqual((note.donnees as { relance: unknown }).relance, { type: "PHOTOS", rang: 1 });
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: x.dossierId, type: "SMS_COPIE" } });
    assert.deepEqual(JSON.parse(trace.metadata).relance, { type: "PHOTOS", rang: 1 });
    assert.doesNotMatch((await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 3 } })).texte, /Xavier Huit/, "le lien vient de partir");
    const plusTard = await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 3 } }, dans(10));
    assert.match(plusTard.texte, new RegExp(`- Xavier Huit : espace ouvert il y a 14 jours, ni photo ni simulation, \\+33614080\\d{3} — SMS \\(LIEN_ESPACE_RAPPEL\\) : « Bonjour Xavier, c'est Lucas de CoverSwap\\. Voici à nouveau le lien de votre espace, tout votre projet y est à jour : https://coverswap\\.fr/e/[A-Za-z0-9_-]+ » \\[dossier:${x.dossierId}\\]`));
    assert.match((await appeler("lister", { liste: "RELANCES" }, dans(10))).texte, /Xavier Huit : espace ouvert il y a 14 jours, ni photo ni simulation — relance photos n° 2\. SMS \(LIEN_ESPACE_RAPPEL\)/);

    // La 2ᵉ, avec un texte modifié sans le lien : comptée quand même (le code dit la relance) ; ensuite plus rien à proposer.
    const seconde = await appeler("noter_sms", { dossierId: x.dossierId, code: "LIEN_ESPACE_RAPPEL", texte: "Bonjour Xavier, pensez à déposer 2 ou 3 photos dans votre espace quand vous pouvez. Lucas, CoverSwap" }, dans(10));
    assert.equal(seconde.texte, "Noté : SMS LIEN_ESPACE_RAPPEL envoyé à Xavier Huit (écrit dans l'histoire du dossier, relance photos n° 2 comptée (2 au plus)).");
    const photos = await import("@/lib/relances/photos");
    assert.deepEqual(await photos.relancesPhotosProposables(dans(20), { dossierId: x.dossierId }), [], "deux relances photos au plus");
    assert.doesNotMatch((await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 3 } }, dans(20))).texte, /Xavier Huit/);
    assert.doesNotMatch((await appeler("lister", { liste: "RELANCES" }, dans(20))).texte, /Xavier Huit/);
    // Un lien envoyé hors relance (plus rien à proposer) ne compte pas de relance photos.
    const horsRelance = await appeler("noter_sms", { dossierId: x.dossierId, code: "LIEN_ESPACE_RAPPEL" }, dans(20));
    assert.doesNotMatch(horsRelance.texte, /relance photos/);
    assert.equal((horsRelance.donnees as { relance: unknown }).relance, null);

    const tout = await appeler("lister", { liste: "ESPACES" });
    assert.match(tout.texte, /Xavier Huit \(Lattes\) : jamais ouvert ; 1 projet en cours[^;]*; attend le client/);
    const vide = await appeler("lister", { liste: "ESPACES", filtres: { sans_photo_ni_simulation_depuis_jours: 60 } });
    assert.match(vide.texte, /^Aucun projet d'espace sans photo ni simulation depuis 60 jours\.$/);
  });
});

describe("etat_crm PARAMETRES / modifier MODELE_SMS (ex-« voir_parametres » / « modifier_parametres ») : le catalogue SMS", () => {
  test("« groupe: SMS » rend le seul catalogue, par groupe, CODE — libellé : « texte » ; sans groupe, le bloc vient après les groupes et avant la numérotation ; un autre groupe ne l'a pas", async () => {
    const sms = await appeler("etat_crm", { partie: "PARAMETRES", groupe: "SMS" });
    assert.match(sms.texte, /^Catalogue SMS \(Paramètres → SMS ; un texte se change par « modifier » MODELE_SMS \(code, texte\)/);
    assert.match(sms.texte, /\nAutomatiques :\n- ACCUSE_RECEPTION — Accusé de réception \(automatique, en journée\) : « Bonjour \{prenom\}, Lucas de CoverSwap\./);
    assert.match(sms.texte, /\nAprès un appel :\n- PAS_DE_REPONSE_SIMULATION — A — Pas de réponse \(simulation du site\) : « Bonjour, c'est Lucas de CoverSwap\. J'ai essayé de vous joindre au sujet de votre simulation\. Je vous rappelle \{quand\}, ou dites-moi le moment qui vous arrange\. »\n- PAS_DE_REPONSE — /);
    assert.match(sms.texte, /\nEspace client :\n- LIEN_ESPACE — Lien de l'espace \(premier envoi\) : « Bonjour \{prenom\}, c'est Lucas de CoverSwap\. Comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez\. \{lien\} »/);
    assert.match(sms.texte, /\nRelances :\n- RELANCE_DEVIS_1 — Relance du devis \(1re\) : « Bonjour, c'est Lucas de CoverSwap\. Avez-vous pu regarder votre devis \?/);
    assert.doesNotMatch(sms.texte, /TRESORERIE_RESERVE|Numérotation|Automatismes \(|Solde OpenAI/);
    assert.equal((sms.donnees as { sms: unknown[] }).sms.length, 14);

    const tout = await appeler("etat_crm", { partie: "PARAMETRES" });
    const [groupes, bloc, numerotation, automatismes] = [tout.texte.indexOf("Pilotage de l'activité :\n- TRESORERIE_RESERVE"), tout.texte.indexOf("Catalogue SMS ("), tout.texte.indexOf("Numérotation (Paramètres → Numérotation des documents)"), tout.texte.indexOf("Automatismes (")];
    assert.ok(groupes >= 0 && bloc > groupes && numerotation > bloc && automatismes > numerotation, `ordre des blocs : ${[groupes, bloc, numerotation, automatismes].join(", ")}`);
    assert.match(tout.texte, /Aucun secret n'est lu ni rendu/);
    const commercial = await appeler("etat_crm", { partie: "PARAMETRES", groupe: "COMMERCIAL" });
    assert.doesNotMatch(commercial.texte, /Catalogue SMS/);
    assert.match(commercial.texte, /DELAI_RELANCE_PHOTOS/);
  });

  test("modifier MODELE_SMS (ex-« modifier_parametres » sms_code + sms_texte) : aperçu « ancien » → « nouveau » puis confirmation ; le texte vaut pour les prochains SMS ; un lien au milieu est refusé dès l'aperçu ; sans champ, refusé", async () => {
    const avant = (await modeles.texteDuCatalogue("A_RAPPELER", { quand: "{quand}" }));
    const entree = { entite: "MODELE_SMS", id: "A_RAPPELER", champs: { texte: "Merci ! Je vous rappelle {quand}. Lucas, CoverSwap." }, commande: "Change le SMS à rappeler" };
    const apercu = await appeler("modifier", entree);
    assert.match(apercu.texte, /^Je vais modifier le SMS A_RAPPELER \([^)]*\) : le texte passe de « Merci pour votre réponse ! C'est noté, je vous rappelle \{quand\}\. À très vite, Lucas de CoverSwap\. » à « Merci ! Je vous rappelle \{quand\}\. Lucas, CoverSwap\. »\.\nIl vaudra pour les prochains SMS ; ceux déjà copiés ne changent pas\.\n\nRien n'a été fait\./);
    const jeton = jetonDe(apercu.texte);
    assert.ok(jeton, apercu.texte);
    assert.equal(await modeles.texteDuCatalogue("A_RAPPELER", { quand: "{quand}" }), avant, "l'aperçu n'écrit rien");
    const fait = await appeler("modifier", { ...entree, confirmation: jeton });
    assert.match(fait.texte, /^Modifié sur le SMS A_RAPPELER \([^)]*\) : le texte passe de « Merci pour votre réponse ! C'est noté, je vous rappelle \{quand\}\. À très vite, Lucas de CoverSwap\. » à « Merci ! Je vous rappelle \{quand\}\. Lucas, CoverSwap\. »\.\nPour défaire : « annuler_modification »/);
    assert.equal(await modeles.texteDuCatalogue("A_RAPPELER", { quand: "demain vers 10 h" }), "Merci ! Je vous rappelle demain vers 10 h. Lucas, CoverSwap.");
    assert.match((await appeler("etat_crm", { partie: "PARAMETRES", groupe: "SMS" })).texte, /- A_RAPPELER — B — À rappeler : « Merci ! Je vous rappelle \{quand\}\. Lucas, CoverSwap\. »/);
    // Le SMS proposé par la fin d'appel suit.
    const y = await lead("Yann");
    const appel = await appeler("noter_appel", { leadId: y.id, issue: "A_RAPPELER", rappel: "jeudi 10h" });
    assert.match(appel.texte, /SMS proposé \(A_RAPPELER\) : « Merci ! Je vous rappelle jeudi vers 10 h\. Lucas, CoverSwap\. » — une fois envoyé/);

    const milieu = await appeler("modifier", { entite: "MODELE_SMS", id: "LIEN_ESPACE", champs: { texte: "Bonjour {prenom}, votre espace : {lien} À bientôt." } });
    assert.equal(milieu.texte, "Refusé : Texte SMS LIEN_ESPACE refusé : Le lien doit rester à la fin du message.");
    assert.equal(jetonDe(milieu.texte), null, "aucun jeton : rien à confirmer");
    assert.match(await modeles.texteDuCatalogue("LIEN_ESPACE", { prenom: "X", lien: "L" }), /^Bonjour X, c'est Lucas de CoverSwap\. Comme convenu/);
    const inconnue = await appeler("modifier", { entite: "MODELE_SMS", id: "PAS_DE_REPONSE", champs: { texte: "Bonjour {prénom}, je vous rappelle {quand}." } });
    assert.match(inconnue.texte, /^Refusé : Texte SMS PAS_DE_REPONSE refusé : Variable non permise : \{prénom\}\./);

    // Sans champ, ou avec un champ inconnu : refusé, sans jeton.
    for (const champs of [{}, { sms_texte: "x" }]) {
      const refus = await appeler("modifier", { entite: "MODELE_SMS", id: "A_RAPPELER", champs });
      assert.match(refus.texte, /^Refusé : (Aucun champ à modifier|Champ)/, JSON.stringify(champs));
      assert.equal(jetonDe(refus.texte), null);
    }
    // Un paramètre daté passe aussi par « modifier » (PARAMETRE), sous confirmation.
    const reserve = await appeler("modifier", { entite: "PARAMETRE", id: "TRESORERIE_RESERVE", champs: { valeur: 3000 } });
    assert.ok(jetonDe(reserve.texte) || /Rien à changer/.test(reserve.texte), reserve.texte);
  });

  test("sans ligne en base pour ce code (repli) : l'aperçu n'écrit rien et montre le texte de départ ; la confirmation pose la ligne puis la réécrit", async () => {
    // La ligne du code mise hors du catalogue (rien ne se supprime : le code est renommé pour l'essai).
    await prisma.modeleSms.update({ where: { code: "INJOIGNABLE_LIEN" }, data: { code: "INJOIGNABLE_LIEN_ESSAI" } });
    const avant = await prisma.modeleSms.count();
    const nouveau = "Bonjour {prenom}, Lucas de CoverSwap. Je n'arrive pas à vous joindre : votre espace est prêt, tout se passe ici : {lien}";
    const entree = { entite: "MODELE_SMS", id: "INJOIGNABLE_LIEN", champs: { texte: nouveau } };
    const apercu = await appeler("modifier", entree);
    assert.match(apercu.texte, /^Je vais modifier le SMS INJOIGNABLE_LIEN \([^)]*\) : le texte passe de « Bonjour \{prenom\}, /);
    assert.equal(await prisma.modeleSms.count(), avant, "l'aperçu ne pose rien");
    const jeton = jetonDe(apercu.texte);
    assert.ok(jeton, apercu.texte);
    const fait = await appeler("modifier", { ...entree, confirmation: jeton });
    assert.match(fait.texte, /^Modifié sur le SMS INJOIGNABLE_LIEN \([^)]*\) : le texte passe de .* à « Bonjour \{prenom\}, Lucas de CoverSwap\. Je n'arrive pas/);
    assert.equal(await prisma.modeleSms.count(), avant + 1, "la ligne est posée à l'exécution");
    assert.equal(await modeles.texteDuCatalogue("INJOIGNABLE_LIEN", { prenom: "X", lien: "L" }), "Bonjour X, Lucas de CoverSwap. Je n'arrive pas à vous joindre : votre espace est prêt, tout se passe ici : L");
  });
});

describe("lister DOSSIERS (ex-« dossiers_par_etape ») et lire_fiche : la main, par la règle unique", () => {
  test("un dossier perdu (main nulle) n'est ni « à toi » ni « chez le client » : « (personne) » ; qualification « à toi » ; un retard chez le client « à toi : à relancer » — les mêmes mots dans « lire_fiche »", async () => {
    const perdu = await prisma.dossier.create({ data: { clientNom: "Perdu Huit", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33614089998", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "PERDU", motifPerte: "PRIX", perteLe: LUNDI } });
    const qualification = await prisma.dossier.create({ data: { clientNom: "Qualif Huit", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33614089997", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
    // Devis envoyé, main au client, prochaine action dépassée de 3 jours : c'est à Lucas de relancer (pilotage.ts › A_RELANCER).
    const aRelancer = await prisma.dossier.create({ data: { clientNom: "Retard Huit", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33614089996", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", main: "CLIENT", mainMotif: "Devis envoyé : en attente de sa réponse", prochaineAction: "Relancer le devis", prochaineActionDate: dans(-3) } });
    const enAttente = await prisma.dossier.create({ data: { clientNom: "Attente Huit", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33614089995", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", main: "CLIENT", prochaineAction: "Relancer le devis", prochaineActionDate: dans(3) } });
    const r = await appeler("lister", { liste: "DOSSIERS", vue: "PAR_ETAPE" });
    assert.match(r.texte, new RegExp(`Perdu Huit — Recouvrement de cuisine \\(personne\\) \\[dossier:${perdu.id}\\]`));
    assert.doesNotMatch(r.texte, /Perdu Huit — Recouvrement de cuisine \(à toi\)/);
    assert.match(r.texte, new RegExp(`Qualif Huit — Recouvrement de cuisine \\(à toi\\) \\[dossier:${qualification.id}\\]`));
    assert.match(r.texte, new RegExp(`Retard Huit — Recouvrement de cuisine \\(à toi : à relancer\\) → Relancer le devis \\[dossier:${aRelancer.id}\\]`));
    assert.match(r.texte, new RegExp(`Attente Huit — Recouvrement de cuisine \\(chez le client\\) → Relancer le devis \\[dossier:${enAttente.id}\\]`));
    const seuls = await appeler("lister", { liste: "DOSSIERS", vue: "PAR_ETAPE", filtres: { etape: "PERDU" } });
    assert.match(seuls.texte, /^Perdu \(\d+\) : /);
    assert.doesNotMatch(seuls.texte, /\(à toi\)/);

    assert.match((await appeler("lire_fiche", { dossierId: perdu.id })).texte, /^Dossier Perdu Huit — Recouvrement de cuisine \(Lattes\) : étape « Perdu », la main est à personne\./);
    assert.match((await appeler("lire_fiche", { dossierId: qualification.id })).texte, /étape « Qualification », la main est à toi\./);
    assert.match((await appeler("lire_fiche", { dossierId: aRelancer.id })).texte, /étape « Devis envoyé », la main est à toi : à relancer \(Devis envoyé : en attente de sa réponse\)\./);
    assert.match((await appeler("lire_fiche", { dossierId: enAttente.id })).texte, /étape « Devis envoyé », la main est chez le client\./);
  });
});
