import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-mcp-taches-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN", "META_PAGE_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY", "OPENAI_ADMIN_KEY"]) process.env[cle] = "";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 17 (partie A) — les tâches de Lucas depuis l'assistant : « taches » (aujourd'hui, j'ai N minutes, par
 * type), « repondre_tache » (fait, plus tard, pas à faire, annuler ; aperçu et jeton quand l'effet touche le client ;
 * titre approché ambigu → candidats), « ajouter_tache » (avec une cible), « ce_qui_m_attend » qui lit les tâches, et un
 * vrai client MCP. Les tâches sont écrites par le moteur (`reconcilier`) à partir de détections construites à la main.
 * Instant fixe injecté ; noms fictifs ; aucun réseau.
 */

type Detection = import("@/lib/a-faire/types").Detection;
type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type Client = import("@modelcontextprotocol/sdk/client/index.js").Client;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let moteur: typeof import("@/lib/a-faire/moteur");
let lecture: typeof import("@/lib/a-faire/lecture");
let session: import("@/lib/assistant/execution").Session;
let route: typeof import("@/app/api/mcp/route");
let NextRequest: typeof import("next/server").NextRequest;
let client: Client;

/** Mercredi 30/09/2026, 10 h à Paris (heure d'été). */
const MERCREDI = new Date("2026-09-30T08:00:00.000Z");
const J = 86_400_000;
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const MCP = "http://localhost:3001/api/mcp";
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

const ids: Record<string, string> = {};

async function appeler(nom: string, entree: Record<string, unknown>, maintenant = MERCREDI): Promise<ResultatOutil> {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, entree, session, maintenant);
}
const tache = (cle: string) => prisma.tacheAFaire.findUniqueOrThrow({ where: { cle } });

function detection(p: Partial<Detection> & Pick<Detection, "cle" | "type" | "titre" | "raison" | "raccourci">): Detection {
  const sujet = p.sujet ?? (p.dossierId ? { type: "DOSSIER" as const, id: p.dossierId } : p.leadId ? { type: "LEAD" as const, id: p.leadId } : { type: "SYSTEME" as const, id: null });
  return { source: "DOSSIERS", niveau: 3, depuis: plus(MERCREDI, -2 * J), ...p, sujet };
}

