import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 14 (29/09/2026), partie 2 — récupérer les leads perdus : « Un lead qui
 * ne décroche pas sort de la liste par « Traiter » et je le perds. » L'aide de
 * dates (`aHeureParis`), la lecture d'un appel (sans réponse, « rappeler »), et
 * la migration `leads-a-rappeler-14-2`. Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let quand: typeof import("@/lib/commercial/quand");
let lecture: typeof import("@/lib/commercial/sans-reponse");
let appels: typeof import("@/lib/commercial/appels");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-2");

const MIGRATION = { acteur: "MIGRATION:leads-a-rappeler-14-2", origine: "essai" };
const iso = (date: Date) => date.toISOString();

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  quand = await import("@/lib/commercial/quand");
  lecture = await import("@/lib/commercial/sans-reponse");
  appels = await import("@/lib/commercial/appels");
  migration = await import("@/lib/base/migrations/mission-14-partie-2");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("aHeureParis : « J+n à HH:MM », heure de Paris", () => {
  test("été, hiver, veille et nuit du changement d'heure, fin d'année", () => {
    const a = (maintenant: string, jours: number, heure: number, minute?: number) => iso(quand.aHeureParis(new Date(maintenant), jours, heure, minute));
    assert.equal(a("2026-09-29T12:00:00Z", 1, 18), "2026-09-30T16:00:00.000Z", "été : 18 h à Paris = 16 h UTC");
    assert.equal(a("2026-12-01T15:00:00Z", 1, 18), "2026-12-02T17:00:00.000Z", "hiver : 18 h à Paris = 17 h UTC");
    assert.equal(a("2026-10-24T15:00:00Z", 1, 18), "2026-10-25T17:00:00.000Z", "veille du passage à l'heure d'hiver : le 25/10 est déjà à UTC+1");
    assert.equal(a("2026-10-24T15:00:00Z", 1, 10), "2026-10-25T09:00:00.000Z");
    assert.equal(a("2026-10-24T22:30:00Z", 1, 18), "2026-10-26T17:00:00.000Z", "0 h 30 le 25/10 à Paris : demain = le 26 (la journée dure 25 h)");
    assert.equal(a("2027-03-27T15:00:00Z", 1, 10), "2027-03-28T08:00:00.000Z", "veille du passage à l'heure d'été");
    assert.equal(a("2026-09-29T22:30:00Z", 1, 18), "2026-10-01T16:00:00.000Z", "0 h 30 à Paris, encore la veille en UTC : demain = le 1er octobre");
    assert.equal(a("2026-09-29T06:00:00Z", 0, 9, 30), "2026-09-29T07:30:00.000Z", "aujourd'hui 9 h 30");
    assert.equal(a("2026-12-31T20:00:00Z", 1, 10), "2027-01-01T09:00:00.000Z", "passage d'année");
  });

  // Partie 4 : `demainDixHeures` a disparu (« à rappeler » n'a plus de défaut) ; le défaut de « pas de réponse » passe par elle.
  test("le rappel par défaut d'un appel sans réponse passe par elle (demain 18 h, été comme hiver)", async () => {
    for (const [maintenant, attendu] of [
      ["2026-09-21T15:00:00Z", "2026-09-22T16:00:00.000Z"],
      ["2026-12-01T15:00:00Z", "2026-12-02T17:00:00.000Z"],
    ]) {
      const lead = await prisma.lead.create({ data: { prenom: "Defaut", nom: "Essai", telephone: `+33612009${maintenant.slice(5, 7)}${maintenant.slice(8, 10)}`, ville: "Lattes", source: "META_ADS" } });
      const suite = await appels.noterAppel({ leadId: lead.id, issue: "PAS_DE_REPONSE", note: "" }, new Date(maintenant));
      assert.equal(suite.rappelLe, attendu);
      assert.equal(iso((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).rappelLe!), attendu);
    }
  });
});

