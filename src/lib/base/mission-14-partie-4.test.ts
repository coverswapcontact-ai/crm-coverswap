import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p4-"));

/**
 * Mission 14 (29/09/2026), partie 4 — la fin d'appel : quatre issues et leur
 * suite (rappel de demain 18 h ou choisi, « à rappeler » daté ou sans date,
 * dossier et espace pour « intéressé », motif obligatoire pour « pas
 * intéressé »), la 3ᵉ tentative qui PROPOSE « sans suite », le SMS proposé
 * (A, D, B, lien de l'espace), le contexte de la feuille, le lead suivant et
 * l'outil `noter_appel`. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let appels: typeof import("@/lib/commercial/appels");
let quand: typeof import("@/lib/commercial/quand");
let leads: typeof import("@/lib/prospects/leads");
let copie: typeof import("@/lib/sms/copie");
let suivi: typeof import("@/lib/espace/suivi");
let ecriture: typeof import("@/lib/assistant/outils/ecriture");
let liens: typeof import("@/lib/espace/liens");
let NextRequest: typeof import("next/server").NextRequest;

/** Lundi 28 septembre 2026, 10 h à Paris (heure d'été). */
const LUNDI = new Date("2026-09-28T08:00:00.000Z");
/** Mardi 29 septembre, 18 h à Paris : « demain 18 h » vu de LUNDI. */
const DEMAIN_18 = "2026-09-29T16:00:00.000Z";
/** Jeudi 1er octobre, 10 h à Paris. */
const JEUDI_10 = "2026-10-01T08:00:00.000Z";
const LUCAS = { acteur: "HUMAIN:lucas@exemple.test" };
const LIEN = /^https:\/\/coverswap\.fr\/e\/[A-Za-z0-9_-]+$/;