const fetchLocal: typeof fetch = async (entree, init) => {
  const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
  const requete = new NextRequest(new Request(url, init));
  if (requete.method === "POST") return route.POST(requete);
  if (requete.method === "DELETE") return route.DELETE(requete);
  return route.GET(requete);
};

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
  catalogue = await import("@/lib/assistant/catalogue");
  moteur = await import("@/lib/a-faire/moteur");
  lecture = await import("@/lib/a-faire/lecture");
  route = await import("@/app/api/mcp/route");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local", maintenant: MERCREDI });

  // Les sujets : un dossier (Bloch), trois contacts, deux propositions de mail (relance, validation).
  const bloch = await prisma.dossier.create({ data: { clientNom: "Bloch", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000001", objet: "Cuisine", source: "ENTRANT", etape: "SIMULATION" } });
  ids.bloch = bloch.id;
  const nadia = await prisma.lead.create({ data: { prenom: "Nadia", nom: "Essai", telephone: "+33612345678", ville: "Lattes", source: "META_ADS" } });
  ids.nadia = nadia.id;
  const odile = await prisma.lead.create({ data: { prenom: "Odile", nom: "Sansreponse", telephone: "+33612345679", ville: "Pérols", source: "META_ADS", tentatives: 1 } });
  ids.odile = odile.id;
  const pierre = await prisma.lead.create({ data: { prenom: "Pierre", nom: "Perdu", telephone: "+33612345680", ville: "Mauguio", source: "META_ADS" } });
  ids.pierre = pierre.id;
  const mail = (titre: string, motif: string, cle: string) =>
    prisma.proposition.create({ data: { type: "ENVOI_MAIL", auteur: "SYSTEME:relances", titre, contenu: JSON.stringify({ motif, a: "bloch@exemple.test", objet: "Votre devis cuisine", texte: "Bonjour, avez-vous pu regarder le devis ? Lucas", documentIds: [] }), cleUnicite: cle } });
  ids.relance = (await mail("Relance du devis Bloch", "RELANCE_DEVIS", "essai-relance")).id;
  ids.validation = (await mail("Envoyer la relance à Bloch", "RELANCE_DEVIS", "essai-validation")).id;

  const detections: Detection[] = [
    detection({ cle: `DEVIS:dossier:${bloch.id}`, type: "DEVIS", dossierId: bloch.id, titre: "Faire le devis · Bloch", raison: "simulation validée le 28/09", raccourci: { genre: "DEVIS", libelle: "Faire le devis", dossierId: bloch.id, devis: "nouveau", href: `/dossiers?dossier=${bloch.id}&devis=nouveau` } }),
    detection({ cle: `RELANCER_DEVIS:dossier:${bloch.id}`, type: "RELANCER_DEVIS", source: "RELANCES", niveau: 2, dossierId: bloch.id, titre: "Relancer le devis · Bloch", raison: "devis envoyé il y a 8 jours", raccourci: { genre: "RELANCE_MAIL", libelle: "Relire la relance", propositionId: ids.relance, dossierId: bloch.id }, donnees: { propositionId: ids.relance } }),
    detection({ cle: `APPELER:lead:${nadia.id}`, type: "APPELER", source: "LEADS", niveau: 2, leadId: nadia.id, titre: "Appeler · Nadia Essai", raison: "nouveau contact d'hier", raccourci: { genre: "APPEL", libelle: "Appeler", telephone: "+33612345678", leadId: nadia.id } }),
    detection({ cle: `RAPPELER:lead:${odile.id}`, type: "RAPPELER", source: "LEADS", niveau: 2, leadId: odile.id, titre: "Rappeler · Odile Sansreponse", raison: "pas de réponse lundi", raccourci: { genre: "SMS", libelle: "Copier le SMS", telephone: "+33612345679", leadId: odile.id, sms: { action: "PAS_DE_REPONSE", leadId: odile.id } } }),
    detection({ cle: `ENVOYER_LIEN:lead:${pierre.id}`, type: "ENVOYER_LIEN", source: "SIGNAUX", leadId: pierre.id, titre: "Envoyer le lien · Pierre Perdu", raison: "intéressé au téléphone", raccourci: { genre: "SMS", libelle: "Copier le SMS", leadId: pierre.id, sms: { action: "ENVOYER_LIEN", leadId: pierre.id } } }),
    detection({ cle: `RELANCER_PHOTOS:lead:${pierre.id}`, type: "RELANCER_PHOTOS", source: "RELANCES", leadId: pierre.id, titre: "Relancer pour les photos · Pierre Perdu", raison: "espace ouvert sans photo", raccourci: { genre: "SMS", libelle: "Copier le SMS", leadId: pierre.id }, donnees: { texteSms: "Bonjour Pierre, vos photos nous aideront à préparer la simulation. Lucas" } }),
    detection({ cle: `DECIDER:lead:${pierre.id}`, type: "DECIDER", source: "LEADS", leadId: pierre.id, titre: "Décider · Pierre Perdu", raison: "appelé, sans rappel daté", raccourci: { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: pierre.id } }),
    detection({ cle: `VALIDER:systeme:${ids.validation}`, type: "VALIDER", source: "PROPOSITIONS", niveau: 2, titre: "Valider · Envoyer la relance à Bloch", raison: "relance proposée ce matin", raccourci: { genre: "VALIDER", libelle: "Valider", propositionId: ids.validation }, donnees: { propositionId: ids.validation } }),
  ];
  const bilan = await moteur.reconcilier(detections, { sources: ["DOSSIERS", "RELANCES", "LEADS", "SIGNAUX", "PROPOSITIONS"], maintenant: MERCREDI });
  assert.equal(bilan.crees, detections.length);
  for (const d of detections) ids[d.cle] = (await tache(d.cle)).id;

  // Parcours OAuth, puis un vrai client MCP sur la route /api/mcp (comme mcp-v3).
  const oauth = await import("@/lib/oauth/serveur");
  const enregistrement = await oauth.enregistrerClient({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  const verifier = randomBytes(32).toString("base64url");
  const demande = await oauth.demandeAutorisation({ client_id: enregistrement.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: MCP });
  const code = new URL(await oauth.accorder(demande, "lucas@exemple.fr")).searchParams.get("code")!;
  const jetons = await oauth.echangerJeton(new URLSearchParams({ grant_type: "authorization_code", client_id: enregistrement.client_id, code, code_verifier: verifier, resource: MCP }), new Headers());
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  client = new Client({ name: "Claude", version: "1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { fetch: fetchLocal, requestInit: { headers: { Authorization: `Bearer ${jetons.access_token}` } } }));
});

after(async () => {
  await client?.close().catch(() => undefined);
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

type TacheLue = import("@/lib/assistant/outils/taches").TacheLue;

describe("« taches » : la liste lue à voix haute", () => {
  test("aujourd'hui : le nombre et le temps, chaque tâche avec son identifiant, son geste en mots, le lien absolu et le texte prêt", async () => {
    const r = await appeler("taches", {});
    const liste = await lecture.listeTaches(MERCREDI);
    assert.match(r.texte, new RegExp(`^${liste.compteurs.aujourdhui} tâches aujourd'hui, environ ${liste.compteurs.minutesAujourdhui} minutes\\.`));
    const devis = ids[`DEVIS:dossier:${ids.bloch}`];
    assert.match(r.texte, new RegExp(`\\d+\\. Faire le devis · Bloch — simulation validée le 28/09, 10 min \\[tache:${devis}\\]`));
    assert.ok(r.texte.includes(`→ ouvrir le devis prérempli : http://localhost:3001/dossiers?dossier=${ids.bloch}&devis=nouveau`), r.texte);
    assert.match(r.texte, /Appeler · Nadia Essai — nouveau contact d'hier, 3 min \[tache:\w+\]\n {3}→ appeler le 06 12 34 56 78/);
    // SMS : le catalogue (l'action n'ouvre rien), le texte du détecteur, ou l'écran SMS quand l'action ouvrirait l'espace.
    assert.match(r.texte, /Rappeler · Odile Sansreponse[^\n]*\n[^\n]*\n {3}SMS prêt \(au 06 12 34 56 79\) : « [^»]*essayé de vous joindre[^»]*demain vers 18 h/);
    assert.match(r.texte, /SMS prêt : « Bonjour Pierre, vos photos nous aideront/);
    assert.match(r.texte, /Envoyer le lien · Pierre Perdu[^\n]*\n[^\n]*\n {3}texte prêt dans l'écran SMS : http:\/\/localhost:3001\//);
    assert.equal(await prisma.espaceClient.count(), 0, "une lecture n'ouvre aucun espace");
    // Mail de relance : le texte de la proposition.
    assert.match(r.texte, /Relancer le devis · Bloch[^\n]*\n[^\n]*\n {3}mail prêt pour bloch@exemple\.test, objet « Votre devis cuisine » : « Bonjour, avez-vous pu regarder le devis \? Lucas »/);
    // Données exactes : la liste, chaque tâche avec son geste, son lien et son texte prêt.
    const donnees = r.donnees as { vue: string; compteurs: { aujourdhui: number }; taches: TacheLue[] };
    assert.equal(donnees.vue, "AUJOURDHUI");
    assert.deepEqual(donnees.taches.map((t) => t.id), liste.aujourdhui.map((t) => t.id));
    const lue = donnees.taches.find((t) => t.id === devis)!;
    assert.equal(lue.lien, `http://localhost:3001/dossiers?dossier=${ids.bloch}&devis=nouveau`);
    const relance = donnees.taches.find((t) => t.id === ids[`RELANCER_DEVIS:dossier:${ids.bloch}`])!;
    assert.deepEqual(relance.textePret, { canal: "MAIL", texte: "Bonjour, avez-vous pu regarder le devis ? Lucas", objet: "Votre devis cuisine", a: "bloch@exemple.test", propositionId: ids.relance, source: "PROPOSITION" });
    assert.doesNotMatch(r.texte, /a échoué|^Refusé/);
  });

  test("« j'ai 15 minutes » : le plan du moteur, regroupé (« 2 appels · 6 min ») ; par type : les appels ensemble", async () => {
    const r = await appeler("taches", { minutes: 15 });
    const plan = await lecture.planMinutes(15, MERCREDI);
    assert.ok(plan.taches.length > 0);
    assert.match(r.texte, new RegExp(`^Avec 15 minutes : ${plan.groupes.map((g) => g.libelle).join(", ")} \\(${plan.utilisees} min sur 15\\)\\.`));
    assert.ok(plan.groupes.some((g) => /^\d+ appels? · \d+ min$/.test(g.libelle)), JSON.stringify(plan.groupes));
    const donnees = r.donnees as { groupes: unknown; taches: TacheLue[] };
    assert.deepEqual(donnees.groupes, plan.groupes);
    assert.deepEqual(donnees.taches.map((t) => t.id), plan.taches.map((t) => t.id));

    const parType = await appeler("taches", { vue: "PAR_TYPE" });
    assert.match(parType.texte, /^\d+ tâches à faire, environ .*, par type :/);
    assert.match(parType.texte, /\nAppels \(2 · 6 min\) :\n1\. Appeler · Nadia Essai[^\n]*\n.*\n2\. Rappeler · Odile Sansreponse/);
    assert.match(parType.texte, /\nDevis \(1 · 10 min\) :\n1\. Faire le devis · Bloch/);
  });
});

describe("« repondre_tache » : fait, plus tard, pas à faire, annuler", () => {
  test("FAIT par identifiant, puis ANNULER : l'effet (appel noté) est annulé avant de partir, la tâche est de nouveau à faire", async () => {
    const id = ids[`APPELER:lead:${ids.nadia}`];
    const r = await appeler("repondre_tache", { tache: id, reponse: "FAIT", commande: "C'est fait, je l'ai eue" });
    assert.match(r.texte, /^C'est noté : « Appeler · Nadia Essai » est faite\. Dans 6 secondes : l'appel sera noté sur la fiche\. Pour annuler : « repondre_tache » avec tache « \w+ » et reponse ANNULER\.$/);
    const faite = await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([faite.statut, faite.reponse, faite.reponduPar], ["FAITE", "FAIT", "ASSISTANT:claude"]);
    assert.equal(faite.reponduLe?.toISOString(), MERCREDI.toISOString());
    const effet = await prisma.tache.findFirstOrThrow({ where: { cle: { startsWith: `a-faire-effet:${id}:` } } });
    assert.equal(effet.statut, "EN_ATTENTE");

    const annule = await appeler("repondre_tache", { tache: id, reponse: "ANNULER", commande: "Non, annule" });
    assert.match(annule.texte, /^Annulé : « Appeler · Nadia Essai » est de nouveau à faire\. L'effet n'était pas encore parti : il ne partira pas\./);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } })).statut, "A_FAIRE");
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { id: effet.id } })).statut, "ANNULEE");
    const nadia = await prisma.lead.findUniqueOrThrow({ where: { id: ids.nadia } });
    assert.deepEqual([nadia.dernierContactLe, nadia.dernierAppelLe], [null, null]);
  });

  test("PLUS_TARD DEMAIN (9 h, heure de Paris) ; PLUS_TARD « le 12 » (date dictée) ; une date illisible est refusée", async () => {
    const id = ids[`APPELER:lead:${ids.nadia}`];
    const r = await appeler("repondre_tache", { tache: id, reponse: "PLUS_TARD", quand: "DEMAIN", raison: "PAS_LE_TEMPS", commande: "Plus tard, demain" });
    assert.match(r.texte, /^« Appeler · Nadia Essai » reportée : elle revient jeudi 1er octobre à 9 h \(pas le temps aujourd'hui\), ou plus tôt si le client se manifeste\./);
    const reportee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([reportee.statut, reportee.plusTardJusqua?.toISOString(), reportee.reponseRaison], ["PLUS_TARD", "2026-10-01T07:00:00.000Z", "PAS_LE_TEMPS"]);

    const devis = ids[`DEVIS:dossier:${ids.bloch}`];
    const le12 = await appeler("repondre_tache", { tache: devis, reponse: "PLUS_TARD", quand: "le 12", commande: "Le devis Bloch, le 12" });
    assert.match(le12.texte, /revient lundi 12 octobre à 9 h/);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: devis } })).plusTardJusqua?.toISOString(), "2026-10-12T07:00:00.000Z");
    await appeler("repondre_tache", { tache: devis, reponse: "ANNULER", commande: "annule" });
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: devis } })).statut, "A_FAIRE");

    const illisible = await appeler("repondre_tache", { tache: devis, reponse: "PLUS_TARD", quand: "quand il fera beau", commande: "plus tard" });
    assert.match(illisible.texte, /^Refusé : Je ne comprends pas « quand il fera beau »/);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: devis } })).statut, "A_FAIRE");
  });

  test("PAS_A_FAIRE exige une raison adaptée au type ; avec PAS_PERTINENT, la tâche est écartée", async () => {
    const id = ids[`DECIDER:lead:${ids.pierre}`];
    const sans = await appeler("repondre_tache", { tache: id, reponse: "PAS_A_FAIRE", commande: "Laisse tomber" });
    assert.match(sans.texte, /^Refusé : « Pas à faire » : choisis la raison \(déjà fait hors crm, client perdu, pas pertinent, autre\)\./);
    const r = await appeler("repondre_tache", { tache: id, reponse: "PAS_A_FAIRE", raison: "pas_pertinent", commande: "Pas pertinent" });
    assert.match(r.texte, /^« Décider · Pierre Perdu » écartée \(pas pertinent\)\. Pour annuler/);
    const ecartee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([ecartee.statut, ecartee.reponseRaison], ["PAS_A_FAIRE", "PAS_PERTINENT"]);
  });

  test("titre approché : deux tâches « devis Bloch » → les candidats, rien de fait ; un titre net → la bonne", async () => {
    const ambigu = await appeler("repondre_tache", { tache: "le devis de Bloch", reponse: "FAIT", commande: "C'est fait, le devis Bloch" });
    assert.match(ambigu.texte, /^Plusieurs tâches correspondent à « le devis de Bloch », je ne choisis pas à ta place :/);
    assert.match(ambigu.texte, /- Faire le devis · Bloch — simulation validée le 28\/09 \[tache:\w+\]/);
    assert.match(ambigu.texte, /- Relancer le devis · Bloch — devis envoyé il y a 8 jours \[tache:\w+\]/);
    assert.equal(ambigu.confirmation, undefined);
    assert.equal((await tache(`DEVIS:dossier:${ids.bloch}`)).statut, "A_FAIRE");
    assert.equal((await tache(`RELANCER_DEVIS:dossier:${ids.bloch}`)).statut, "A_FAIRE");

    const aucune = await appeler("repondre_tache", { tache: "tapisserie du salon", reponse: "FAIT", commande: "c'est fait" });
    assert.match(aucune.texte, /^Aucune tâche ouverte ne correspond à « tapisserie du salon »/);

    const nette = await appeler("repondre_tache", { tache: "faire le devis Bloch", reponse: "PLUS_TARD", quand: "ce soir", commande: "Le devis Bloch, ce soir" });
    assert.match(nette.texte, /^« Faire le devis · Bloch » reportée : elle revient mercredi 30 septembre à 18 h/);
    await appeler("repondre_tache", { tache: "faire le devis Bloch", reponse: "ANNULER", commande: "annule" });
    assert.equal((await tache(`DEVIS:dossier:${ids.bloch}`)).statut, "A_FAIRE");
  });

  test("réponse sensible : « Fait » sur une validation qui envoie un mail → aperçu (« le mail de relance partira à … ») ; sans jeton rien n'est fait ; avec, la proposition est validée", async () => {
    const id = ids[`VALIDER:systeme:${ids.validation}`];
    const entree = { tache: id, reponse: "FAIT", commande: "C'est bon, envoie la relance" };
    const apercu = await appeler("repondre_tache", entree);
    assert.match(apercu.texte, /^Je vais marquer « Valider · Envoyer la relance à Bloch » comme faite\. Dès ta confirmation : la proposition « Envoyer la relance à Bloch » sera validée : le mail de relance partira à bloch@exemple\.test \(objet « Votre devis cuisine »\) tout de suite/);
    assert.match(apercu.texte, /Rien n'a été fait\. Si Lucas confirme, rappelle « repondre_tache »/);
    assert.ok(apercu.confirmation?.jeton);
    // Sans jeton, rien : la tâche est à faire, la proposition en attente, aucun effet en file.
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } })).statut, "A_FAIRE");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: ids.validation } })).statut, "EN_ATTENTE");
    assert.equal(await prisma.tache.count({ where: { cle: { startsWith: `a-faire-effet:${id}:` } } }), 0);
    // Un autre jeton, ou d'autres paramètres : refusé.
    const change = await appeler("repondre_tache", { ...entree, texte: "autre", confirmation: apercu.confirmation!.jeton });
    assert.match(change.texte, /^Refusé : Les paramètres ont changé depuis l'aperçu/);
    // Avec le jeton : validée (ici, sans boîte mail configurée, l'envoi échoue et la tâche reste à faire — dit tel quel).
    const confirme = await appeler("repondre_tache", { ...entree, confirmation: (await appeler("repondre_tache", entree)).confirmation!.jeton });
    const proposition = await prisma.proposition.findUniqueOrThrow({ where: { id: ids.validation } });
    assert.notEqual(proposition.statut, "EN_ATTENTE");
    assert.equal(proposition.decidePar, "ASSISTANT:claude");
    assert.match(confirme.texte, /^La proposition « Envoyer la relance à Bloch » est validée mais n'a pas abouti \(Aucun envoi de mail configuré/);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } })).statut, "A_FAIRE");
  });

  test("réponse sensible : « client perdu » → aperçu (contact classé sans suite), puis, confirmé, la tâche est écartée et la perte part en file", async () => {
    const id = ids[`ENVOYER_LIEN:lead:${ids.pierre}`];
    const sansMotif = await appeler("repondre_tache", { tache: id, reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", commande: "Il est perdu" });
    assert.match(sansMotif.texte, /^Refusé : Client perdu : motif de perte obligatoire/);
    const entree = { tache: id, reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU", motif_perte: "PRIX", commande: "Perdu, trop cher" };
    const apercu = await appeler("repondre_tache", entree);
    assert.match(apercu.texte, /^Je vais écarter « Envoyer le lien · Pierre Perdu » : client perdu\. 6 secondes après ta confirmation : le contact Pierre Perdu sera classé sans suite \(motif : trop cher\)/);
    assert.equal((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } })).statut, "A_FAIRE");
    const fait = await appeler("repondre_tache", { ...entree, confirmation: apercu.confirmation!.jeton });
    assert.match(fait.texte, /^« Envoyer le lien · Pierre Perdu » écartée \(client perdu\)\. Motif de perte : trop cher\. Dans 6 secondes : le contact Pierre Perdu sera classé sans suite/);
    const ecartee = await prisma.tacheAFaire.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([ecartee.statut, ecartee.reponseRaison, ecartee.reponduPar], ["PAS_A_FAIRE", "CLIENT_PERDU", "ASSISTANT:claude"]);
    const effet = await prisma.tache.findFirstOrThrow({ where: { cle: { startsWith: `a-faire-effet:${id}:` } } });
    assert.match(effet.charge, /"genre":"PERTE_LEAD".*"motifPerte":"PRIX"/);
  });
});

