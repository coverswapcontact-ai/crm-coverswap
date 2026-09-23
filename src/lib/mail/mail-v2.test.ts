import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 9 : le mail piloté par l'assistant, côté lib, sur une copie de base.
 * Priorité par valeur (pur), règles apprises (pur + base), classement et
 * résumé, remise à plus tard, rangement réversible, recherche, cartes de mise
 * à jour (valider = code de la fiche ; ignorer = rien ; sensible), brouillon
 * déposé bloqué avec « [à compléter] », et AUCUN appel au modèle : l'IA du
 * CRM est en pause par défaut, quel que soit l'interrupteur d'usage.
 */
preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
for (const cle of ["META_PIXEL_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY", "NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "VAPID_PRIVATE_KEY", "RESEND_API_KEY"]) process.env[cle] = "";
// Une clé présente, exprès : la garde doit tenir par l'interrupteur, pas par l'absence de clé.
process.env.ANTHROPIC_API_KEY = "cle-factice-qui-ne-doit-jamais-servir";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";

let prisma: typeof import("@/lib/prisma").default;
let v2: typeof import("./v2");
let priorite: typeof import("./priorite");
let regles: typeof import("./regles-apprises");
let vues: typeof import("./vues");
let detail: typeof import("./detail");
let maj: typeof import("./propositions-maj");
let appliquer: typeof import("./appliquer");
let validation: typeof import("@/lib/validation/service");
let modele: typeof import("@/lib/ia/modele");
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let parametres: typeof import("@/lib/parametres/service");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const CLAUDE = { acteur: "ASSISTANT:claude" };
const appelsAnthropic: string[] = [];
let rang = 0;

async function mail(donnees: Record<string, unknown> = {}, texte?: string) {
  rang++;
  const m = await prisma.message.create({
    data: { canal: "EMAIL", compte: "coverswap.contact@gmail.com", identifiantCanal: `m9-${rang}`, filCanal: `fil-${rang}`, sens: "ENTRANT", de: `expediteur${rang}@exemple.fr`, deNom: `Expéditeur ${rang}`, objet: `Objet ${rang}`, extrait: `Extrait ${rang}`, recuLe: new Date(Date.now() - rang * 60_000), classe: "HUMAIN", classePar: "TRI", ...donnees },
  });
  if (texte) await prisma.contenuMessage.create({ data: { messageId: m.id, texte } });
  return m;
}

before(async () => {
  // Rien ne doit partir vers Anthropic : tout appel est compté (et échoue).
  const ancien = globalThis.fetch;
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (url.includes("anthropic.com")) {
      appelsAnthropic.push(url);
      throw new Error("appel interdit vers Anthropic");
    }
    return ancien(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  v2 = await import("./v2");
  priorite = await import("./priorite");
  regles = await import("./regles-apprises");
  vues = await import("./vues");
  detail = await import("./detail");
  maj = await import("./propositions-maj");
  appliquer = await import("./appliquer");
  validation = await import("@/lib/validation/service");
  modele = await import("@/lib/ia/modele");
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  parametres = await import("@/lib/parametres/service");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("pas d'IA côté serveur", () => {
  test("IA_CRM_ACTIVE absent = en pause : l'IA du CRM est inactive pour tous les usages, même avec une clé et les réglages posés", async () => {
    const jour = new Date("2026-01-01T00:00:00Z");
    for (const [cle, valeur] of [["IA_MODELE", "claude-sonnet-5"], ["IA_PRIX_ENTREE", 1.9], ["IA_PRIX_SORTIE", 9.5], ["IA_BUDGET_MENSUEL", 10], ["IA_REDACTION", "ACTIVE"], ["IA_AGENT_MAIL", "ACTIVE"]] as const) {
      await parametres.enregistrerParametre({ cle, valeur, valableDu: jour });
    }
    for (const interrupteur of ["IA_REDACTION", "IA_AGENT_MAIL"] as const) {
      const etat = await modele.etatIa(new Date(), interrupteur);
      assert.equal(etat.active, false, interrupteur);
      assert.match(etat.raison ?? "", /^via l'assistant Claude/);
    }
    await assert.rejects(modele.appelerModele({ usage: "ANALYSE_MESSAGE", systeme: "x", message: "y", outil: { nom: "o", description: "d", schema: { type: "object" } }, jetonsSortieMax: 10 }), (e: unknown) => e instanceof modele.IaIndisponible);
    const { redigerBrouillon } = await import("./redaction");
    await assert.rejects(redigerBrouillon({ messageId: null, clientId: null, leadId: null, dossierId: null, consigne: null }));
    assert.deepEqual(appelsAnthropic, []);
  });
});

describe("priorité par valeur (pur)", () => {
  test("ordre : revenu, réclamation, devis par montant, dossier, lead, échéance, reste", () => {
    const f = (x: Partial<import("./priorite").FaitsPriorite>): import("./priorite").FaitsPriorite => ({ revenu: false, reclamation: false, devisEnAttente: null, dossierActif: false, lead: false, administratifEcheance: false, ...x });
    assert.equal(priorite.prioriteDe(f({ revenu: true, reclamation: true })).rang, 0);
    assert.equal(priorite.prioriteDe(f({ reclamation: true, devisEnAttente: 5000 })).rang, 1);
    assert.deepEqual([priorite.prioriteDe(f({ devisEnAttente: 1200 })).rang, priorite.prioriteDe(f({ devisEnAttente: 1200 })).montant], [2, 1200]);
    assert.equal(priorite.prioriteDe(f({ dossierActif: true })).rang, 3);
    assert.equal(priorite.prioriteDe(f({ lead: true })).rang, 4);
    assert.equal(priorite.prioriteDe(f({ administratifEcheance: true })).rang, 5);
    assert.equal(priorite.prioriteDe(f({})).rang, 6);
    const lignes = [
      { priorite: priorite.prioriteDe(f({ devisEnAttente: 800 })), recuLe: "2026-09-22T10:00:00Z" },
      { priorite: priorite.prioriteDe(f({ reclamation: true })), recuLe: "2026-09-20T10:00:00Z" },
      { priorite: priorite.prioriteDe(f({ devisEnAttente: 3000 })), recuLe: "2026-09-19T10:00:00Z" },
      { priorite: priorite.prioriteDe(f({})), recuLe: "2026-09-23T10:00:00Z" },
    ];
    assert.deepEqual([...lignes].sort(priorite.comparerPriorite).map((l) => l.recuLe.slice(8, 10)), ["20", "19", "22", "23"]);
    assert.equal(priorite.estReclamation(["Devis cuisine", "Bonjour, le film se décolle sur deux portes", null]), true);
    assert.equal(priorite.estReclamation(["Devis cuisine", "Merci pour votre passage", null]), false);
  });

  test("règles apprises (pur) : au troisième geste identique, une seule règle, la plus répétée", () => {
    assert.equal(regles.regleAppelee({ adresse: "a@b.fr", ranges: 2, administratif: 0, humains: 0 }), null);
    assert.equal(regles.regleAppelee({ adresse: "a@b.fr", ranges: 3, administratif: 0, humains: 0 })?.action, "RANGER");
    assert.equal(regles.regleAppelee({ adresse: "a@b.fr", ranges: 3, administratif: 4, humains: 0 })?.action, "ADMINISTRATIF");
    assert.equal(regles.regleAppelee({ adresse: "a@b.fr", ranges: 0, administratif: 0, humains: 3 })?.action, "NE_JAMAIS_RANGER");
  });
});

describe("classement, résumé, snooze, rangement, recherche", () => {
  test("classer_mail écrit l'intention avec l'acteur ; la vue la montre et la priorité suit", async () => {
    const m = await mail({ objet: "Problème sur la porte", extrait: "le film se décolle" }, "Bonjour, le film se décolle sur la porte du haut. Pouvez-vous passer ?");
    await avecActeur(CLAUDE, () => v2.classerIntention([{ messageId: m.id, intention: "REPONSE", attendu: "Il demande un passage pour la porte", dates: [{ date: "2026-10-02", heure: "14:00", nature: "DISPONIBILITE", passage: "je suis là jeudi 2 à 14h" }] }]));
    const apres = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    assert.deepEqual([apres.intention, apres.intentionAttendu, apres.intentionPar], ["REPONSE", "Il demande un passage pour la porte", "ASSISTANT:claude"]);
    assert.equal(priorite.lireDatesExtraites(apres.datesExtraites).length, 1);
    const ligne = (await vues.conversations()).find((l) => l.messageId === m.id)!;
    assert.deepEqual([ligne.intention, ligne.attendu, ligne.priorite.rang, ligne.dates, ligne.aTraiter], ["REPONSE", "Il demande un passage pour la porte", 1, 1, true]);
    // Non classé : retiré.
    await avecActeur(LUCAS, () => v2.classerIntention([{ messageId: m.id, intention: null }]));
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).intention, null);
    assert.equal((await v2.mailsNonClasses()).some((x) => x.messageId === m.id), true);
  });

  test("resumer_fil : trois lignes au plus, points en suspens, périmé quand le fil grandit", async () => {
    const a = await mail({ filCanal: "fil-resume" }, "Premier message");
    await mail({ filCanal: "fil-resume" }, "Deuxième");
    await avecActeur(CLAUDE, () => v2.resumerFil(a.id, { resume: "l1\nl2\nl3\nl4", pointsEnSuspens: [{ texte: "Délai de pose non répondu", date: "2026-10-01" }] }));
    const r1 = await v2.resumeDuFil("EMAIL", "fil-resume", 2);
    assert.equal(r1?.resume, "l1\nl2\nl3");
    assert.equal(r1?.perime, false);
    assert.equal(r1?.pointsEnSuspens[0]?.texte, "Délai de pose non répondu");
    const r2 = await v2.resumeDuFil("EMAIL", "fil-resume", 3);
    assert.equal(r2?.perime, true);
    const d = await detail.detailMail(a.id);
    assert.equal(d.resume?.resume, "l1\nl2\nl3");
  });

  test("snoozer « lundi » = lundi 9 h Paris ; hors d'À traiter jusque-là, puis « Revenu » en tête", async () => {
    const { lireDateDictee } = await import("@/lib/assistant/agenda");
    const mardi = new Date("2026-09-22T08:00:00Z");
    const lundi = lireDateDictee("lundi", mardi, 9)!;
    assert.equal(lundi.toISOString(), "2026-09-28T07:00:00.000Z");
    assert.equal(lundi.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }), "09:00");
    assert.equal(lireDateDictee("dans une semaine", mardi, 9)!.toISOString(), "2026-09-29T07:00:00.000Z");
    const m = await mail({ objet: "Question sur le devis", classe: "CLIENT" }, "Bonjour, une question");
    assert.equal((await vues.conversations(new Date())).find((l) => l.messageId === m.id)?.aTraiter, true);
    const dansUneHeure = new Date(Date.now() + 3_600_000);
    await avecActeur(CLAUDE, () => v2.snoozer(m.id, dansUneHeure));
    const cache = (await vues.conversations(new Date())).find((l) => l.messageId === m.id)!;
    assert.deepEqual([cache.aTraiter, cache.revenu, cache.snoozeJusqua], [false, false, dansUneHeure.toISOString()]);
    const revenu = (await vues.conversations(new Date(dansUneHeure.getTime() + 60_000))).find((l) => l.messageId === m.id)!;
    assert.deepEqual([revenu.aTraiter, revenu.revenu, revenu.mention, revenu.priorite.rang], [true, true, "Revenu", 0]);
    assert.equal(vues.filtrerVue(await vues.conversations(new Date(dansUneHeure.getTime() + 60_000)), "A_TRAITER")[0]?.messageId, m.id, "en tête");
    await v2.annulerSnooze(m.id);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).snoozeJusqua, null);
  });

  test("ranger_mail : lu + rangé, réversible sans règle ; trois rangements de la même adresse → règle proposée, jamais posée seule", async () => {
    const de = "pub@tiktok-mails.com";
    const a = await mail({ de, filCanal: "tk-1" });
    const b = await mail({ de, filCanal: "tk-2" });
    const c = await mail({ de, filCanal: "tk-3" });
    const r = await avecActeur(CLAUDE, () => v2.rangerMail(a.id, "test"));
    assert.deepEqual([r.ranges, r.adresse], [1, de]);
    const apresA = await prisma.message.findUniqueOrThrow({ where: { id: a.id } });
    assert.deepEqual([Boolean(apresA.rangeLe), apresA.rangePar, apresA.lu], [true, "ASSISTANT", true]);
    await v2.derangerMail(a.id);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: a.id } })).rangeLe, null);
    assert.equal(await prisma.regleExpediteur.count({ where: { cible: de } }), 0, "aucune règle posée par un rangement");
    await avecActeur(LUCAS, () => v2.rangerMail(a.id));
    await avecActeur(LUCAS, () => v2.rangerMail(b.id));
    assert.equal(await prisma.proposition.count({ where: { type: maj.TYPE_REGLE_TRI, cleUnicite: `regle-tri:${de}:RANGER` } }), 0, "deux gestes : rien");
    await avecActeur(LUCAS, () => v2.rangerMail(c.id));
    const proposee = await prisma.proposition.findFirst({ where: { type: maj.TYPE_REGLE_TRI, cleUnicite: `regle-tri:${de}:RANGER` } });
    assert.equal(proposee?.statut, "EN_ATTENTE", "trois gestes : règle proposée");
    assert.equal(await prisma.regleExpediteur.count({ where: { cible: de } }), 0, "toujours pas posée");
    // Validée (par Lucas ou Claude) : posée par le code existant.
    await avecActeur(LUCAS, () => appliquer.appliquerProposition(proposee!.id));
    assert.equal((await prisma.regleExpediteur.findFirst({ where: { cible: de, archiveLe: null } }))?.action, "RANGER");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: proposee!.id } })).statut, "EXECUTEE");
  });

  test("rechercher_mails : chaque mot, dans le corps ou le contact ; passage rendu", async () => {
    const client = await prisma.client.create({ data: { nom: "Marbrier Test", source: "INCONNUE", premierContactLe: new Date() } });
    const m = await mail({ objet: "Cuisine", clientId: client.id, classe: "CLIENT" }, "Bonjour, je voudrais du marbre blanc sur l'îlot central et du bois clair sur les portes.");
    const trouves = await v2.rechercherMails({ texte: "marbre îlot" });
    assert.ok(trouves.some((t) => t.messageId === m.id));
    assert.match(trouves.find((t) => t.messageId === m.id)!.passage ?? "", /marbre blanc/);
    assert.equal((await v2.rechercherMails({ texte: "marbre béton" })).some((t) => t.messageId === m.id), false, "un mot absent : pas de résultat");
    assert.ok((await v2.rechercherMails({ texte: "marbrier" })).some((t) => t.messageId === m.id), "par le nom du client");
  });
});