describe("lire un appel noté", () => {
  test("sans réponse : issue, étiquette, ou texte (sans casse, accents tolérés)", () => {
    const { estSansReponse } = lecture;
    assert.equal(estSansReponse({ issue: "PAS_DE_REPONSE" }), true);
    assert.equal(estSansReponse({ issue: "INTERESSE", etiquettes: ["PAS_JOIGNABLE"] }), true, "l'étiquette « Pas joignable » suffit");
    for (const texte of ["Tombé sur la messagerie", "REPONDEUR", "occupé", "Il ne répond pas", "pas répondu", "injoignable ce matin", "Appel — Pas de réponse"]) {
      assert.equal(estSansReponse({ texte }), true, texte);
    }
    assert.equal(estSansReponse({ issue: "INTERESSE", texte: "Appel — Intéressé : cuisine en L" }), false);
    assert.equal(estSansReponse({ issue: "A_RAPPELER", etiquettes: ["PROJET_LOINTAIN"] }), false);
  });

  test("l'issue d'un échange « Appel — … » ; « rappeler » écrit vite", () => {
    assert.equal(lecture.issueDuContenu("Appel — Pas de réponse"), "PAS_DE_REPONSE");
    assert.equal(lecture.issueDuContenu("Appel — Pas intéressé : trop cher"), "PAS_INTERESSE");
    assert.equal(lecture.issueDuContenu("Appel — Intéressé"), "INTERESSE");
    assert.equal(lecture.issueDuContenu("Rappelé"), null, "saisi à la main");
    for (const texte of ["rappeler", "À rapeller à midi", "rapeler demain", "Rappeller lundi"]) assert.match(texte, lecture.MOTIF_RAPPELER);
    for (const texte of ["Rappelé hier", "rappel posé"]) assert.doesNotMatch(texte, lecture.MOTIF_RAPPELER);
  });

  test("le libellé d'issue mis en tête par la fin d'appel n'est pas une note", () => {
    const { sansLibelleIssue } = lecture;
    assert.equal(sansLibelleIssue("Appel — À rappeler"), "");
    assert.equal(sansLibelleIssue("Appel — À rappeler : rappeler après 18 h"), "rappeler après 18 h");
    assert.equal(sansLibelleIssue("Appel — Pas intéressé : trop cher"), "trop cher");
    assert.equal(sansLibelleIssue("À rappeler — projet au printemps"), "projet au printemps", "note de dossier écrite par la fin d'appel");
    assert.equal(sansLibelleIssue("Intéressé — cuisine en L"), "cuisine en L");
    assert.equal(sansLibelleIssue("À rapeller à midi"), "À rapeller à midi", "saisi à la main : tel quel");
    assert.equal(sansLibelleIssue("Appel — laissé un message, rappeler demain"), "Appel — laissé un message, rappeler demain");
  });
});