describe("« ajouter_tache », « ce_qui_m_attend »", () => {
  test("ajouter_tache avec une cible (nom) et une date dictée : une tâche MANUELLE sur le contact, « Plus tard » jusqu'à jeudi 9 h", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Zéphyrin", nom: "Moulard", telephone: "+33612345681", ville: "Castries", source: "META_ADS" } });
    const r = await appeler("ajouter_tache", { titre: "Passer voir la cuisine de Moulard", quand: "jeudi", cible: { nom: "Moulard" }, commande: "Ajoute : passer voir la cuisine de Moulard jeudi" });
    assert.match(r.texte, /^Tâche ajoutée : « Passer voir la cuisine de Moulard » \(Zéphyrin Moulard\), pour jeudi 1er octobre \[tache:\w+\]\./);
    const ajoutee = await prisma.tacheAFaire.findFirstOrThrow({ where: { type: "MANUELLE", titre: "Passer voir la cuisine de Moulard" } });
    // Relecture : datée, elle attend dans « Plus tard » jusqu'au jour dit (9 h) et n'encombre pas « Aujourd'hui ».
    assert.match(r.texte, /Elle attend dans « Plus tard » et revient en tête de ta liste ce jour-là/);
    assert.deepEqual(
      [ajoutee.leadId, ajoutee.sujetType, ajoutee.source, ajoutee.statut, ajoutee.echeance?.toISOString(), ajoutee.plusTardJusqua?.toISOString(), ajoutee.raison],
      [lead.id, "LEAD", "MANUELLE", "PLUS_TARD", "2026-10-01T07:00:00.000Z", "2026-10-01T07:00:00.000Z", "pour le 1 oct."]
    );
    assert.equal((r.donnees as TacheLue).lien, `http://localhost:3001/leads?lead=${lead.id}`);

    const inconnu = await appeler("ajouter_tache", { titre: "Rappeler quelqu'un", cible: { nom: "Xylophène Introuvable" }, commande: "ajoute" });
    assert.match(inconnu.texte, /Aucun contact ne correspond/);
  });

  test("ce_qui_m_attend lit la liste des tâches à l'instant du contexte (une tâche reportée à demain revient jeudi)", async () => {
    const liste = await lecture.listeTaches(MERCREDI);
    const r = await appeler("ce_qui_m_attend", {});
    assert.match(r.texte, new RegExp(`^${liste.compteurs.aujourdhui} tâches aujourd'hui, environ `));
    // La reportée à demain et la tâche ajoutée pour jeudi (« Plus tard » jusqu'à jeudi 9 h).
    assert.match(r.texte, /2 reviennent demain/);
    assert.match(r.texte, /Plus tard \(\d+\) :\n1\. Appeler · Nadia Essai — nouveau contact d'hier, 3 min · revient jeudi 1er octobre à 9 h/);
    assert.match(r.texte, /Fait aujourd'hui \(\d+\) :\n1\. /);
    assert.match(r.texte, /\nAussi : 0 mail à traiter, 1 proposition à valider \(cartes de mise à jour, relances, règles\), 0 message d'espace non lu\./);
    const d = r.donnees as { compteurs: { aujourdhui: number }; aujourdhui: TacheLue[] };
    assert.equal(d.compteurs.aujourdhui, liste.compteurs.aujourdhui);
    assert.ok(!d.aujourdhui.some((t) => t.id === ids[`APPELER:lead:${ids.nadia}`]));

    const jeudi = await appeler("ce_qui_m_attend", {}, new Date("2026-10-01T08:00:00.000Z"));
    assert.match(jeudi.texte, /\d+\. Appeler · Nadia Essai — nouveau contact d'hier, 3 min · revenue d'un « plus tard » \[tache:/);

    const point = await appeler("point_du_jour", { depuis_heures: 24 });
    assert.match(point.texte, /\nCe qui t'attend : \d+ tâches aujourd'hui, environ .* : 1\. /);
    assert.match(point.texte, /\nAujourd'hui : 0 mail à traiter, 0 message d'espace non lu, 1 proposition à valider\./);
  });

  test("relecture : un seul compteur de mails — ce_qui_m_attend et point_du_jour disent le nombre de l'onglet Mail (tâches du mail et de l'espace)", async () => {
    const { compterMailATraiter } = await import("@/lib/a-faire/ecran");
    // Une tâche « Répondre » venue du mail (la boîte elle-même est vide dans cet essai : l'ancien compteur disait 0).
    await moteur.reconcilier([detection({ cle: "REPONDRE:fil:essai-compteur", type: "REPONDRE", source: "MAIL", titre: "Répondre · Inconnu", raison: "« Question » · reçu le 30/09 à 9 h", raccourci: { genre: "MAIL", libelle: "Répondre", href: "/mail" } })], { sources: [], maintenant: MERCREDI });
    const nombre = await compterMailATraiter(MERCREDI);
    assert.equal(nombre, 1);
    const r = await appeler("ce_qui_m_attend", {});
    assert.match(r.texte, /\nAussi : 1 mail à traiter, /);
    assert.equal((r.donnees as { compteurs: { mailsATraiter: number } }).compteurs.mailsATraiter, nombre);
    const point = await appeler("point_du_jour", { depuis_heures: 24 });
    assert.match(point.texte, /\nAujourd'hui : 1 mail à traiter, /);
    assert.equal((point.donnees as { aujourdhui: { nombreMailsATraiter: number } }).aujourdhui.nombreMailsATraiter, nombre);
    await prisma.tacheAFaire.update({ where: { cle: "REPONDRE:fil:essai-compteur" }, data: { archiveLe: MERCREDI, archiveMotif: "essai" } });
  });
});

describe("le catalogue et un vrai client MCP", () => {
  test("84 outils (partie B : « analytique ») : « taches » en lecture, « repondre_tache » et « ajouter_tache » en écriture réversible ; tools/list les expose ; « taches » répond par le client", async () => {
    const { registreOutils } = await import("@/lib/assistant/couverture");
    const registre = registreOutils();
    assert.equal(registre.nombre, 84);
    const outil = (nom: string) => registre.outils.find((o) => o.nom === nom);
    assert.deepEqual([outil("taches")?.niveau, outil("taches")?.parametres], ["LECTURE", ["minutes", "vue"]]);
    assert.deepEqual([outil("repondre_tache")?.niveau, outil("repondre_tache")?.parametres], ["REVERSIBLE", ["motif_perte", "precision", "quand", "raison", "reponse", "tache", "texte"]]);
    assert.deepEqual([outil("ajouter_tache")?.niveau, outil("ajouter_tache")?.parametres], ["REVERSIBLE", ["cible", "quand", "raison", "titre"]]);

    const outils = await client.listTools();
    for (const nom of ["taches", "repondre_tache", "ajouter_tache"]) assert.ok(outils.tools.some((t) => t.name === nom), `absent de tools/list : ${nom}`);
    const niveau = (nom: string) => outils.tools.find((t) => t.name === nom)?.description?.match(/^\[([^\]]+)\]/)?.[1];
    assert.deepEqual([niveau("taches"), niveau("repondre_tache"), niveau("ajouter_tache")], ["Lecture", "Écriture réversible", "Écriture réversible"]);
    const schemaRepondre = outils.tools.find((t) => t.name === "repondre_tache")!.inputSchema as { properties: Record<string, unknown> };
    assert.ok(schemaRepondre.properties.commande && schemaRepondre.properties.confirmation, "commande et confirmation ajoutées aux outils d'écriture");

    const resultat = (await client.callTool({ name: "taches", arguments: { vue: "LOTS" } })) as { content: { type: string; text?: string }[] };
    const texte = resultat.content.map((c) => c.text ?? "").join("\n");
    assert.match(texte, /^Aucun lot à classer\./);
    assert.match(texte, /Données exactes \(JSON\) :\n\{"vue":"LOTS"/);
    const consignes = await client.readResource({ uri: "coverswap://consignes" });
    assert.match((consignes.contents[0] as { text: string }).text, /^## Tâches \(mission 17\)\n- Tâches : « qu'est-ce que j'ai à faire \? ».*→ « taches »/m);
    assert.deepEqual(appelsReseau, []);
  });
});