describe("cartes de mise à jour", () => {
  let dossierId: string;
  let messageId: string;
  let clientId: string;

  before(async () => {
    const client = await prisma.client.create({ data: { nom: "Thimalu Essai", source: "INCONNUE", premierContactLe: new Date() } });
    clientId = client.id;
    const dossier = await prisma.dossier.create({ data: { clientNom: "Thimalu Essai", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000011", objet: "Cuisine", source: "ENTRANT", etape: "SIMULATION", clientId, montantEstime: 1000 } });
    dossierId = dossier.id;
    const m = await mail({ de: "thimalu@exemple.fr", clientId, dossierId, classe: "CLIENT", objet: "Changement de teinte" }, "Finalement je préfère le marbre blanc plutôt que le chêne. Je suis disponible le 2 octobre à 14h. Ci-joint deux photos.");
    messageId = m.id;
    await prisma.pieceMessage.createMany({ data: [{ messageId, rang: 1, nom: "photo1.jpg", typeMime: "image/jpeg", taille: 90_000, partie: "1", statut: "A_CONSERVER" }, { messageId, rang: 2, nom: "photo2.jpg", typeMime: "image/jpeg", taille: 90_000, partie: "2", statut: "A_CONSERVER" }] });
  });

  test("trois cartes avec leur passage ; une carte sans champ connu ou sans passage est refusée avant d'exister", async () => {
    const cartes = [
      { cible: "DOSSIER" as const, champ: "note", valeur: "Préfère le marbre blanc plutôt que le chêne", passage: "je préfère le marbre blanc plutôt que le chêne", libelle: "Teinte : marbre blanc" },
      { cible: "DOSSIER" as const, champ: "dateChantier", valeur: "2026-10-02", passage: "Je suis disponible le 2 octobre à 14h" },
      { cible: "DOSSIER" as const, champ: "photos", valeur: "toutes", passage: "Ci-joint deux photos" },
    ];
    for (const c of cartes) {
      const contenu = maj.schemaMaj.parse({ messageId, dossierId, ...c });
      maj.verifierValeur(contenu);
      await avecActeur(CLAUDE, () => validation.proposer({ type: maj.TYPE_MAJ_DEPUIS_MAIL, titre: c.libelle ?? c.champ, resume: `« ${c.passage} »`, contenu, cleUnicite: `essai:${c.champ}`, dossierId, messageId }));
    }
    assert.throws(() => maj.verifierValeur(maj.schemaMaj.parse({ messageId, dossierId, cible: "DOSSIER", champ: "prix", valeur: "1450", passage: "un prix de 1450 euros" })), /Champ inconnu/);
    assert.equal(maj.schemaMaj.safeParse({ messageId, dossierId, cible: "DOSSIER", champ: "note", valeur: "x", passage: "" }).success, false, "sans passage, pas de carte");
    assert.throws(() => maj.verifierValeur(maj.schemaMaj.parse({ messageId, dossierId, cible: "DOSSIER", champ: "dateChantier", valeur: "demain", passage: "je suis là demain" })), /n'est pas une date/);
    const d = await detail.detailMail(messageId);
    assert.equal(d.propositions.length, 3);
    assert.deepEqual(d.propositions.map((p) => p.sensible), [false, true, false], "la date de chantier est sensible");
    assert.equal(maj.estSensibleMaj({ cible: "DOSSIER", champ: "montantEstime" }), true);
    assert.equal(maj.estSensibleMaj({ cible: "CLIENT", champ: "adresse" }), true);
    assert.equal(maj.estSensibleMaj({ cible: "DOSSIER", champ: "note" }), false);
    const ligne = (await vues.conversations()).find((l) => l.messageId === messageId)!;
    assert.equal(ligne.propositionsEnAttente, 3);
  });

  test("ignorer ne touche à rien ; valider passe par le code de la fiche (note, date de chantier, photos → dossier + chronologie)", async () => {
    const d = await detail.detailMail(messageId);
    const note = d.propositions.find((p) => p.titre === "Teinte : marbre blanc")!;
    const date = d.propositions.find((p) => p.titre === "dateChantier")!;
    const photos = d.propositions.find((p) => p.titre === "photos")!;
    const avant = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    await avecActeur(LUCAS, () => validation.rejeterProposition(photos.id, { motif: "PAS_MAINTENANT" }));
    const apresIgnore = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.deepEqual([apresIgnore.photos, apresIgnore.dateChantier, apresIgnore.updatedAt.getTime()], [avant.photos, avant.dateChantier, avant.updatedAt.getTime()], "ignorer : rien");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: photos.id } })).statut, "REJETEE");

    const vNote = await avecActeur(CLAUDE, () => appliquer.appliquerProposition(note.id));
    assert.equal(vNote.statut, "EXECUTEE");
    assert.equal((await prisma.dossierNote.count({ where: { dossierId, contenu: { contains: "marbre blanc" } } })), 1, "note dans le dossier");
    const vDate = await avecActeur(CLAUDE, () => appliquer.appliquerProposition(date.id));
    assert.equal(vDate.statut, "EXECUTEE");
    const apres = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.equal(apres.dateChantier?.toISOString().slice(0, 10), "2026-10-02");
    assert.ok(apres.ecriture?.includes("ASSISTANT:claude"), "l'acteur de la validation");
    const { chronologieDuContact } = await import("@/lib/chronologie/chronologie");
    const chrono = await chronologieDuContact({ dossierId });
    assert.ok(chrono.entrees.some((e) => e.famille === "PROPOSITION" && e.titre === "dateChantier"), "la chronologie garde la proposition validée");
    assert.ok(chrono.entrees.some((e) => e.famille === "MAIL"), "et le mail");
    assert.ok(chrono.entrees.some((e) => e.famille === "NOTE"), "et la note");
    // Une carte validée deux fois : refusée (déjà traitée).
    await assert.rejects(avecActeur(CLAUDE, () => appliquer.appliquerProposition(date.id)));
  });

  test("une carte sur le projet sans espace client est sans objet à la validation (elle dit pourquoi)", async () => {
    const contenu = maj.schemaMaj.parse({ messageId, dossierId, cible: "PROJET", champ: "styles", valeur: JSON.stringify(["marbre"]), passage: "je préfère le marbre blanc" });
    maj.verifierValeur(contenu);
    const { id } = await avecActeur(CLAUDE, () => validation.proposer({ type: maj.TYPE_MAJ_DEPUIS_MAIL, titre: "Teinte", contenu, cleUnicite: "essai:styles", dossierId, messageId }));
    await assert.rejects(avecActeur(LUCAS, () => appliquer.appliquerProposition(id)), /n'a pas d'espace client/);
    assert.throws(() => maj.verifierValeur(maj.schemaMaj.parse({ messageId, dossierId, cible: "PROJET", champ: "styles", valeur: JSON.stringify(["violet"]), passage: "du violet partout" })), /n'est pas parmi/);
  });
});