describe("migration leads-a-rappeler-14-2", () => {
  const le = (texte: string) => new Date(texte);
  let numero = 0;
  const lead = (prenom: string, donnees: Record<string, unknown> = {}) =>
    prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361200${String(++numero).padStart(4, "0")}`, ville: "Lattes", source: "META_ADS", createdAt: le("2026-09-02T08:00:00Z"), ...donnees } });
  const appel = (leadId: string, contenu: string, quand: string) => prisma.interaction.create({ data: { leadId, type: "APPEL", contenu, createdAt: le(quand) } });
  const dossier = (leadId: string, donnees: Record<string, unknown> = {}) =>
    prisma.dossier.create({ data: { leadId, clientNom: "Dossier Essai", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33612009999", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION", ...donnees } });
  const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
  const marques = () =>
    Promise.all([
      prisma.interaction.count({ where: { type: "NOTE", contenu: { startsWith: migration.MARQUE_REMIS } } }),
      prisma.dossierNote.count({ where: { contenu: { startsWith: migration.MARQUE_DOSSIER } } }),
    ]);

  test("remet les leads sortis sans réponse, restaure l'archivé qu'une note dit de rappeler, pose le rappel sur un dossier vivant, garde un rappel prévu plus loin ; rejouée, ne change plus rien", async () => {
    // Traité le 10/09, dernier appel « Pas de réponse » → remis.
    const aline = await lead("Aline", { traiteLe: le("2026-09-10T09:00:00Z") });
    await appel(aline.id, "Appel — Pas de réponse", "2026-09-09T16:00:00Z");
    // Archivé le 15/09 (« Autre »), une note d'appel « À rapeller à midi » → restauré.
    const basile = await lead("Basile", { archiveLe: le("2026-09-15T10:00:00Z"), archiveMotif: "Autre" });
    await prisma.noteAppel.create({ data: { leadId: basile.id, appelLe: le("2026-09-14T09:00:00Z"), texte: "À rapeller à midi" } });
    // Archivé « Test » → laissé.
    const celia = await lead("Celia", { archiveLe: le("2026-09-12T10:00:00Z"), archiveMotif: "Test" });
    await appel(celia.id, "Appel — Pas de réponse", "2026-09-11T10:00:00Z");
    // Traité le 20/08, avant la fenêtre → laissé.
    const damien = await lead("Damien", { traiteLe: le("2026-08-20T10:00:00Z") });
    await appel(damien.id, "Appel — Pas de réponse", "2026-08-19T10:00:00Z");
    // Traité, « Intéressé » après un « Pas de réponse » → laissé.
    const elsa = await lead("Elsa", { traiteLe: le("2026-09-12T10:00:00Z") });
    await appel(elsa.id, "Appel — Pas de réponse", "2026-09-05T10:00:00Z");
    await appel(elsa.id, "Appel — Intéressé", "2026-09-08T10:00:00Z");
    // Perdu → laissé (il a une destination).
    const fabien = await lead("Fabien", { traiteLe: le("2026-09-11T10:00:00Z"), statut: "PERDU", motifPerte: "PRIX" });
    await appel(fabien.id, "Appel — Pas de réponse", "2026-09-10T10:00:00Z");
    // Traité, dossier vivant sans prochaine action, dernier appel « Pas de réponse » noté sur le dossier → rappel sur le dossier.
    const gaelle = await lead("Gaelle", { traiteLe: le("2026-09-13T10:00:00Z") });
    const dossierGaelle = await dossier(gaelle.id);
    await prisma.dossierEvenement.create({ data: { dossierId: dossierGaelle.id, type: "APPEL", direction: "SORTANT", contenu: "Appel — Pas de réponse", metadata: JSON.stringify({ issue: "PAS_DE_REPONSE" }), survenuLe: le("2026-09-12T10:00:00Z") } });
    // Même chose, mais le dossier attend autre chose → rien ne bouge (compté à part).
    const hugo = await lead("Hugo", { traiteLe: le("2026-09-13T10:00:00Z") });
    const dossierHugo = await dossier(hugo.id, { prochaineAction: "Attendre les photos du client" });
    await prisma.dossierEvenement.create({ data: { dossierId: dossierHugo.id, type: "APPEL", direction: "SORTANT", contenu: "Appel — Pas de réponse", metadata: JSON.stringify({ issue: "PAS_DE_REPONSE" }) } });
    // « Rappeler » écrit par le client dans son formulaire (recopié dans la note de réception) : ce n'est pas une note de Lucas.
    const ines = await lead("Ines", { traiteLe: le("2026-09-14T10:00:00Z"), message: "Merci de me rappeler le soir" });
    await prisma.interaction.create({ data: { leadId: ines.id, type: "NOTE", contenu: "Lead reçu via webhook (SITE_DEVIS) — Message : Merci de me rappeler le soir", createdAt: le("2026-09-02T08:00:00Z") } });
    // À la corbeille (supprimé par Lucas) → laissé.
    const jules = await lead("Jules", { archiveLe: le("2026-09-20T10:00:00Z"), archiveMotif: "Corbeille (effacement le 20/10/2026) : faux numéro" });
    await appel(jules.id, "Appel — Pas de réponse", "2026-09-19T10:00:00Z");
    // Doublon signalé puis écarté (« ce n'est pas la même personne ») : ce n'est pas un doublon → remis.
    const karine = await lead("Karine", { traiteLe: le("2026-09-16T10:00:00Z"), doublonDe: aline.id, doublonTraiteLe: le("2026-09-15T10:00:00Z"), doublonMotif: "Même nom, même ville — écarté : ce n'est pas la même personne" });
    await appel(karine.id, "Appel — Pas de réponse", "2026-09-14T10:00:00Z");
    // Doublon signalé, pas encore tranché → laissé.
    const louis = await lead("Louis", { traiteLe: le("2026-09-16T10:00:00Z"), doublonDe: aline.id, doublonMotif: "Même nom, même ville" });
    await appel(louis.id, "Appel — Pas de réponse", "2026-09-14T10:00:00Z");
    // Contact d'essai archivé par le CRM (le motif dit « essai », pas « test ») → laissé archivé.
    const manon = await lead("Manon", { archiveLe: le("2026-09-21T10:00:00Z"), archiveMotif: "Contact d'essai Zapier (20-21/09/2026), archivé après vérification" });
    await appel(manon.id, "Appel — Pas de réponse", "2026-09-20T10:00:00Z");
    // Dossier encaissé encore ouvert (statut Terminé) : aucune liste de leads ne le montrerait → rien n'est écrit.
    const nadia = await lead("Nadia", { traiteLe: le("2026-09-17T10:00:00Z"), statut: "TERMINE" });
    await dossier(nadia.id, { etape: "ENCAISSE" });
    await appel(nadia.id, "Appel — Pas de réponse", "2026-09-16T10:00:00Z");
    // Statut d'après devis sans dossier (ancien CRM), note « rappeler » → hors des listes, rien n'est écrit.
    const olivier = await lead("Olivier", { traiteLe: le("2026-09-17T10:00:00Z"), statut: "DEVIS_ENVOYE" });
    await prisma.noteAppel.create({ data: { leadId: olivier.id, appelLe: le("2026-09-16T09:00:00Z"), texte: "Rappeler après le devis" } });
    // Un rappel toujours plus loin que la date de référence, même quand le test tourne plus tard.
    const lointain = new Date(Date.now() + 400 * 86_400_000);
    // Dernier appel « À rappeler », rappel choisi plus loin par Lucas, puis traité → remis avec SA date.
    const pauline = await lead("Pauline", { traiteLe: le("2026-09-14T10:00:00Z"), rappelLe: lointain });
    await appel(pauline.id, "Appel — À rappeler : projet au printemps", "2026-09-12T10:00:00Z");
    // « À rappeler » puis « Intéressé » : le libellé de l'ancien appel n'est pas une note → laissé (comme Elsa).
    const quentin = await lead("Quentin", { traiteLe: le("2026-09-06T10:00:00Z") });
    await appel(quentin.id, "Appel — À rappeler", "2026-09-03T10:00:00Z");
    await appel(quentin.id, "Appel — Intéressé", "2026-09-05T10:00:00Z");
    // Dossier vivant dont le rappel est déjà daté plus loin → rien ne bouge.
    const romain = await lead("Romain", { traiteLe: le("2026-09-18T10:00:00Z") });
    const dossierRomain = await dossier(romain.id, { prochaineAction: "Rappeler", prochaineActionDate: lointain });
    await prisma.dossierEvenement.create({ data: { dossierId: dossierRomain.id, type: "APPEL", direction: "SORTANT", contenu: "Appel — Pas de réponse", metadata: JSON.stringify({ issue: "PAS_DE_REPONSE" }), survenuLe: le("2026-09-17T10:00:00Z") } });

    const maintenant = le("2026-09-29T20:00:00Z"); // 22 h à Paris : le rappel est demain 30/09 à 18 h, 16 h UTC.
    const premier = await avecActeur(MIGRATION, () => migration.remettreARappeler(prisma, maintenant));
    assert.deepEqual(premier, { examines: 17, remis: 3, remisRappelGarde: 1, rappelsSurDossier: 1, dossiersRappelGarde: 1, dossiersAutreAction: 1, horsListes: 2, ecartes: 5, dejaRemis: 0, nonConcernes: 3 });

    const a = await leadDe(aline.id);
    assert.deepEqual([a.traiteLe, a.archiveLe, a.rappelLe?.toISOString()], [null, null, "2026-09-30T16:00:00.000Z"]);
    const noteAline = await prisma.interaction.findFirstOrThrow({ where: { leadId: aline.id, type: "NOTE" } });
    assert.equal(noteAline.contenu, "Remis dans « À rappeler » (mission 14) : dernier appel sans réponse. Rappel le 30 septembre 2026 à 18 h.");

    const b = await leadDe(basile.id);
    assert.deepEqual([b.traiteLe, b.archiveLe, b.archiveMotif, b.rappelLe?.toISOString()], [null, null, null, "2026-09-30T16:00:00.000Z"]);
    const noteBasile = await prisma.interaction.findFirstOrThrow({ where: { leadId: basile.id, type: "NOTE" } });
    assert.equal(noteBasile.contenu, "Remis dans « À rappeler » (mission 14) : note « À rapeller à midi ». Rappel le 30 septembre 2026 à 18 h.");

    assert.deepEqual([(await leadDe(celia.id)).archiveMotif, Boolean((await leadDe(celia.id)).archiveLe)], ["Test", true]);
    assert.equal((await leadDe(damien.id)).traiteLe?.toISOString(), "2026-08-20T10:00:00.000Z");
    assert.equal((await leadDe(elsa.id)).traiteLe?.toISOString(), "2026-09-12T10:00:00.000Z");
    assert.deepEqual([(await leadDe(fabien.id)).statut, (await leadDe(fabien.id)).rappelLe], ["PERDU", null]);
    assert.ok((await leadDe(ines.id)).traiteLe, "la demande du client n'est pas une note de rappel");
    assert.ok((await leadDe(jules.id)).archiveLe, "la corbeille reste la corbeille");
    const k = await leadDe(karine.id);
    assert.deepEqual([k.traiteLe, k.rappelLe?.toISOString()], [null, "2026-09-30T16:00:00.000Z"], "un doublon écarté n'est pas un doublon");
    assert.ok((await leadDe(louis.id)).traiteLe, "un doublon en attente reste où il est");
    const m = await leadDe(manon.id);
    assert.deepEqual([Boolean(m.archiveLe), m.archiveMotif?.startsWith("Contact d'essai"), m.rappelLe], [true, true, null], "un contact d'essai reste archivé");
    for (const id of [nadia.id, olivier.id]) {
      const l = await leadDe(id);
      assert.deepEqual([Boolean(l.traiteLe), l.rappelLe, await prisma.interaction.count({ where: { leadId: id, type: "NOTE" } })], [true, null, 0], "hors des listes : rien n'est écrit");
    }
    const p = await leadDe(pauline.id);
    assert.deepEqual([p.traiteLe, p.rappelLe?.toISOString()], [null, lointain.toISOString()], "le rappel choisi plus loin est gardé");
    const notePauline = await prisma.interaction.findFirstOrThrow({ where: { leadId: pauline.id, type: "NOTE" } });
    assert.match(notePauline.contenu, /^Remis dans « À rappeler » \(mission 14\) : dernier appel « À rappeler »\. Rappel déjà prévu le .+ : gardé\.$/);
    assert.ok((await leadDe(quentin.id)).traiteLe, "« À rappeler » suivi d'un appel abouti : laissé");
    assert.equal(await prisma.interaction.count({ where: { leadId: quentin.id, type: "NOTE" } }), 0);
    const r = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierRomain.id } });
    assert.deepEqual([r.prochaineAction, r.prochaineActionDate?.toISOString()], ["Rappeler", lointain.toISOString()], "le rappel du dossier daté plus loin est gardé");
    assert.equal(await prisma.dossierNote.count({ where: { dossierId: dossierRomain.id } }), 0);

    // Avec un dossier vivant : le lead reste traité, le dossier prend « Rappeler » demain 18 h et une note.
    assert.ok((await leadDe(gaelle.id)).traiteLe);
    const g = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierGaelle.id } });
    assert.deepEqual([g.prochaineAction, g.prochaineActionDate?.toISOString()], ["Rappeler", "2026-09-30T16:00:00.000Z"]);
    const noteDossier = await prisma.dossierNote.findFirstOrThrow({ where: { dossierId: dossierGaelle.id } });
    assert.equal(noteDossier.contenu, "Rappel posé (mission 14) : dernier appel sans réponse. Rappel le 30 septembre 2026 à 18 h.", "le lead ne change pas de liste : la note dit ce qui a été fait");
    const h = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierHugo.id } });
    assert.deepEqual([h.prochaineAction, h.prochaineActionDate], ["Attendre les photos du client", null]);
    assert.deepEqual(await marques(), [4, 1]);

    // Rejouée (le lendemain) : plus rien ne change ; les leads remis ne sont plus candidats, le dossier est reconnu.
    const second = await avecActeur(MIGRATION, () => migration.remettreARappeler(prisma, le("2026-09-30T20:00:00Z")));
    assert.deepEqual([second.remis, second.remisRappelGarde, second.rappelsSurDossier], [0, 0, 0], JSON.stringify(second));
    assert.deepEqual(second, { examines: 13, remis: 0, remisRappelGarde: 0, rappelsSurDossier: 0, dossiersRappelGarde: 1, dossiersAutreAction: 1, horsListes: 2, ecartes: 5, dejaRemis: 1, nonConcernes: 3 });
    assert.deepEqual(await marques(), [4, 1], "aucune note de plus");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierGaelle.id } })).prochaineActionDate?.toISOString(), "2026-09-30T16:00:00.000Z", "le rappel posé n'est pas redaté");
    assert.equal((await leadDe(aline.id)).rappelLe?.toISOString(), "2026-09-30T16:00:00.000Z");

    // Par le lanceur (la date de référence est l'instant où elle s'exécute) : toujours rien.
    const troisieme = await avecActeur(MIGRATION, () => migration.migrationLeadsARappeler14.executer(prisma));
    assert.deepEqual([troisieme.remis, troisieme.remisRappelGarde, troisieme.rappelsSurDossier], [0, 0, 0], JSON.stringify(troisieme));
    assert.deepEqual(await marques(), [4, 1]);
  });

  test("la migration est inscrite après celle de la partie 1, sous son nom définitif", async () => {
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    assert.ok(noms.indexOf("leads-a-rappeler-14-2") > noms.indexOf("qui-a-la-main-14-1") && noms.includes("qui-a-la-main-14-1"), noms.join(", "));
  });
});