let numero = 0;
const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom: "Quatre", telephone: `+3361404${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", ...donnees } });
const dossierDe = (leadId: string | null, nom = "Dossier Quatre", donnees: Record<string, unknown> = {}) =>
  prisma.dossier.create({ data: { leadId, clientNom: nom, clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33614049999", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION", ...donnees } });
const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const ids = (liste: { lignes: { id: string }[] }) => liste.lignes.map((l) => l.id);
const signaux = async (dossierId: string) => ((await suivi.listerEspaces()).find((l) => l.dossierId === dossierId)?.signaux ?? []).map((s) => s.code);
const CONTEXTE_OUTIL = { sessionId: "essai", commande: null, utilisateur: "essai", maintenant: LUNDI };

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.TACHES_DESACTIVEES = "1";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  appels = await import("@/lib/commercial/appels");
  quand = await import("@/lib/commercial/quand");
  leads = await import("@/lib/prospects/leads");
  copie = await import("@/lib/sms/copie");
  suivi = await import("@/lib/espace/suivi");
  ecriture = await import("@/lib/assistant/outils/ecriture");
  liens = await import("@/lib/espace/liens");
  NextRequest = (await import("next/server")).NextRequest;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("le rappel choisi sur la feuille, en heure de Paris", () => {
  test("raccourcis : ce soir (avant 18 h seulement), demain 10 h et 18 h, le prochain lundi ; été, hiver, dimanche, lundi soir", () => {
    const iso = (liste: { cle: string; le: Date }[]) => Object.fromEntries(liste.map((r) => [r.cle, r.le.toISOString()]));
    assert.deepEqual(iso(quand.raccourcisRappel(LUNDI)), { CE_SOIR: "2026-09-28T16:00:00.000Z", DEMAIN_10: "2026-09-29T08:00:00.000Z", DEMAIN_18: DEMAIN_18, LUNDI_10: "2026-10-05T08:00:00.000Z" });
    assert.deepEqual(quand.raccourcisRappel(LUNDI).map((r) => r.libelle), ["Ce soir 18 h", "Demain 10 h", "Demain 18 h", "Lundi 10 h"]);
    // Lundi 19 h à Paris : plus de « ce soir » ; le prochain lundi est dans une semaine.
    assert.deepEqual(iso(quand.raccourcisRappel(new Date("2026-09-28T17:00:00.000Z"))), { DEMAIN_10: "2026-09-29T08:00:00.000Z", DEMAIN_18: DEMAIN_18, LUNDI_10: "2026-10-05T08:00:00.000Z" });
    // Dimanche 29 novembre, 11 h à Paris (hiver) : lundi, c'est demain.
    assert.deepEqual(iso(quand.raccourcisRappel(new Date("2026-11-29T10:00:00.000Z"))), { CE_SOIR: "2026-11-29T17:00:00.000Z", DEMAIN_10: "2026-11-30T09:00:00.000Z", DEMAIN_18: "2026-11-30T17:00:00.000Z", LUNDI_10: "2026-11-30T09:00:00.000Z" });
  });

  test("le champ date et heure se lit et s'écrit à l'horloge de Paris ; le moment se dit « demain 18:00 »", () => {
    assert.equal(quand.versSaisieParis(new Date(DEMAIN_18)), "2026-09-29T18:00");
    assert.equal(quand.depuisSaisieParis("2026-09-29T18:00")?.toISOString(), DEMAIN_18);
    assert.equal(quand.depuisSaisieParis("2026-12-02T18:30")?.toISOString(), "2026-12-02T17:30:00.000Z", "hiver : UTC+1");
    assert.equal(quand.depuisSaisieParis(""), null);
    assert.equal(quand.versSaisieParis(null), "");
    assert.equal(quand.momentDuRappel(new Date(DEMAIN_18), LUNDI), "demain 18:00");
    assert.equal(quand.momentDuRappel(new Date(JEUDI_10), LUNDI, "à"), "jeudi à 10:00");
    assert.equal(quand.momentDuRappel(new Date("2026-09-28T16:00:00.000Z"), LUNDI), "aujourd'hui 18:00");
    assert.equal(quand.momentDuRappel(new Date("2026-10-12T08:30:00.000Z"), LUNDI, "à"), "le 12 octobre à 10:30");
  });
});

describe("pas de réponse", () => {
  test("1er appel (lead Meta) : rappel demain 18 h, « À rappeler », SMS A ; 2ᵉ : rappel choisi, SMS D ; 3ᵉ : « sans suite » proposé, jamais imposé", async () => {
    const l = await lead("Aline");
    const premier = await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);
    assert.deepEqual([premier.cible, premier.rappelLe, premier.tentatives, premier.proposerSansSuite], ["CONTACT", DEMAIN_18, 1, false]);
    assert.equal(premier.resume, "Appel noté. Rappel demain à 18:00.");
    assert.equal(premier.sms?.code, "PAS_DE_REPONSE");
    assert.equal(premier.sms?.texte, "Bonjour, j'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle demain vers 18 h, ou dites-moi le moment qui vous arrange.");
    assert.deepEqual([premier.sms?.leadId, premier.sms?.nom], [l.id, "Aline Quatre"]);
    let relu = await leadDe(l.id);
    assert.deepEqual([relu.rappelLe?.toISOString(), relu.statut, relu.tentatives], [DEMAIN_18, "NOUVEAU", 1]);
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Aline" }, LUNDI)), [l.id], "il reste actif, dans « À rappeler »");
    assert.deepEqual(ids(await leads.listerLeads({ vue: "A_APPELER", recherche: "Aline" }, LUNDI)), []);
    assert.equal((await prisma.interaction.findFirst({ where: { leadId: l.id, type: "APPEL" } }))?.contenu, "Appel — Pas de réponse");

    // Mercredi 9 h 30, choisi sur la feuille.
    const second = await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "", rappelLe: "2026-09-30T07:30:00.000Z" }, LUNDI);
    assert.deepEqual([second.rappelLe, second.tentatives, second.proposerSansSuite, second.sms?.code], ["2026-09-30T07:30:00.000Z", 2, false, "PAS_DE_REPONSE_2"]);
    assert.equal(second.resume, "Appel noté. Rappel mercredi à 09:30.");

    const troisieme = await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);
    assert.deepEqual([troisieme.tentatives, troisieme.proposerSansSuite, troisieme.sms?.code], [3, true, "PAS_DE_REPONSE_2"]);
    relu = await leadDe(l.id);
    assert.deepEqual([relu.statut, relu.motifPerte, relu.rappelLe?.toISOString()], ["NOUVEAU", null, DEMAIN_18], "proposé, pas imposé : il reste à rappeler");
  });

  test("lead du simulateur : SMS A « au sujet de votre simulation » ; sur un dossier : « Rappeler (pas de réponse) » à l'instant du rappel", async () => {
    const simu = await lead("Bastien", { source: "SITE_SIMULATEUR" });
    assert.equal((await appels.noterAppel({ leadId: simu.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI)).sms?.code, "PAS_DE_REPONSE_SIMULATION");

    const l = await lead("Camille");
    const dossier = await dossierDe(l.id);
    const suite = await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);
    assert.deepEqual([suite.cible, suite.dossierId, suite.tentatives], ["DOSSIER", dossier.id, 1]);
    const relu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.deepEqual([relu.prochaineAction, relu.prochaineActionDate?.toISOString()], ["Rappeler (pas de réponse)", DEMAIN_18]);
  });
});

describe("à rappeler", () => {
  test("daté (jeudi 10 h) : l'instant exact, SMS B « jeudi vers 10 h » ; sans date : rappel nul, en fin de liste, SMS « prochainement »", async () => {
    const date = await lead("Dora");
    const sansDate = await lead("Emile", { rappelLe: new Date(JEUDI_10) });
    const sansReponse = await lead("Fabien");
    const datee = await appels.noterAppel({ leadId: date.id, issue: "A_RAPPELER", note: "", rappelLe: JEUDI_10 }, LUNDI);
    assert.deepEqual([datee.rappelLe, datee.tentatives, datee.sms?.code], [JEUDI_10, 0, "A_RAPPELER"]);
    assert.equal(datee.resume, "Appel noté. Rappel jeudi à 10:00.");
    assert.equal(datee.sms?.texte, "Merci pour votre réponse ! C'est noté, je vous rappelle jeudi vers 10 h. À très vite !");
    await appels.noterAppel({ leadId: sansReponse.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);

    // Sans date : plus de défaut à demain 10 h — et un rappel daté d'avant est retiré (c'est le choix de Lucas).
    const sans = await appels.noterAppel({ leadId: sansDate.id, issue: "A_RAPPELER", note: "Rappellera lui-même" }, LUNDI);
    assert.equal(sans.rappelLe, null);
    assert.equal(sans.resume, "Appel noté. Sans date de rappel : il est dans À rappeler.");
    assert.equal(sans.sms?.texte, "Merci pour votre réponse ! C'est noté, je vous rappelle prochainement. À très vite !");
    assert.deepEqual([(await leadDe(sansDate.id)).rappelLe, (await leadDe(sansDate.id)).statut], [null, "CONTACTE"]);

    const ordre = ids(await leads.listerLeads({ vue: "A_RAPPELER", recherche: "Quatre" }, LUNDI)).filter((id) => [date.id, sansDate.id, sansReponse.id].includes(id));
    assert.deepEqual(ordre, [sansReponse.id, date.id, sansDate.id], "mardi 18 h, jeudi 10 h, puis sans date");
  });

  test("sur un dossier sans date : « Rappeler », sans date", async () => {
    const l = await lead("Gaelle");
    const dossier = await dossierDe(l.id);
    await prisma.dossier.update({ where: { id: dossier.id }, data: { prochaineAction: "Rappeler", prochaineActionDate: new Date(JEUDI_10) } });
    const suite = await appels.noterAppel({ dossierId: dossier.id, issue: "A_RAPPELER", note: "" }, LUNDI);
    assert.equal(suite.resume, "Appel noté. Sans date de rappel : « Rappeler » est la prochaine action de son dossier.");
    const relu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.deepEqual([relu.prochaineAction, relu.prochaineActionDate], ["Rappeler", null]);
  });
});

describe("intéressé", () => {
  test("dossier et espace ouverts, SMS LIEN_ESPACE avec le lien ; le rappel à venir passe sur le dossier ; copié, « Lien pas encore envoyé » tombe", async () => {
    const l = await lead("Helene", { rappelLe: new Date("2030-01-10T09:00:00.000Z"), dernierAppelLe: new Date("2026-09-20T09:00:00.000Z"), tentatives: 1 });
    const suite = await appels.noterAppel({ leadId: l.id, issue: "INTERESSE", note: "Cuisine en L, veut du chêne" }, LUNDI);
    assert.deepEqual([suite.cible, suite.tentatives, suite.proposerSansSuite, suite.rappelLe], ["DOSSIER", 0, false, null]);
    assert.equal(suite.resume, "Appel noté. Dossier et espace ouverts.");
    assert.ok(suite.dossierId);
    assert.ok(await prisma.espaceClient.findUnique({ where: { dossierId: suite.dossierId } }), "son espace est ouvert");
    assert.equal(suite.sms?.code, "LIEN_ESPACE");
    assert.match(suite.sms?.lien ?? "", LIEN);
    assert.equal(suite.sms?.texte, `Bonjour Helene, comme convenu, voici votre espace personnel pour votre projet : vous pouvez y déposer 2 ou 3 photos quand vous voulez. ${suite.sms?.lien}`);
    assert.equal(suite.sms?.dossierId, suite.dossierId);

    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: suite.dossierId } });
    assert.equal(dossier.prochaineAction, "Rappeler", "le rappel à venir n'est pas effacé : il vit sur le dossier");
    assert.ok(dossier.prochaineActionDate);
    assert.match((await prisma.dossierEvenement.findFirst({ where: { dossierId: suite.dossierId, type: "APPEL" } }))?.contenu ?? "", /^Appel — Intéressé : Cuisine en L/);
    const relu = await leadDe(l.id);
    assert.deepEqual([relu.statut, relu.tentatives, relu.rappelLe], ["CONTACTE", 0, null]);
    for (const vue of ["A_APPELER", "A_RAPPELER"] as const) assert.deepEqual(ids(await leads.listerLeads({ vue, recherche: "Helene" }, LUNDI)), [], `sorti de ${vue} (il a un dossier)`);

    assert.ok((await signaux(suite.dossierId)).includes("NON_ENVOYE"), "rien n'est parti tant qu'il n'est pas copié");
    await copie.noterSmsCopie({ code: suite.sms!.code, texte: suite.sms!.texte, leadId: l.id, dossierId: suite.dossierId, origine: "ECRAN" });
    assert.ok(!(await signaux(suite.dossierId)).includes("NON_ENVOYE"), "copié = envoyé");
  });

  test("lead du simulateur dont la simulation est dans le dossier : son dossier vivant est repris, variante LIEN_ESPACE_SIMULATION", async () => {
    const l = await lead("Ivan", { source: "SITE_SIMULATEUR" });
    const dossier = await dossierDe(l.id);
    await prisma.simulation.create({ data: { leadId: l.id, dossierId: dossier.id, source: "SITE_SIMULATEUR", imageAfterPath: "essai/rendu-quatre.png", rangeeLe: new Date() } });
    const suite = await appels.noterAppel({ leadId: l.id, issue: "INTERESSE", note: "" }, LUNDI);
    assert.equal(suite.dossierId, dossier.id);
    assert.equal(await prisma.dossier.count({ where: { leadId: l.id } }), 1, "aucun second dossier");
    assert.equal(suite.sms?.code, "LIEN_ESPACE_SIMULATION");
    assert.ok(suite.sms?.texte.endsWith(suite.sms.lien ?? "???"));
  });
});

describe("pas intéressé", () => {
  test("sans motif : refusé, le message cite tous les motifs, rien n'est écrit ; « autre » sans précision : refusé ; « délai » : sans suite", async () => {
    const l = await lead("Jeanne");
    await assert.rejects(appels.noterAppel({ leadId: l.id, issue: "PAS_INTERESSE", note: "" }, LUNDI), (erreur: Error) => {
      assert.match(erreur.message, /^Motif obligatoire pour classer sans suite : /);
      for (const motif of ["trop cher", "concurrent", "plus de réponse", "projet abandonné", "hors zone", "délai trop long", "autre (précisé)"]) assert.ok(erreur.message.includes(motif), motif);
      return true;
    });
    await assert.rejects(appels.noterAppel({ leadId: l.id, issue: "PAS_INTERESSE", note: "ok", motifPerte: "AUTRE" }, LUNDI), /Précise le motif « autre »/);
    const avant = await leadDe(l.id);
    assert.deepEqual([avant.statut, avant.dernierAppelLe, await prisma.interaction.count({ where: { leadId: l.id } })], ["NOUVEAU", null, 0], "rien n'a bougé");

    const suite = await appels.noterAppel({ leadId: l.id, issue: "PAS_INTERESSE", note: "Pas avant l'été prochain", motifPerte: "DELAI" }, LUNDI);
    assert.deepEqual([suite.sms, suite.resume], [null, "Appel noté. Classé sans suite : délai trop long."]);
    const relu = await leadDe(l.id);
    assert.deepEqual([relu.statut, relu.motifPerte, relu.perteCommentaire, relu.rappelLe, relu.perteLe?.toISOString()], ["PERDU", "DELAI", "Pas avant l'été prochain", null, LUNDI.toISOString()]);
    assert.deepEqual(ids(await leads.listerLeads({ vue: "SANS_SUITE", recherche: "Jeanne" }, LUNDI)), [l.id]);
  });

  test("« Classer sans suite — plus de réponse » à la 3ᵉ tentative ; sur un dossier : perdu avec le motif choisi ; la route refuse sans motif", async () => {
    const l = await lead("Kevin", { tentatives: 2, dernierAppelLe: new Date("2026-09-25T08:00:00.000Z") });
    assert.equal((await appels.contexteAppel({ leadId: l.id })).tentatives, 2, "la feuille propose le bouton");
    const suite = await appels.noterAppel({ leadId: l.id, issue: "PAS_INTERESSE", note: "", motifPerte: "SANS_REPONSE" }, LUNDI);
    assert.equal(suite.resume, "Appel noté. Classé sans suite : plus de réponse.");
    const relu = await leadDe(l.id);
    assert.deepEqual([relu.statut, relu.motifPerte, relu.tentatives], ["PERDU", "SANS_REPONSE", 0]);

    const m = await lead("Lina");
    const dossier = await dossierDe(m.id);
    await avecActeur(LUCAS, () => appels.noterAppel({ dossierId: dossier.id, issue: "PAS_INTERESSE", note: "", motifPerte: "PRIX" }, LUNDI));
    const perdu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.deepEqual([perdu.etape, perdu.motifPerte, perdu.perteCommentaire], ["PERDU", "PRIX", "Pas intéressé (dit au téléphone)"]);

    const route = await import("@/app/api/commercial/appels/route");
    const reponse = await route.POST(new NextRequest("http://localhost/api/commercial/appels", { method: "POST", body: JSON.stringify({ leadId: (await lead("Marc")).id, issue: "PAS_INTERESSE" }), headers: { "content-type": "application/json" } }));
    assert.equal(reponse.status, 400);
    assert.match(((await reponse.json()) as { error: string }).error, /délai trop long/);
  });
});

describe("dossier vivant, dossier clos, espace qui refuse", () => {
  test("intéressé, lien du client désactivé : l'appel est noté dans son nouveau dossier, le résumé dit que l'espace ne s'est pas ouvert ; réessayer le note encore", async () => {
    const ancien = await lead("Victor");
    const perdu = await dossierDe(ancien.id, "Victor Quatre", { clientTelephone: "+33614048801" });
    const { permanent } = await liens.ouvrirEspace(perdu.id);
    await liens.revoquerEspace(permanent.id);
    await prisma.dossier.update({ where: { id: perdu.id }, data: { etape: "PERDU" } });
    const clientId = (await prisma.dossier.findUniqueOrThrow({ where: { id: perdu.id } })).clientId;
    assert.ok(clientId);

    // Il revient : un nouveau lead de ce client, intéressé au téléphone.
    const retour = await lead("Victor", { clientId });
    const suite = await appels.noterAppel({ leadId: retour.id, issue: "INTERESSE", note: "Veut refaire sa salle de bain" }, LUNDI);
    assert.ok(suite.dossierId && suite.dossierId !== perdu.id, "un nouveau dossier, pas le projet perdu");
    assert.equal(suite.resume, "Appel noté. Dossier ouvert ; son espace ne s'est pas ouvert. Le lien de ce client est désactivé : le régénérer pour lui rouvrir son espace.");
    assert.equal(suite.sms, null, "pas de SMS avec un lien mort");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: suite.dossierId, type: "APPEL" } }), 1, "l'appel est noté");
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: suite.dossierId } }), 0);

    const encore = await appels.noterAppel({ leadId: retour.id, issue: "INTERESSE", note: "" }, LUNDI);
    assert.equal(encore.dossierId, suite.dossierId);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: suite.dossierId, type: "APPEL" } }), 2);
    assert.equal(await prisma.dossier.count({ where: { leadId: retour.id } }), 1, "aucun second dossier");
  });

  test("intéressé sur un dossier clos : avec un lead, son dossier vivant s'ouvre (le clos ne bouge pas) ; sans lead, noté sans espace ni SMS", async () => {
    const l = await lead("Wanda");
    const clos = await dossierDe(l.id, "Wanda Quatre", { etape: "PERDU", clientTelephone: "+33614048802" });
    const suite = await appels.noterAppel({ leadId: l.id, issue: "INTERESSE", note: "" }, LUNDI);
    assert.ok(suite.dossierId && suite.dossierId !== clos.id);
    assert.deepEqual([suite.resume, suite.sms?.code], ["Appel noté. Dossier et espace ouverts.", "LIEN_ESPACE"]);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: suite.dossierId } })).etape, "QUALIFICATION");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: clos.id } })).etape, "PERDU");
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: clos.id } }), 0, "aucun espace sur le projet perdu");
    // Depuis la fiche du dossier perdu : son dossier vivant est repris, pas un troisième.
    assert.equal((await appels.noterAppel({ dossierId: clos.id, issue: "INTERESSE", note: "" }, LUNDI)).dossierId, suite.dossierId);
    assert.equal(await prisma.dossier.count({ where: { leadId: l.id } }), 2);

    const seul = await dossierDe(null, "Xavier Sanslead", { etape: "ENCAISSE", clientTelephone: "+33614048803" });
    const sansLead = await appels.noterAppel({ dossierId: seul.id, issue: "INTERESSE", note: "Nouveau projet de cuisine" }, LUNDI);
    assert.deepEqual([sansLead.dossierId, sansLead.sms], [seul.id, null]);
    assert.equal(sansLead.resume, "Appel noté. Son dossier est encaissé : aucun espace ouvert sur un projet clos. Ouvre-lui un nouveau dossier pour ce projet.");
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: seul.id } }), 0);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: seul.id, type: "APPEL" } }), 1);
  });

  test("un lead est lu par son dossier vivant, pas par un dossier clos plus récent ; « pas intéressé » ne passe jamais un dossier encaissé en perdu", async () => {
    const l = await lead("Yanis");
    const vivant = await dossierDe(l.id, "Yanis Quatre", { createdAt: new Date("2026-01-01T09:00:00.000Z") });
    const encaisse = await dossierDe(l.id, "Yanis Quatre", { etape: "ENCAISSE", createdAt: new Date("2026-06-01T09:00:00.000Z") });
    assert.equal((await appels.noterAppel({ leadId: l.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI)).dossierId, vivant.id);
    assert.equal((await appels.contexteAppel({ leadId: l.id })).dossierId, vivant.id);

    const suite = await avecActeur(LUCAS, () => appels.noterAppel({ dossierId: encaisse.id, issue: "PAS_INTERESSE", note: "", motifPerte: "PRIX" }, LUNDI));
    assert.equal(suite.resume, "Appel noté. Son dossier est encaissé : il ne passe pas en perdu.");
    const relu = await prisma.dossier.findUniqueOrThrow({ where: { id: encaisse.id } });
    assert.deepEqual([relu.etape, relu.motifPerte], ["ENCAISSE", null]);
  });
});

describe("le contexte de la feuille et le lead suivant", () => {
  test("contexte : un lead (nom, source, tentatives, rappel), un dossier sans lead (tentatives lues dans ses appels) ; route", async () => {
    const l = await lead("Nadia", { tentatives: 2, dernierAppelLe: new Date("2026-09-25T08:00:00.000Z"), rappelLe: new Date(JEUDI_10) });
    const contexte = await appels.contexteAppel({ leadId: l.id });
    assert.deepEqual({ ...contexte, telephone: Boolean(contexte.telephone) }, { nom: "Nadia Quatre", telephone: true, tentatives: 2, source: "Publicité Meta", rappelLe: JEUDI_10, dossierId: null });

    const seul = await dossierDe(null, "Olivier Sanslead");
    await appels.noterAppel({ dossierId: seul.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);
    const second = await appels.noterAppel({ dossierId: seul.id, issue: "PAS_DE_REPONSE", note: "" }, LUNDI);
    assert.deepEqual([second.tentatives, second.sms?.code], [2, "PAS_DE_REPONSE_2"]);
    const route = await import("@/app/api/commercial/appels/contexte/route");
    const reponse = await route.GET(new NextRequest(`http://localhost/api/commercial/appels/contexte?dossierId=${seul.id}`));
    const { contexte: lu } = (await reponse.json()) as { contexte: Awaited<ReturnType<typeof appels.contexteAppel>> };
    assert.deepEqual([lu.nom, lu.tentatives, lu.source, lu.dossierId, lu.rappelLe], ["Olivier Sanslead", 2, null, seul.id, DEMAIN_18]);
  });

  test("lead suivant : les rappels en retard d'abord (le plus ancien), puis « À appeler » (le plus récent), jamais le lead courant ni un « à écarter »", async () => {
    const appele = new Date("2019-12-20T09:00:00.000Z");
    const r1 = await lead("Pauline", { rappelLe: new Date("2020-01-01T09:00:00.000Z"), dernierAppelLe: appele, ville: "Sète" });
    const r2 = await lead("Quentin", { rappelLe: new Date("2020-01-02T09:00:00.000Z"), dernierAppelLe: appele });
    const j1 = await lead("Romane", { createdAt: new Date("2030-01-01T09:00:00.000Z"), ville: "Non renseignée" });
    const j2 = await lead("Sacha", { createdAt: new Date("2030-01-02T09:00:00.000Z") });
    await lead("Tom", { createdAt: new Date("2030-01-03T09:00:00.000Z"), priorite: "A_ECARTER" });

    const premier = await leads.leadSuivant(null, LUNDI);
    assert.deepEqual({ ...premier, telephone: Boolean(premier?.telephone) }, { id: r1.id, nom: "Pauline Quatre", ville: "Sète", telephone: true, raison: "RETARD", dossierId: null });
    assert.equal((await leads.leadSuivant(r1.id, LUNDI))?.id, r2.id, "jamais celui qu'on vient d'appeler");

    // Les retards rappelés (reportés) : « À appeler », le plus récent d'abord, sans le « à écarter ».
    await prisma.lead.updateMany({ where: { id: { in: [r1.id, r2.id] } }, data: { rappelLe: new Date("2031-01-01T09:00:00.000Z") } });
    const jamais = await leads.leadSuivant(r1.id, LUNDI);
    assert.deepEqual([jamais?.id, jamais?.raison], [j2.id, "JAMAIS_APPELE"]);
    const ensuite = await leads.leadSuivant(j2.id, LUNDI);
    assert.deepEqual([ensuite?.id, ensuite?.ville], [j1.id, null]);

    const route = await import("@/app/api/leads/suivant/route");
    // La route lit l'heure réelle (les rappels de « demain 18 h » vus de LUNDI peuvent être passés) : même réponse que la fonction.
    const lu = (await (await route.GET(new NextRequest(`http://localhost/api/leads/suivant?apres=${j2.id}`))).json()) as { suivant: import("@/lib/prospects/leads").LeadSuivant | null };
    assert.ok(lu.suivant && lu.suivant.id !== j2.id);
    assert.deepEqual(lu.suivant, await leads.leadSuivant(j2.id));
  });
});