describe("brouillon déposé et envoi", () => {
  test("deposer_brouillon attache au mail, compte les « [à compléter] » ; l'envoi est bloqué tant qu'il en reste", async () => {
    const m = await mail({ de: "maud@exemple.fr", deNom: "Maud", objet: "Date de pose ?", classe: "CLIENT" }, "Bonjour, quand aura lieu la pose ?");
    const b = await avecActeur(CLAUDE, () => v2.deposerBrouillon({ messageId: m.id, objet: "Re: Date de pose ?", texte: "Bonjour Maud,\n\nLa date de pose sera fixée dès réception des kits, prévue le [à compléter].\n\nLucas" }));
    assert.deepEqual([b.a, b.enReponseA, b.aCompleter], ["maud@exemple.fr", m.id, 1]);
    const ligne = await prisma.brouillonMail.findUniqueOrThrow({ where: { id: b.id } });
    assert.deepEqual([ligne.source, ligne.statut, ligne.coutEuros], ["ASSISTANT", "BROUILLON", null]);
    assert.equal((await vues.conversations()).find((l) => l.messageId === m.id)?.brouillonPret, true);
    const { envoyerDepuisLOnglet } = await import("./detail");
    await assert.rejects(avecActeur(LUCAS, () => envoyerDepuisLOnglet({ a: "maud@exemple.fr", objet: ligne.objetIa!, texte: ligne.texteIa!, enReponseA: m.id, brouillonId: b.id })), /à compléter/);
    assert.equal(await prisma.envoiMail.count({ where: { brouillonId: b.id } }), 0, "rien n'est parti");
    const d = await detail.detailMail(m.id);
    assert.equal(d.brouillons.filter((x) => x.source === "ASSISTANT").length, 1);
    assert.deepEqual(appelsAnthropic, [], "aucun appel modèle pendant toute la suite");
  });
});
