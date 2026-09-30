import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-gestes-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie C) — les gestes de l'interface rejoués par l'assistant : « traiter_mail », « geste_espace »,
 * « doublon », « anonymiser_client », « publier », « agir_systeme », et la sensibilité de « valider_proposition ». Pour
 * chaque geste : le même état en base que le geste de l'écran (la ROUTE de l'écran est appelée sur un jumeau), et un
 * aperçu avec jeton, puis la confirmation, sur chaque action sensible. Base d'essai, noms fictifs, aucun réseau.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;
type Handler = (requete: import("next/server").NextRequest, contexte: { params: Promise<Record<string, string>> }) => Promise<Response>;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let gestes: typeof import("@/lib/assistant/outils/gestes");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let NextRequest: typeof import("next/server").NextRequest;
let sharp: typeof import("sharp");
let session: import("@/lib/assistant/execution").Session;
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

const executer = (outil: unknown, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(outil as DefinitionOutil, entree, session, new Date());

/** Aperçu, jeton, puis second appel avec le jeton : le geste sensible, de bout en bout. */
async function confirmer(outil: unknown, entree: Record<string, unknown>, apercu?: RegExp): Promise<{ apercu: ResultatOutil; fait: ResultatOutil }> {
  const premier = await executer(outil, entree);
  assert.ok(premier.confirmation?.jeton, `aperçu attendu : ${premier.texte}`);
  assert.match(premier.texte, /Rien n'a été fait/);
  if (apercu) assert.match(premier.texte, apercu);
  const fait = await executer(outil, { ...entree, confirmation: premier.confirmation!.jeton });
  assert.ok(!fait.confirmation, fait.texte);
  return { apercu: premier, fait };
}

/** Le geste de l'écran : la route elle-même, au nom de Lucas. */
async function route(chemin: string, methode: "POST" | "PATCH" | "DELETE", url: string, corps: unknown, params: Record<string, string> = {}): Promise<unknown> {
  const handlers = (await import(chemin)) as Record<string, Handler>;
  const requete = new NextRequest(new Request(`http://localhost:3001${url}`, { method: methode, body: corps === undefined ? undefined : JSON.stringify(corps), headers: { "content-type": "application/json" } }));
  const reponse = await avecActeur(LUCAS, () => handlers[methode](requete, { params: Promise.resolve(params) }));
  const lu = await reponse.json().catch(() => null);
  assert.ok(reponse.status < 300, `${methode} ${url} : ${reponse.status} ${JSON.stringify(lu)}`);
  return lu;
}

let rang = 0;
async function mail(donnees: Record<string, unknown> = {}) {
  rang++;
  const m = await prisma.message.create({ data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: `gestes-${rang}`, filCanal: `fil-gestes-${rang}`, sens: "ENTRANT", de: `expediteur${rang}@exemple.test`, deNom: `Expéditeur ${rang}`, objet: `Objet ${rang}`, extrait: "Bonjour", recuLe: new Date(Date.now() - rang * 60_000), classe: "HUMAIN", classePar: "TRI", lu: false, dansBoite: true, ...donnees } });
  await prisma.contenuMessage.create({ data: { messageId: m.id, texte: `Bonjour, message ${rang}.` } });
  return m.id;
}
async function etatMail(id: string) {
  const m = await prisma.message.findUniqueOrThrow({ where: { id } });
  return { lu: m.lu, dansBoite: m.dansBoite, range: Boolean(m.rangeLe), rangeMotif: m.rangeMotif, traite: Boolean(m.traiteLe), remonte: Boolean(m.remonteLe), classe: m.classe, classePar: m.classePar, snooze: m.snoozeJusqua?.toISOString() ?? null, statut: m.statut, clientId: m.clientId ? "client" : null };
}

async function image(couleur: { r: number; g: number; b: number }): Promise<File> {
  const octets = await sharp({ create: { width: 800, height: 600, channels: 3, background: couleur } }).jpeg().toBuffer();
  return new File([new Uint8Array(octets)], "rendu.jpg", { type: "image/jpeg" });
}

async function ouvrirEspace(prenom: string, nom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom, telephone: `06120000${String(++rang).padStart(2, "0")}`, email: `${prenom.toLowerCase()}@exemple.test`, ville: "Lattes", source: "SITE_DEVIS", typeProjet: "CUISINE" } });
  const { ouvrirEspaceDuContact } = await import("@/lib/espace/liens");
  const ouvert = await avecActeur(LUCAS, () => ouvrirEspaceDuContact(lead.id));
  return { leadId: lead.id, dossierId: ouvert.dossierId, permanentId: ouvert.permanent.id, espaceId: ouvert.espace.id };
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  execution = await import("@/lib/assistant/execution");
  gestes = await import("@/lib/assistant/outils/gestes");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  NextRequest = (await import("next/server")).NextRequest;
  sharp = (await import("sharp")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("« traiter_mail » : chaque geste de la boîte, même état que l'écran", () => {
  test("LU, NON_LU, ARCHIVER, DESARCHIVER, RANGER, DERANGER, REMONTER, CLASSER, SNOOZER, ANNULER_SNOOZE : jumeau par jumeau", async () => {
    const ecran = await mail();
    const outil = await mail();
    const suite: { geste: string; action?: string; corps?: Record<string, unknown>; snooze?: boolean; entree?: Record<string, unknown> }[] = [
      { geste: "LU", action: "LU" },
      { geste: "NON_LU", action: "NON_LU" },
      { geste: "ARCHIVER", action: "ARCHIVER" },
      { geste: "DESARCHIVER", action: "DESARCHIVER" },
      { geste: "RANGER", action: "RANGER" },
      { geste: "DERANGER", action: "DERANGER" },
      { geste: "RANGER", action: "RANGER" },
      { geste: "REMONTER", action: "REMONTER" },
      { geste: "CLASSER", action: "CLASSER", corps: { classe: "ADMINISTRATIF" }, entree: { classe: "ADMINISTRATIF" } },
      { geste: "SNOOZER", snooze: true, corps: { quand: "demain 9h" }, entree: { quand: "demain 9h" } },
      { geste: "ANNULER_SNOOZE", snooze: true, corps: { annuler: true } },
    ];
    for (const pas of suite) {
      if (pas.snooze) await route("@/app/api/mail/[id]/snooze/route", "POST", `/api/mail/${ecran}/snooze`, pas.corps, { id: ecran });
      else await route("@/app/api/mail/[id]/action/route", "POST", `/api/mail/${ecran}/action`, { action: pas.action, ...pas.corps }, { id: ecran });
      const r = await executer(gestes.outilTraiterMail, { geste: pas.geste, messageIds: [outil], ...pas.entree });
      assert.ok(!r.confirmation && !/^Refusé|a échoué/.test(r.texte), `${pas.geste} : ${r.texte}`);
      assert.deepEqual(await etatMail(outil), await etatMail(ecran), pas.geste);
    }
  });

  test("NE_PLUS_MONTRER (définitif) : aperçu et jeton, puis le même état que l'écran", async () => {
    const ecran = await mail();
    const outil = await mail();
    await route("@/app/api/mail/[id]/action/route", "POST", `/api/mail/${ecran}/action`, { action: "NE_PLUS_MONTRER" }, { id: ecran });
    await confirmer(gestes.outilTraiterMail, { geste: "NE_PLUS_MONTRER", messageIds: [outil] }, /ne plus jamais montrer/);
    assert.deepEqual(await etatMail(outil), await etatMail(ecran));
    const regles = await prisma.regleExpediteur.findMany({ where: { cible: { in: [`expediteur${rang - 1}@exemple.test`, `expediteur${rang}@exemple.test`] } }, select: { action: true } });
    assert.equal(regles.length, 2, "une règle chacun");
  });

  test("RATTACHER à un client (même état que « Rattacher ») ; plus de trois mails : aperçu ; TOUT_NETTOYER : aperçu puis nettoyage", async () => {
    const client = await prisma.client.create({ data: { nom: "Rita Rattache", prenom: "Rita", nomFamille: "Rattache", source: "INCONNUE", premierContactLe: new Date() } });
    const ecran = await mail();
    const outil = await mail();
    await route("@/app/api/mail/[id]/rattacher/route", "POST", `/api/mail/${ecran}/rattacher`, { clientId: client.id }, { id: ecran });
    const r = await executer(gestes.outilTraiterMail, { geste: "RATTACHER", messageIds: [outil], clientId: client.id });
    assert.match(r.texte, /Fil rattaché à Rita Rattache/);
    assert.deepEqual(await etatMail(outil), await etatMail(ecran));
    const quatre = [await mail(), await mail(), await mail(), await mail()];
    const masse = await executer(gestes.outilTraiterMail, { geste: "LU", messageIds: quatre });
    assert.ok(masse.confirmation, "au-delà de trois mails : confirmation");
    const { fait } = await confirmer(gestes.outilTraiterMail, { geste: "TOUT_NETTOYER" }, /Tout nettoyer/);
    assert.match(fait.texte, /^Boîte nettoyée/);
  });
});

describe("« geste_espace » : les gestes du panneau Espace, même état que l'écran", () => {
  test("OUVRIR sans rien noter ni envoyer : même espace que « Lien espace client » de la fiche du lead", async () => {
    const c = await prisma.lead.create({ data: { prenom: "Oscar", nom: "Ouvre", telephone: "0612009901", ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE" } });
    const d = await prisma.lead.create({ data: { prenom: "Octave", nom: "Ouvre", telephone: "0612009902", ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE" } });
    await route("@/app/api/prospects/entrants/[id]/espace/route", "POST", `/api/prospects/entrants/${c.id}/espace`, undefined, { id: c.id });
    const r = await executer(gestes.outilGesteEspace, { geste: "OUVRIR", leadId: d.id });
    assert.match(r.texte, /Espace ouvert pour Octave Ouvre\. Rien n'a été envoyé ni noté\. Lien : http/);
    const evenements = async (leadId: string) => (await prisma.dossierEvenement.findMany({ where: { dossier: { leadId } }, select: { type: true } })).map((e) => e.type).sort();
    assert.deepEqual(await evenements(d.id), await evenements(c.id));
    assert.ok(!(await evenements(d.id)).some((t) => /SMS|MAIL/.test(t)), "rien d'envoyé");
  });

  test("ACCORDER_SIMULATIONS, ACCORDER_PROJET, NOUVEAU_LIEN sans mail, MARQUER_LUS : jumeau par jumeau", async () => {
    const e = await ouvrirEspace("Emma", "Ecran");
    const o = await ouvrirEspace("Olga", "Outil");
    await route("@/app/api/dossiers/[id]/espace/route", "POST", `/api/dossiers/${e.dossierId}/espace`, { geste: "accorder", nombre: 3 }, { id: e.dossierId });
    await executer(gestes.outilGesteEspace, { geste: "ACCORDER_SIMULATIONS", dossierId: o.dossierId, nombre: 3 });
    const espace = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
    assert.equal((await espace(o.espaceId)).simulationsAccordees, (await espace(e.espaceId)).simulationsAccordees);
    await route("@/app/api/espaces/[id]/route", "POST", `/api/espaces/${e.permanentId}`, { action: "accorder-projet", nombre: 1 }, { id: e.permanentId });
    await executer(gestes.outilGesteEspace, { geste: "ACCORDER_PROJET", dossierId: o.dossierId, nombre: 1 });
    const permanent = (id: string) => prisma.espacePermanent.findUniqueOrThrow({ where: { id } });
    assert.equal((await permanent(o.permanentId)).projetsAccordes, (await permanent(e.permanentId)).projetsAccordes);
    await route("@/app/api/espaces/[id]/route", "POST", `/api/espaces/${e.permanentId}`, { action: "regenerer", mail: false }, { id: e.permanentId });
    const lien = await executer(gestes.outilGesteEspace, { geste: "NOUVEAU_LIEN", dossierId: o.dossierId, mail: false });
    assert.ok(!lien.confirmation, "sans mail : pas de confirmation");
    assert.equal((await permanent(o.permanentId)).version, (await permanent(e.permanentId)).version);
    for (const x of [e, o]) await prisma.messageEspace.create({ data: { dossierId: x.dossierId, espaceId: x.espaceId, auteur: "CLIENT", source: "MESSAGE", texte: "Bonjour, une question." } });
    await route("@/app/api/dossiers/[id]/espace/route", "POST", `/api/dossiers/${e.dossierId}/espace`, { geste: "repondre", texte: "Bonjour, je vous rappelle." }, { id: e.dossierId }).catch(() => undefined);
    const lus = await executer(gestes.outilGesteEspace, { geste: "MARQUER_LUS", dossierId: o.dossierId });
    assert.match(lus.texte, /1 message de Olga Outil marqué lu/);
    assert.equal(await prisma.messageEspace.count({ where: { dossierId: o.dossierId, auteur: "CLIENT", luLe: null } }), 0);
  });

  test("sensibles : DESACTIVER, REINITIALISER, NOUVEAU_LIEN avec mail, ACCORDER_SIMULATIONS au-delà de 3 — aperçu, jeton, puis l'état de l'écran", async () => {
    const e = await ouvrirEspace("Elise", "Ecran");
    const o = await ouvrirEspace("Oriane", "Outil");
    await route("@/app/api/espaces/[id]/route", "POST", `/api/espaces/${e.permanentId}`, { action: "desactiver" }, { id: e.permanentId });
    await confirmer(gestes.outilGesteEspace, { geste: "DESACTIVER", dossierId: o.dossierId }, /désactiver le lien de l'espace de Oriane Outil/);
    const permanent = (id: string) => prisma.espacePermanent.findUniqueOrThrow({ where: { id } });
    assert.ok((await permanent(o.permanentId)).revoqueLe && (await permanent(e.permanentId)).revoqueLe);
    const types = async (dossierId: string) => (await prisma.dossierEvenement.findMany({ where: { dossierId }, select: { type: true } })).map((x) => x.type).sort();
    assert.deepEqual(await types(o.dossierId), await types(e.dossierId));
    await executer(gestes.outilGesteEspace, { geste: "REACTIVER", dossierId: o.dossierId });
    await route("@/app/api/espaces/[id]/route", "POST", `/api/espaces/${e.permanentId}`, { action: "regenerer", mail: false }, { id: e.permanentId });
    assert.equal((await permanent(o.permanentId)).revoqueLe, null);
    assert.equal((await permanent(o.permanentId)).version, (await permanent(e.permanentId)).version);
    await route("@/app/api/dossiers/[id]/espace/route", "POST", `/api/dossiers/${e.dossierId}/espace`, { geste: "reinitialiser", etape: "SIMULATIONS" }, { id: e.dossierId });
    await confirmer(gestes.outilGesteEspace, { geste: "REINITIALISER", dossierId: o.dossierId, etape: "SIMULATIONS" }, /réinitialiser l'étape « SIMULATIONS »/);
    assert.deepEqual(await types(o.dossierId), await types(e.dossierId));
    const avecMail = await executer(gestes.outilGesteEspace, { geste: "NOUVEAU_LIEN", dossierId: o.dossierId, texte: "Voici votre nouveau lien." });
    assert.ok(avecMail.confirmation, "un mail part : confirmation");
    assert.match(avecMail.texte, /le lui envoyer par mail avec la phrase : « Voici votre nouveau lien\. »/);
    const beaucoup = await executer(gestes.outilGesteEspace, { geste: "ACCORDER_SIMULATIONS", dossierId: o.dossierId, nombre: 5 });
    assert.ok(beaucoup.confirmation);
    assert.match(beaucoup.texte, /≈ 1,00 \$/);
  });
});

describe("« doublon » et « anonymiser_client »", () => {
  test("LEAD : ECARTER et FUSIONNER (sensible) donnent le même état que les boutons de la fiche", async () => {
    const paire = async (nom: string) => {
      const ancien = await prisma.lead.create({ data: { prenom: nom, nom: "Double", telephone: `0613${String(++rang).padStart(6, "0")}`, ville: "Sète", source: "META_ADS", typeProjet: "CUISINE", createdAt: new Date(Date.now() - 5 * 86_400_000) } });
      const nouveau = await prisma.lead.create({ data: { prenom: nom, nom: "Double", telephone: `0613${String(++rang).padStart(6, "0")}`, ville: "Sète", source: "META_ADS", typeProjet: "CUISINE", doublonDe: ancien.id, doublonMotif: "Même nom, même ville" } });
      return { ancien: ancien.id, nouveau: nouveau.id };
    };
    const lead = async (id: string) => {
      const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
      return { traite: Boolean(l.doublonTraiteLe), motif: l.doublonMotif, archive: Boolean(l.archiveLe), archiveMotif: l.archiveMotif?.replace(/\d{2}\/\d{2}\/\d{4}/, "…").replace(/^Doublon de \S+ \S+/, "Doublon de …") ?? null };
    };
    const a = await paire("Albert");
    const b = await paire("Bertrand");
    const liste = await executer(gestes.outilDoublon, { nature: "LEAD", action: "LISTER" });
    assert.ok(liste.texte.includes(`[lead:${a.nouveau}] → [lead:${a.ancien}]`), liste.texte);
    await route("@/app/api/leads/[id]/doublon/route", "POST", `/api/leads/${a.nouveau}/doublon`, { action: "ecarter" }, { id: a.nouveau });
    const ecarte = await executer(gestes.outilDoublon, { nature: "LEAD", action: "ECARTER", id: b.nouveau });
    assert.ok(!ecarte.confirmation);
    assert.deepEqual(await lead(b.nouveau), await lead(a.nouveau));
    const c = await paire("Camille");
    const d = await paire("Denise");
    await route("@/app/api/leads/[id]/doublon/route", "POST", `/api/leads/${c.nouveau}/doublon`, { action: "fusionner" }, { id: c.nouveau });
    await confirmer(gestes.outilDoublon, { nature: "LEAD", action: "FUSIONNER", id: d.nouveau }, /Denise Double \(06 ?13[^)]*\) sera fusionné dans Denise Double/);
    assert.deepEqual(await lead(d.nouveau), await lead(c.nouveau));
    assert.equal((await lead(d.nouveau)).archive, true);
  });

  test("CLIENT : CHERCHER (comme « Chercher les doublons »), LISTER, FUSIONNER (sensible, fiche conservée), ECARTER", async () => {
    const creer = (nom: string, email: string, jours: number) => prisma.client.create({ data: { nom, ville: "Nîmes", source: "INCONNUE", premierContactLe: new Date(Date.now() - jours * 86_400_000), emails: { create: { adresse: email } } } });
    const p1a = await creer("Paul Martin", "paul.martin@exemple.test", 30);
    const p1b = await creer("P. Martin", "paul.martin@exemple.test", 3);
    const p2a = await creer("Zoé Durand", "zoe.durand@exemple.test", 30);
    const p2b = await creer("Z. Durand", "zoe.durand@exemple.test", 3);
    const cherche = await executer(gestes.outilDoublon, { nature: "CLIENT", action: "CHERCHER" });
    assert.match(cherche.texte, /^2 nouvelles paires/);
    assert.deepEqual(await route("@/app/api/clients/doublons/route", "POST", "/api/clients/doublons", undefined), { nouvelles: 0 }, "même fonction : rien de plus à proposer");
    const liste = await executer(gestes.outilDoublon, { nature: "CLIENT", action: "LISTER" });
    const propositions = [...liste.texte.matchAll(/\[proposition:([a-z0-9]+)\]/g)].map((m) => m[1]);
    assert.equal(propositions.length, 2);
    const deLaPaire = async (id: string) => JSON.parse((await prisma.proposition.findUniqueOrThrow({ where: { id } })).contenu) as { clientAId: string; clientBId: string };
    const pourPaul = (await Promise.all(propositions.map(async (id) => ({ id, c: await deLaPaire(id) })))).find((x) => [x.c.clientAId, x.c.clientBId].includes(p1a.id))!;
    const pourZoe = (await Promise.all(propositions.map(async (id) => ({ id, c: await deLaPaire(id) })))).find((x) => [x.c.clientAId, x.c.clientBId].includes(p2a.id))!;
    const lettre = (c: { clientAId: string }, garde: string) => (c.clientAId === garde ? "A" : "B");
    await route("@/app/api/validation/[id]/valider/route", "POST", `/api/validation/${pourPaul.id}/valider`, { corrections: { conserver: lettre(pourPaul.c, p1a.id) } }, { id: pourPaul.id });
    await confirmer(gestes.outilDoublon, { nature: "CLIENT", action: "FUSIONNER", id: pourZoe.id, conserver: lettre(pourZoe.c, p2a.id) }, /Fiche conservée : [AB]\. L'autre est archivée/);
    const fiche = async (id: string) => {
      const c = await prisma.client.findUniqueOrThrow({ where: { id } });
      return { fusionne: Boolean(c.fusionneDansId), archive: Boolean(c.archiveLe) };
    };
    assert.deepEqual(await fiche(p2b.id), await fiche(p1b.id));
    assert.deepEqual(await fiche(p2a.id), await fiche(p1a.id));
    assert.equal((await fiche(p2b.id)).fusionne, true);
    const p3a = await creer("Jean Dupont", "jean.dupont@exemple.test", 30);
    await creer("Jeanne Dupont", "jean.dupont@exemple.test", 2);
    await executer(gestes.outilDoublon, { nature: "CLIENT", action: "CHERCHER" });
    const troisieme = (await prisma.proposition.findMany({ where: { type: "FUSION_CLIENTS", statut: "EN_ATTENTE" } })).find((p) => p.contenu.includes(p3a.id))!;
    const ecarte = await executer(gestes.outilDoublon, { nature: "CLIENT", action: "ECARTER", id: troisieme.id, motif: "MEME_FOYER" });
    assert.ok(!ecarte.confirmation);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: troisieme.id } })).statut, "REJETEE");
  });

  test("« anonymiser_client » : toujours un aperçu (effacé, gardé, bloquants) ; confirmé, le même état que l'écran", async () => {
    const creer = (nom: string) => prisma.client.create({ data: { nom, ville: "Agde", source: "INCONNUE", premierContactLe: new Date(), emails: { create: { adresse: `${nom.split(" ")[0].toLowerCase()}@exemple.test` } } } });
    const ecran = await creer("Bob Nyme");
    const outil = await creer("Anna Nyme");
    await route("@/app/api/clients/[id]/anonymisation/route", "POST", `/api/clients/${ecran.id}/anonymisation`, { motif: "DEMANDE_PERSONNE", confirmation: true }, { id: ecran.id });
    const { apercu } = await confirmer(gestes.outilAnonymiserClient, { clientId: outil.id, motif: "DEMANDE_PERSONNE" }, /ANONYMISER la fiche de Anna Nyme[\s\S]*Effacé : [\s\S]*Gardé \(obligation comptable\)/);
    assert.ok(apercu.confirmation);
    const etat = async (id: string) => {
      const c = await prisma.client.findUniqueOrThrow({ where: { id }, include: { emails: true } });
      return { anonymise: Boolean(c.anonymiseLe), emails: c.emails.filter((e) => !e.archiveLe).length, nomGarde: /Nyme/.test(c.nom) };
    };
    assert.deepEqual(await etat(outil.id), await etat(ecran.id));
    assert.equal((await etat(outil.id)).anonymise, true);
  });
});

describe("« publier » : les brouillons seulement, aperçu et jeton quand un mail part", () => {
  test("SIMULATION : une simulation masquée n'est pas republiée ; le brouillon est publié comme par le bouton « Publier » ; retirer = masquer", async () => {
    const e = await ouvrirEspace("Paula", "Publie");
    const { deposerSimulationDossier, changerStatutSimulation, publierSimulations } = await import("@/lib/simulations/dossier");
    const [s1, s2, s3] = await avecActeur(LUCAS, async () => [
      (await deposerSimulationDossier(e.dossierId, await image({ r: 200, g: 180, b: 150 }), { titre: "Chêne", source: "MANUEL" })).id,
      (await deposerSimulationDossier(e.dossierId, await image({ r: 120, g: 140, b: 160 }), { titre: "Marbre", source: "MANUEL" })).id,
      (await deposerSimulationDossier(e.dossierId, await image({ r: 90, g: 70, b: 50 }), { titre: "Noyer", source: "MANUEL" })).id,
    ]);
    await avecActeur(LUCAS, async () => {
      await publierSimulations(e.dossierId, [s3], { prevenir: false });
      await changerStatutSimulation(e.dossierId, s3, "masquer");
    });
    const { apercu, fait } = await confirmer(gestes.outilPublier, { quoi: "SIMULATION", ids: [s1, s3] }, /publier 1 simulation dans l'espace du client : Chêne[\s\S]*mail automatique « votre simulation est prête »[\s\S]*Ignorées car MASQUÉES[^\n]*Noyer/);
    assert.ok(apercu.confirmation);
    assert.match(fait.texte, /1 simulation publiée/);
    await route("@/app/api/dossiers/[id]/simulations/publier/route", "POST", `/api/dossiers/${e.dossierId}/simulations/publier`, { ids: [s2], prevenir: false }, { id: e.dossierId });
    const sim = async (id: string) => {
      const s = await prisma.simulationEspace.findUniqueOrThrow({ where: { id } });
      return { statut: s.statut, publiee: Boolean(s.publieeLe), masquee: Boolean(s.masqueeLe) };
    };
    assert.deepEqual(await sim(s1), await sim(s2));
    assert.equal((await sim(s1)).statut, "PUBLIEE");
    assert.equal((await sim(s3)).statut, "MASQUEE", "la masquée reste masquée");
    const retire = await executer(gestes.outilPublier, { quoi: "SIMULATION", ids: [s1], retirer: true });
    assert.ok(!retire.confirmation, "retirer : réversible, sans confirmation");
    await route("@/app/api/dossiers/[id]/simulations/[sid]/route", "PATCH", `/api/dossiers/${e.dossierId}/simulations/${s2}`, { action: "masquer" }, { id: e.dossierId, sid: s2 });
    assert.deepEqual(await sim(s1), await sim(s2));
    const reaffiche = await executer(gestes.outilPublier, { quoi: "SIMULATION", ids: [s1], reafficher: true });
    assert.ok(reaffiche.confirmation, "réafficher : un mail part");
  });

  test("l'ancien « publier_simulation » ne republie plus une simulation masquée", async () => {
    const e = await ouvrirEspace("Quentin", "Ancien");
    const { deposerSimulationDossier, changerStatutSimulation, publierSimulations } = await import("@/lib/simulations/dossier");
    const s = await avecActeur(LUCAS, async () => (await deposerSimulationDossier(e.dossierId, await image({ r: 10, g: 20, b: 30 }), { titre: "Masquée", source: "MANUEL" })).id);
    await avecActeur(LUCAS, async () => {
      await publierSimulations(e.dossierId, [s], { prevenir: false });
      await changerStatutSimulation(e.dossierId, s, "masquer");
    });
    const { outilPublierSimulation } = await import("@/lib/assistant/outils/ecriture");
    const r = await executer(outilPublierSimulation, { dossierId: e.dossierId });
    assert.match(r.texte, /Aucune simulation à publier/);
  });

  test("PUBLICATION : publier sur le site (sensible) comme « Publier » de l'écran Site ; sans accord écrit, refusé ; retirer sans confirmation", async () => {
    const creer = (titre: string, accord: boolean) => prisma.publicationSite.create({ data: { type: "REALISATION", titre, ville: "Lattes", photoApres: "photos-apres/essai.jpg", accordClientLe: accord ? new Date() : null } });
    const ecran = await creer("Cuisine écran", true);
    const outil = await creer("Cuisine outil", true);
    await route("@/app/api/publications/[id]/route", "PATCH", `/api/publications/${ecran.id}`, { action: "publier" }, { id: ecran.id });
    await confirmer(gestes.outilPublier, { quoi: "PUBLICATION", ids: [outil.id] }, /publier sur coverswap\.fr : la réalisation « Cuisine outil »/);
    const pub = async (id: string) => {
      const p = await prisma.publicationSite.findUniqueOrThrow({ where: { id } });
      return { publiee: Boolean(p.publieLe), retiree: Boolean(p.retireLe) };
    };
    assert.deepEqual(await pub(outil.id), await pub(ecran.id));
    const sansAccord = await creer("Sans accord", false);
    const refus = await confirmer(gestes.outilPublier, { quoi: "PUBLICATION", ids: [sansAccord.id] }, /REFUSÉE : pas d'accord écrit/);
    assert.match(refus.fait.texte, /^Refusé : Publier sans l'accord écrit/);
    assert.equal((await pub(sansAccord.id)).publiee, false);
    const retire = await executer(gestes.outilPublier, { quoi: "PUBLICATION", ids: [outil.id], retirer: true });
    assert.ok(!retire.confirmation);
    await route("@/app/api/publications/[id]/route", "PATCH", `/api/publications/${ecran.id}`, { action: "retirer" }, { id: ecran.id });
    assert.deepEqual(await pub(outil.id), await pub(ecran.id));
  });
});

describe("« agir_systeme » : les gestes techniques", () => {
  test("RELANCER_TACHE (direct) et ANNULER_TACHE (sensible) : même état que les boutons de « Tâches de fond »", async () => {
    const tache = (cle: string) => prisma.tache.create({ data: { type: "ESSAI", cle, statut: "ECHEC_DEFINITIF", tentatives: 8, derniereErreur: "boum", demandeePar: "SYSTEME:essai" } });
    const [a, b] = [await tache("essai-a"), await tache("essai-b")];
    await route("@/app/api/taches/[id]/relancer/route", "POST", `/api/taches/${a.id}/relancer`, undefined, { id: a.id });
    const r = await executer(gestes.outilAgirSysteme, { action: "RELANCER_TACHE", id: b.id });
    assert.ok(!r.confirmation, r.texte);
    const etat = async (id: string) => {
      const t = await prisma.tache.findUniqueOrThrow({ where: { id } });
      return { statut: t.statut, tentatives: t.tentatives, erreur: t.derniereErreur };
    };
    assert.deepEqual(await etat(b.id), await etat(a.id));
    await route("@/app/api/taches/[id]/annuler/route", "POST", `/api/taches/${a.id}/annuler`, undefined, { id: a.id });
    await confirmer(gestes.outilAgirSysteme, { action: "ANNULER_TACHE", id: b.id }, /annuler la tâche de fond ESSAI/);
    assert.deepEqual(await etat(b.id), await etat(a.id));
    assert.equal((await etat(b.id)).statut, "ANNULEE");
  });

  test("RELANCER_SYNCHRO met en file comme « Relancer » de l'Analytique ; CORRIGER_INCOHERENCE disparue : rien ; DETECTER_TACHES", async () => {
    const compter = () => prisma.tache.count({ where: { cle: { startsWith: "analytique:SEARCH_CONSOLE:main:" } } });
    const avant = await compter();
    await route("@/app/api/analytique/synchro/route", "POST", "/api/analytique/synchro", { source: "SEARCH_CONSOLE" });
    const r = await executer(gestes.outilAgirSysteme, { action: "RELANCER_SYNCHRO", source: "SEARCH_CONSOLE" });
    assert.match(r.texte, /Synchronisation « .+ » mise en file/);
    assert.equal(await compter(), avant + 2);
    const disparue = await executer(gestes.outilAgirSysteme, { action: "CORRIGER_INCOHERENCE", cle: "CODE:inexistant" });
    assert.ok(!disparue.confirmation);
    assert.match(disparue.texte, /n'existe plus/);
    const detecte = await executer(gestes.outilAgirSysteme, { action: "DETECTER_TACHES" });
    assert.match(detecte.texte, /^Tâches actualisées/);
  });

  test("sensibles : LANCER_BANC (coût), REJOUER_META tous, DECONNECTER_GOOGLE — aperçu et jeton ; REVOQUER_ACCES confirmé = l'écran", async () => {
    const banc = await executer(gestes.outilAgirSysteme, { action: "LANCER_BANC" });
    assert.ok(banc.confirmation);
    assert.match(banc.texte, /lancer le banc : .*\$ d'images OpenAI/);
    const rejouer = await executer(gestes.outilAgirSysteme, { action: "REJOUER_META" });
    assert.ok(rejouer.confirmation);
    assert.match(rejouer.texte, /SMS d'accusé/);
    const google = await executer(gestes.outilAgirSysteme, { action: "DECONNECTER_GOOGLE" });
    assert.ok(google.confirmation);
    const oauth = await import("@/lib/oauth/serveur");
    const [x, y] = [await oauth.enregistrerClient({ client_name: "App X", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }), await oauth.enregistrerClient({ client_name: "App Y", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })];
    await route("@/app/api/assistant/acces/route", "DELETE", "/api/assistant/acces", { clientId: x.client_id });
    await confirmer(gestes.outilAgirSysteme, { action: "REVOQUER_ACCES", application_id: y.client_id }, /révoquer l'application/);
    const revoque = async (id: string) => Boolean((await prisma.clientOAuth.findUniqueOrThrow({ where: { id } })).revoqueLe);
    assert.equal(await revoque(y.client_id), await revoque(x.client_id));
    assert.equal(await revoque(y.client_id), true);
    const notification = await executer(gestes.outilAgirSysteme, { action: "TESTER_NOTIFICATION", canal: "APPAREIL" });
    assert.ok(!notification.confirmation);
    assert.match(notification.texte, /Notification d'essai aux appareils/);
    assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  });
});

describe("« valider_proposition » : confirmation pour toute proposition sensible (défaut § 3.23)", () => {
  test("un mail proposé hors d'une carte de mail, une fusion de clients : aperçu et jeton ; une règle de tri : directe", async () => {
    const { outilValiderProposition } = await import("@/lib/assistant/outils/mail");
    const mailPropose = await prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre: "Relance du devis", contenu: JSON.stringify({ motif: "RELANCE_DEVIS", a: "client@exemple.test", objet: "Votre devis", texte: "Bonjour, avez-vous pu regarder le devis ? Lucas", documentIds: [] }), cleUnicite: "gestes-envoi" } });
    const r = await executer(outilValiderProposition, { propositionIds: [mailPropose.id] });
    assert.ok(r.confirmation, r.texte);
    assert.match(r.texte, /Mail à client@exemple\.test — objet « Votre devis »/);
    const a = await prisma.client.create({ data: { nom: "Fusion A", source: "INCONNUE", premierContactLe: new Date() } });
    const b = await prisma.client.create({ data: { nom: "Fusion B", source: "INCONNUE", premierContactLe: new Date() } });
    const fusion = await prisma.proposition.create({ data: { type: "FUSION_CLIENTS", auteur: "SYSTEME:doublons", titre: "Fusionner A et B ?", contenu: JSON.stringify({ clientAId: a.id, clientBId: b.id, conserver: "A" }), cleUnicite: "gestes-fusion" } });
    const f = await executer(outilValiderProposition, { propositionIds: [fusion.id], corrections: { conserver: "B" } });
    assert.ok(f.confirmation, f.texte);
    assert.match(f.texte, /Fiche conservée : B/);
    const regle = await prisma.proposition.create({ data: { type: "REGLE_TRI", auteur: "ASSISTANT:claude", titre: "Toujours ranger", contenu: JSON.stringify({ cible: "promo@exemple.test", action: "RANGER", motif: "Publicité", origine: "ASSISTANT" }), cleUnicite: "gestes-regle" } });
    const directe = await executer(outilValiderProposition, { propositionIds: [regle.id] });
    assert.ok(!directe.confirmation, directe.texte);
  });
});