describe("outil noter_appel", () => {
  test("« pas intéressé » sans motif_perte : refusé avec les motifs ; la réponse donne le SMS proposé ; avec motif_perte : sans suite", async () => {
    const l = await lead("Ugo");
    const outil = ecriture.outilNoterAppel;
    type Entree = Parameters<typeof outil.executer>[0];
    await assert.rejects(outil.executer({ leadId: l.id, issue: "PAS_INTERESSE" } as Entree, CONTEXTE_OUTIL), /motif_perte.*DELAI \(délai trop long\).*AUTRE/);
    const resultat = (await outil.executer({ leadId: l.id, issue: "PAS_DE_REPONSE" } as Entree, CONTEXTE_OUTIL)) as { texte: string };
    assert.match(resultat.texte, /^Appel noté\. Rappel demain à 18:00\. \(Ugo Quatre\)/);
    assert.ok(resultat.texte.includes("SMS proposé (PAS_DE_REPONSE) : « Bonjour, j'ai essayé de vous joindre au sujet de votre projet de rénovation. Je vous rappelle demain vers 18 h"), resultat.texte);
    assert.ok(!resultat.texte.includes("envoyer_lien_espace"), "plus de mail proposé");
    await outil.executer({ leadId: l.id, issue: "PAS_INTERESSE", motif_perte: "HORS_ZONE" } as Entree, CONTEXTE_OUTIL);
    assert.deepEqual([(await leadDe(l.id)).statut, (await leadDe(l.id)).motifPerte], ["PERDU", "HORS_ZONE"]);

    // 4ᵉ appel sans réponse : le nombre réel, pas « 3ᵉ ».
    const insaisissable = await lead("Zoe", { tentatives: 3, dernierAppelLe: new Date("2026-09-25T08:00:00.000Z") });
    const quatrieme = (await outil.executer({ leadId: insaisissable.id, issue: "PAS_DE_REPONSE" } as Entree, CONTEXTE_OUTIL)) as { texte: string };
    assert.ok(quatrieme.texte.includes("\n4ᵉ appel sans réponse d'affilée : propose à Lucas de classer sans suite (motif « Plus de réponse »), sans l'imposer."), quatrieme.texte);
  });
});
