import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 14 (29/09/2026), partie 3 — Leads en deux listes : « À appeler »
 * (jamais appelés) et « À rappeler » (rappels datés dans l'ordre, retards en
 * tête, puis sans date, le plus ancien appel d'abord), tri et pagination côté
 * serveur, l'onglet qui ne compte que les retards, « Traiter » retiré, le suivi
 * des appels (`dernierAppelLe`, `tentatives`) et sa migration. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let leads: typeof import("@/lib/prospects/leads");
let appels: typeof import("@/lib/commercial/appels");
let entrants: typeof import("@/lib/prospects/entrants");
let pilotage: typeof import("@/lib/commercial/pilotage");
let lecture: typeof import("@/lib/commercial/sans-reponse");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-3");
let outils: typeof import("@/lib/assistant/outils/lister");
let notes: typeof import("@/lib/commercial/notes-appel");
let doublons: typeof import("@/lib/prospects/doublons");
let NextRequest: typeof import("next/server").NextRequest;

/** Mercredi 30 septembre 2026, midi à Paris. */
const MAINTENANT = new Date("2026-09-30T10:00:00.000Z");
const le = (texte: string) => new Date(texte);
const MIGRATION = { acteur: "MIGRATION:appels-des-leads-14-3", origine: "essai" };

let numero = 0;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Partie Trois", telephone: `+3361300${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", createdAt: le("2026-09-20T08:00:00Z"), ...donnees } });
const dossierDe = (leadId: string) =>
  prisma.dossier.create({ data: { leadId, clientNom: "Dossier Essai", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33613009999", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const ids = (liste: { lignes: { id: string }[] }) => liste.lignes.map((l) => l.id);

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.TACHES_DESACTIVEES = "1";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  leads = await import("@/lib/prospects/leads");
  appels = await import("@/lib/commercial/appels");
  entrants = await import("@/lib/prospects/entrants");
  pilotage = await import("@/lib/commercial/pilotage");
  lecture = await import("@/lib/commercial/sans-reponse");
  migration = await import("@/lib/base/migrations/mission-14-partie-3");
  outils = await import("@/lib/assistant/outils/lister");
  notes = await import("@/lib/commercial/notes-appel");
  doublons = await import("@/lib/prospects/doublons");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("les deux listes de Leads", () => {
  let jamais: { id: string };
  let traite: { id: string };
  let hier: { id: string };
  let plusTard: { id: string };
  let demain: { id: string };
  let sansDateAncien: { id: string };
  let sansDate: { id: string };
  let avecDossier: { id: string };

  test("À appeler : jamais appelés ; À rappeler : datés dans l'ordre (retard en tête), puis sans date, plus ancien appel d'abord ; ni archivé, ni perdu, ni dossier", async () => {
    // Créés dans le désordre : l'ordre vient du serveur.
    sansDate = await lead("SansDate", { dernierAppelLe: le("2026-09-28T09:00:00Z"), tentatives: 2 });
    demain = await lead("Demain", { rappelLe: le("2026-10-01T08:00:00Z") });
    jamais = await lead("Jamais", { createdAt: le("2026-09-22T08:00:00Z") });
    hier = await lead("Hier", { dernierAppelLe: le("2026-09-27T09:00:00Z"), rappelLe: le("2026-09-29T16:00:00Z"), tentatives: 1 });
    sansDateAncien = await lead("SansDateAncien", { dernierAppelLe: le("2026-09-25T09:00:00Z") });
    plusTard = await lead("PlusTard", { dernierAppelLe: le("2026-09-29T09:00:00Z"), rappelLe: le("2026-09-30T16:00:00Z") });
    // L'ancien « traité » : il apparaît quand même (la colonne n'est plus lue).
    traite = await lead("Traite", { createdAt: le("2026-09-21T08:00:00Z"), traiteLe: le("2026-09-23T10:00:00Z") });
    const archive = await lead("Archive", { archiveLe: le("2026-09-24T10:00:00Z"), archiveMotif: "Autre", dernierAppelLe: le("2026-09-23T10:00:00Z") });
    const perdu = await lead("Perdu", { statut: "PERDU", motifPerte: "PRIX", dernierAppelLe: le("2026-09-23T10:00:00Z") });
    avecDossier = await lead("AvecDossier", { dernierAppelLe: le("2026-09-23T10:00:00Z"), rappelLe: le("2026-09-29T08:00:00Z") });
    await dossierDe(avecDossier.id);

    const aAppeler = await leads.listerLeads({ vue: "A_APPELER" }, MAINTENANT);
    const aRappeler = await leads.listerLeads({ vue: "A_RAPPELER" }, MAINTENANT);
    assert.deepEqual(ids(aAppeler), [jamais.id, traite.id], "le plus récent en haut");
    assert.deepEqual(ids(aRappeler), [hier.id, plusTard.id, demain.id, sansDateAncien.id, sansDate.id]);
    assert.deepEqual(aRappeler.lignes.map((l) => l.enRetard), [true, false, false, false, false], "seul le rappel d'hier est en retard");
    assert.deepEqual(aRappeler.lignes.map((l) => l.tentatives), [1, 0, 0, 0, 2]);
    assert.ok(aAppeler.lignes.every((l) => l.aAppeler && l.attendDepuis) && aRappeler.lignes.every((l) => !l.aAppeler && !l.attendDepuis));
    assert.equal(aRappeler.lignes[4].dernierAppelLe, "2026-09-28T09:00:00.000Z");
    for (const absent of [archive, perdu, avecDossier]) assert.ok(![...ids(aAppeler), ...ids(aRappeler)].includes(absent.id), absent.id);
    assert.ok(ids(await leads.listerLeads({ vue: "SANS_SUITE" }, MAINTENANT)).includes(perdu.id));
    assert.ok(ids(await leads.listerLeads({ vue: "ARCHIVES" }, MAINTENANT)).includes(archive.id));

    // Les compteurs : les deux listes, les retards seuls, et ce qui tombe plus tard aujourd'hui (heure de Paris).
    assert.deepEqual(aAppeler.compteurs, { aAppeler: 2, aRappeler: 5, enRetard: 1, aujourdhui: 1, sansSuite: 1, archives: 1, actifs: 7 });
    assert.equal(await leads.compterLeadsEnRetard(MAINTENANT), 1, "l'onglet Leads ne compte que les retards");
  });

  test("la puce de la date de rappel : « jeu. 1 oct. 18:00 », heure de Paris", async () => {
    const { jourSemaineHeure } = await import("@/lib/commun/format");
    assert.equal(jourSemaineHeure("2026-10-01T16:00:00.000Z"), "jeu. 1 oct. 18:00");
    assert.equal(jourSemaineHeure("2026-12-02T09:00:00.000Z"), "mer. 2 déc. 10:00", "l'hiver aussi");
  });

  test("pagination exacte sur « À rappeler » (deux par page)", async () => {
    const pages = await Promise.all([1, 2, 3].map((page) => leads.listerLeads({ vue: "A_RAPPELER", page, parPage: 2 }, MAINTENANT)));
    assert.deepEqual(pages.map(ids), [[hier.id, plusTard.id], [demain.id, sansDateAncien.id], [sansDate.id]]);
    assert.deepEqual(pages.map((p) => [p.total, p.page, p.parPage]), [[5, 1, 2], [5, 2, 2], [5, 3, 2]]);
  });

  test("l'onglet : /api/pilotage/compteurs rend seulement les retards", async () => {
    // La route lit l'heure réelle : on compare à la liste lue au même moment.
    const route = await import("@/app/api/pilotage/compteurs/route");
    const reponse = await route.GET();
    assert.equal(reponse.status, 200);
    const corps = (await reponse.json()) as Record<string, unknown>;
    const maintenant = new Date();
    const retards = (await leads.listerLeads({ vue: "A_RAPPELER", limite: 500 }, maintenant)).lignes.filter((l) => l.enRetard).length;
    assert.equal(corps.leadsEnRetard, retards);
    assert.equal(corps.leadsEnRetard, await leads.compterLeadsEnRetard(maintenant));
    assert.ok(!("leadsAAppeler" in corps), "l'ancienne clé n'existe plus");
  });

  test("ce qui m'attend (pilotage) : même règle — à appeler, rappel en retard ou pour aujourd'hui ; plus tard ; sans date à décider", async () => {
    const vue = await pilotage.pilotageCommercial(MAINTENANT);
    const affaire = (id: string) => vue.affaires.find((a) => a.genre === "CONTACT" && a.leadId === id);
    assert.deepEqual([jamais, traite, hier, plusTard, demain, sansDate].map((l) => affaire(l.id)?.groupe), ["RAPPELER", "RAPPELER", "RAPPELER", "RAPPELER", "PLUS_TARD", "DECIDER"]);
    assert.deepEqual([affaire(jamais.id)?.action, affaire(hier.id)?.action, affaire(plusTard.id)?.action], ["Appeler : nouveau contact", "Rappeler : 1 appel sans réponse", "Rappeler (rappel prévu)"]);
    assert.deepEqual([affaire(hier.id)?.enRetard, affaire(plusTard.id)?.enRetard], [true, false]);
    // Les rappels de la journée : le retard d'abord.
    const rappeler = vue.affaires.filter((a) => a.groupe === "RAPPELER").map((a) => a.leadId);
    assert.equal(rappeler[0], hier.id);
  });

  test("l'outil « lister » LEADS A_APPELER (ex-« leads_a_appeler ») : la liste « À appeler » seule, sans prénom doublé", async () => {
    const resultat = await outils.outilLister.executer({ liste: "LEADS", vue: "A_APPELER", par_page: 50 }, { sessionId: "essai", commande: null, utilisateur: "essai", maintenant: new Date() });
    assert.match(resultat.texte, /Jamais Partie Trois/);
    assert.match(resultat.texte, /Traite Partie Trois/);
    assert.doesNotMatch(resultat.texte, /Jamais Jamais|Hier Partie Trois|SansDate Partie Trois/);
    assert.match(resultat.texte, /à rappeler \d+/);
    assert.deepEqual((resultat.donnees as { lignes: { id: string }[] }).lignes.map((d) => d.id).filter((id) => [jamais.id, traite.id, hier.id].includes(id)), [jamais.id, traite.id]);
  });

  test("/api/leads : « ACTIFS » (anciens liens, cache) vaut « À appeler » ; /api/leads/actions refuse TRAITER", async () => {
    const liste = await import("@/app/api/leads/route");
    const actifs = (await (await liste.GET(new NextRequest("http://localhost/api/leads?vue=ACTIFS&q=Trois"))).json()) as { lignes: { id: string }[] };
    const rappeler = (await (await liste.GET(new NextRequest("http://localhost/api/leads?vue=A_RAPPELER&q=Trois"))).json()) as { lignes: { id: string }[] };
    assert.ok(ids(actifs).includes(jamais.id) && !ids(actifs).includes(hier.id));
    assert.ok(ids(rappeler).includes(hier.id) && !ids(rappeler).includes(jamais.id));

    const actions = await import("@/app/api/leads/actions/route");
    const requete = (corps: unknown) => new NextRequest("http://localhost/api/leads/actions", { method: "POST", body: JSON.stringify(corps), headers: { "content-type": "application/json" } });
    for (const action of ["TRAITER", "REPRENDRE"]) {
      const reponse = await actions.POST(requete({ action, ids: [jamais.id] }));
      assert.equal(reponse.status, 400, action);
    }
    assert.equal((await leadDe(jamais.id)).traiteLe, null, "rien n'a été écrit");
    // L'archivage, lui, marche toujours.
    assert.equal((await actions.POST(requete({ action: "ARCHIVER", ids: [jamais.id], motif: "TEST" }))).status, 200);
    await actions.POST(requete({ action: "RESTAURER", ids: [jamais.id] }));
    assert.equal((await leadDe(jamais.id)).archiveLe, null);
  });

  test("les rappels de l'assistant (manager_operations, point_du_jour) : ceux de l'onglet, en retard dès l'heure passée", async () => {
    const nos = [hier.id, plusTard.id, demain.id, avecDossier.id];
    const rappels = (await leads.rappelsDesLeads(MAINTENANT)).filter((r) => nos.includes(r.leadId));
    assert.deepEqual(rappels.map((r) => [r.leadId, r.enRetard]), [[hier.id, true], [plusTard.id, false], [demain.id, false]], "le lead avec dossier n'y est pas : son rappel vit sur le dossier");
    const { aHeureParis } = await import("@/lib/commercial/quand");
    const ceSoir = (await leads.rappelsDesLeads(MAINTENANT, aHeureParis(MAINTENANT, 1, 0))).map((r) => r.leadId).filter((id) => nos.includes(id));
    assert.deepEqual(ceSoir, [hier.id, plusTard.id]);

    const operations = await import("@/lib/assistant/analyses/operations");
    const ops = await operations.analyseOperations(MAINTENANT);
    assert.deepEqual(ops.rappels.enRetard.map((r) => r.leadId).filter((id) => nos.includes(id)), [hier.id]);
    assert.deepEqual(ops.rappels.aVenir.map((r) => r.leadId).filter((id) => nos.includes(id)), [plusTard.id, demain.id]);
    const pointDuJour = await import("@/lib/assistant/outils/point-du-jour");
    const point = await pointDuJour.calculerPointDuJour(MAINTENANT, { depuis: null, memoriser: false });
    assert.deepEqual(point.aujourdhui.rappels.filter((r) => nos.includes(r.leadId)).map((r) => [r.leadId, r.enRetard]), [[hier.id, true], [plusTard.id, false]]);
  });

  test("lead du simulateur avec son dossier : « À appeler » seulement ; une note d'appel ou un rappel daté l'envoient vers son dossier", async () => {
    const simu = await lead("Simu", { source: "SITE_SIMULATEUR" });
    await dossierDe(simu.id);
    const simuDate = await lead("SimuDate", { source: "SITE_SIMULATEUR", rappelLe: le("2026-09-29T16:00:00Z") });
    await dossierDe(simuDate.id);
    const dans = async (id: string) => [
      ids(await leads.listerLeads({ vue: "A_APPELER", recherche: "Simu" }, MAINTENANT)).includes(id),
      ids(await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Simu" }, MAINTENANT)).includes(id),
    ];
    assert.deepEqual(await dans(simu.id), [true, false]);
    assert.deepEqual(await dans(simuDate.id), [false, false], "un rappel daté sur le lead ne l'envoie pas dans « À rappeler » : il a son dossier");
    assert.equal(await leads.compterLeadsEnRetard(MAINTENANT), 1, "ni dans les retards de l'onglet");
    await notes.creerNoteAppel(simu.id, { texte: "Veut un rendu en chêne" });
    assert.deepEqual(await dans(simu.id), [false, false], "la note d'appel le fait sortir vers son dossier");
    assert.equal((await leads.chargerLigneLead(simu.id, MAINTENANT))?.aAppeler, false);
  });
});

describe("le suivi des appels", () => {
  test("noterAppel : pas de réponse ×2 → 2 tentatives, puis « À rappeler » → 0 ; dernier appel posé ; « traité » n'est plus écrit", async () => {
    const l = await lead("Tentatives", { traiteLe: le("2026-09-21T10:00:00Z") });
    const avant = Date.now();
    await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" });
    await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" });
    let apres = await leadDe(l.id);
    assert.equal(apres.tentatives, 2);
    assert.ok(apres.dernierAppelLe && apres.dernierAppelLe.getTime() >= avant);
    assert.ok(apres.rappelLe, "un rappel est posé");
    await appels.noterAppel({ leadId: l.id, issue: "A_RAPPELER", note: "", rappelLe: "2026-10-02T16:00:00.000Z" });
    apres = await leadDe(l.id);
    assert.deepEqual([apres.tentatives, apres.rappelLe?.toISOString(), apres.traiteLe?.toISOString()], [0, "2026-10-02T16:00:00.000Z", "2026-09-21T10:00:00.000Z"]);
    const ligne = (await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Tentatives" }, MAINTENANT)).lignes[0];
    assert.deepEqual([ligne?.id, ligne?.tentatives], [l.id, 0]);
  });

  test("appel noté sur le dossier : le lead du dossier le retient aussi", async () => {
    const l = await lead("ParDossier");
    const dossier = await dossierDe(l.id);
    await appels.noterAppel({ dossierId: dossier.id, issue: "PAS_DE_REPONSE", note: "" });
    const apres = await leadDe(l.id);
    assert.equal(apres.tentatives, 1);
    assert.ok(apres.dernierAppelLe);
  });

  test("« Noter un échange » de type appel : dernier appel posé, tentatives à zéro ; une note ne change rien", async () => {
    const l = await lead("Echange");
    await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" });
    assert.equal((await leadDe(l.id)).tentatives, 1);
    await entrants.ajouterEchange(l.id, { type: "NOTE", contenu: "À rappeler après 18 h" });
    assert.equal((await leadDe(l.id)).tentatives, 1);
    const avant = Date.now();
    await entrants.ajouterEchange(l.id, { type: "APPEL", contenu: "Rappelé, il réfléchit" });
    const apres = await leadDe(l.id);
    assert.equal(apres.tentatives, 0);
    assert.ok(apres.dernierAppelLe && apres.dernierAppelLe.getTime() >= avant);
    // Effacer la date d'un lead déjà appelé : il reste dans « À rappeler », « Sans date ».
    await entrants.modifierEntrant(l.id, { rappelLe: null });
    const ligne = (await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Echange" }, MAINTENANT)).lignes[0];
    assert.deepEqual([ligne?.id, ligne?.rappelLe], [l.id, null]);
    const fiche = await entrants.chargerEntrant(l.id, MAINTENANT);
    assert.deepEqual([fiche.tentatives, fiche.rappelEnRetard, Boolean(fiche.dernierAppelLe)], [0, false, true]);
    // Un échange d'appel qui dit « messagerie » : une tentative, comme la migration le lirait.
    await entrants.ajouterEchange(l.id, { type: "APPEL", contenu: "Tombé sur la messagerie" });
    assert.equal((await leadDe(l.id)).tentatives, 1);
  });

  test("une note d'appel seule (sans issue) compte comme un appel : « À rappeler », tentatives inchangées ; une note vide ne compte pas", async () => {
    const l = await lead("NoteSeule");
    await notes.creerNoteAppel(l.id, {});
    assert.equal((await leadDe(l.id)).dernierAppelLe, null, "une note vide n'est pas un appel");
    const note = await notes.creerNoteAppel(l.id, { appelLe: "2026-09-25T15:00:00.000Z", texte: "Rappeler lundi" });
    let relu = await leadDe(l.id);
    assert.deepEqual([relu.dernierAppelLe?.toISOString(), relu.tentatives], ["2026-09-25T15:00:00.000Z", 0]);
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_RAPPELER", recherche: "NoteSeule" }, MAINTENANT)), [l.id]);
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_APPELER", recherche: "NoteSeule" }, MAINTENANT)), []);
    // Le dernier appel ne recule jamais : une fin d'appel plus récente, puis la note retouchée.
    await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" });
    const apresAppel = (await leadDe(l.id)).dernierAppelLe?.toISOString();
    await notes.modifierNoteAppel(l.id, note.id, { texte: "Rappeler lundi, après 18 h" });
    relu = await leadDe(l.id);
    assert.deepEqual([relu.dernierAppelLe?.toISOString(), relu.tentatives], [apresAppel, 1], "la note ne touche pas aux tentatives");
  });

  test("l'issue connue décide des tentatives, le texte seulement sans issue (en direct comme dans la migration)", async () => {
    const l = await lead("IssueConnue");
    await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" });
    await appels.noterAppel({ leadId: l.id, issue: "INTERESSE", note: "tombé sur la messagerie hier, rappelé ce matin" });
    assert.equal((await leadDe(l.id)).tentatives, 0);
  });

  test("fusion d'un doublon : l'ancien reprend le dernier appel et les tentatives du nouveau (il quitte « À appeler »)", async () => {
    const ancien = await lead("Ancien", { nom: "Doublon Essai" });
    const nouveau = await lead("Ancien", { nom: "Doublon Essai", doublonDe: ancien.id, doublonMotif: "Même nom et même ville" });
    await appels.noterAppel({ leadId: nouveau.id, issue: "PAS_DE_REPONSE", note: "" });
    await appels.noterAppel({ leadId: nouveau.id, issue: "PAS_DE_REPONSE", note: "" });
    const dernierDuNouveau = (await leadDe(nouveau.id)).dernierAppelLe!;
    await doublons.fusionnerDoublon(nouveau.id);
    const relu = await leadDe(ancien.id);
    assert.equal(relu.tentatives, 2);
    assert.ok(relu.dernierAppelLe && relu.dernierAppelLe.getTime() >= dernierDuNouveau.getTime());
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Doublon Essai" }, MAINTENANT)), [ancien.id]);
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_APPELER", recherche: "Doublon Essai" }, MAINTENANT)), []);
  });
});

describe("migration appels-des-leads-14-3", () => {
  test("les tentatives en fin d'historique", () => {
    const appel = (texte: string, quand: string) => ({ le: le(quand), texte, issue: lecture.issueDuContenu(texte) });
    assert.equal(lecture.tentativesALaFin([]), 0);
    assert.equal(lecture.tentativesALaFin([appel("Appel — Pas de réponse", "2026-09-02T10:00:00Z"), appel("Appel — Intéressé", "2026-09-01T10:00:00Z"), appel("Appel — Pas de réponse", "2026-09-03T10:00:00Z")]), 2);
    assert.equal(lecture.tentativesALaFin([appel("Appel — Pas de réponse", "2026-09-01T10:00:00Z"), appel("Appel — Intéressé", "2026-09-02T10:00:00Z")]), 0);
    // L'issue connue décide seule, comme la fin d'appel en direct ; le texte ne se lit que sans issue.
    assert.equal(lecture.tentativesALaFin([appel("Appel — Pas de réponse", "2026-09-10T10:00:00Z"), appel("Appel — Intéressé : tombé sur la messagerie hier, rappelé ce matin", "2026-09-12T10:00:00Z")]), 0);
    assert.equal(lecture.tentativesALaFin([appel("Appel — À rappeler : occupée, rappeler après 18 h", "2026-09-12T10:00:00Z")]), 0);
    assert.equal(lecture.tentativesALaFin([appel("Tombé sur la messagerie", "2026-09-12T10:00:00Z")]), 1, "échange saisi à la main, sans issue : le texte compte");
    assert.equal(lecture.appelSansReponse({ issue: "PAS_DE_REPONSE" }), true);
    assert.equal(lecture.appelSansReponse({ issue: "INTERESSE", texte: "messagerie" }), false);
    assert.equal(lecture.issueDesMetadonnees('{"issue":"PAS_DE_REPONSE"}'), "PAS_DE_REPONSE");
    assert.equal(lecture.issueDesMetadonnees("illisible"), null);
  });

  test("dernier appel et tentatives d'après l'historique (échanges, notes d'appel, événements des dossiers) ; rejouable", async () => {
    const appel = (leadId: string, contenu: string, quand: string) => prisma.interaction.create({ data: { leadId, type: "APPEL", contenu, createdAt: le(quand) } });
    const a = await lead("Backfill");
    await appel(a.id, "Appel — Intéressé : cuisine en L", "2026-09-10T09:00:00Z");
    await appel(a.id, "Appel — Pas de réponse", "2026-09-12T09:00:00Z");
    await appel(a.id, "Appel — Pas de réponse", "2026-09-14T09:00:00Z");
    // Une note d'appel plus récente : le dernier appel, pas une tentative.
    const b = await lead("BackfillNote");
    await appel(b.id, "Appel — Pas de réponse", "2026-09-12T09:00:00Z");
    await prisma.noteAppel.create({ data: { leadId: b.id, appelLe: le("2026-09-15T09:00:00Z"), texte: "Rappeler vers 18 h" } });
    // Un appel noté sur son dossier (date réelle corrigée), sans réponse.
    const c = await lead("BackfillDossier");
    const dossier = await dossierDe(c.id);
    await prisma.dossierEvenement.create({ data: { dossierId: dossier.id, type: "APPEL", direction: "SORTANT", contenu: "Appel — Pas de réponse", metadata: JSON.stringify({ issue: "PAS_DE_REPONSE" }), survenuLe: le("2026-09-16T09:00:00Z") } });
    // Archivé : recalculé aussi (restauré plus tard, il retrouve son historique) ; un appel archivé ne compte pas.
    const d = await lead("BackfillArchive", { archiveLe: le("2026-09-20T10:00:00Z"), archiveMotif: "Autre" });
    await appel(d.id, "Appel — Pas de réponse", "2026-09-11T09:00:00Z");
    await prisma.interaction.create({ data: { leadId: d.id, type: "APPEL", contenu: "Appel — Pas de réponse", createdAt: le("2026-09-18T09:00:00Z"), archiveLe: le("2026-09-19T09:00:00Z") } });
    const jamais = await lead("BackfillJamais");
    // Une note d'appel vide n'est pas un appel (même règle qu'en direct).
    const vide = await lead("BackfillNoteVide");
    await prisma.noteAppel.create({ data: { leadId: vide.id, appelLe: le("2026-09-15T09:00:00Z") } });
    // Une note d'appel seule, notée en direct : la migration retrouve exactement la même chose (une seule règle).
    const direct = await lead("BackfillNoteDirecte");
    await notes.creerNoteAppel(direct.id, { appelLe: "2026-09-17T09:00:00.000Z", texte: "Rappeler lundi" });
    const lu = async (id: string) => {
      const x = await prisma.lead.findFirstOrThrow({ where: { id, archiveLe: undefined } });
      return [x.dernierAppelLe?.toISOString() ?? null, x.tentatives];
    };
    const enDirect = await lu(direct.id);
    const activiteAvant = (await leadDe(a.id)).updatedAt.toISOString();

    const premier = await avecActeur(MIGRATION, () => migration.migrationAppelsDesLeads14.executer(prisma));
    assert.ok(premier.modifies >= 4, JSON.stringify(premier));
    assert.deepEqual(await lu(a.id), ["2026-09-14T09:00:00.000Z", 2], "deux « Pas de réponse » après un « Intéressé »");
    assert.equal((await leadDe(a.id)).updatedAt.toISOString(), activiteAvant, "le rattrapage n'est pas une activité du contact (RGPD, ordre des entrants)");
    assert.deepEqual(await lu(b.id), ["2026-09-15T09:00:00.000Z", 1]);
    assert.deepEqual(await lu(c.id), ["2026-09-16T09:00:00.000Z", 1]);
    assert.deepEqual(await lu(d.id), ["2026-09-11T09:00:00.000Z", 1]);
    assert.deepEqual(await lu(jamais.id), [null, 0]);
    assert.deepEqual(await lu(vide.id), [null, 0]);
    assert.deepEqual(await lu(direct.id), enDirect);
    assert.deepEqual(enDirect, ["2026-09-17T09:00:00.000Z", 0]);

    // Rejouée : rien ne bouge.
    const second = await avecActeur(MIGRATION, () => migration.migrationAppelsDesLeads14.executer(prisma));
    assert.equal(second.modifies, 0, JSON.stringify(second));
    assert.equal(second.examines, second.inchanges);
    assert.deepEqual(await lu(a.id), ["2026-09-14T09:00:00.000Z", 2]);
  });

  test("la migration est inscrite après celle de la partie 2, sous son nom définitif", async () => {
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    assert.ok(noms.indexOf("appels-des-leads-14-3") > noms.indexOf("leads-a-rappeler-14-2") && noms.includes("leads-a-rappeler-14-2"), noms.join(", "));
  });
});
