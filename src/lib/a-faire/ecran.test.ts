import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-ecran-taches-"));

/**
 * Mission 17 (partie A) — l'écran Tâches : les routes /api/a-faire (liste, réponses Fait / Plus tard / Pas à faire,
 * Annuler, ajout, « j'ai N minutes », lots, mesure du temps), les compteurs de la navigation, les créneaux libres pour
 * la date du chantier (sans agenda, avec un faux agenda) et les textes de l'écran. Les routes lisent l'heure réelle :
 * les tâches d'essai sont datées d'hier. Aucune requête réseau ; noms fictifs.
 */

type TacheVue = import("./types").TacheVue;
type ListeTaches = import("./types").ListeTaches;

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let creneaux: typeof import("@/lib/agenda/creneaux");
let affichage: typeof import("./affichage");
let ecran: typeof import("./ecran");
let NextRequestClasse: typeof import("next/server").NextRequest;
let routes: {
  liste: typeof import("@/app/api/a-faire/route");
  minutes: typeof import("@/app/api/a-faire/minutes/route");
  reponse: typeof import("@/app/api/a-faire/[id]/reponse/route");
  annuler: typeof import("@/app/api/a-faire/[id]/annuler/route");
  commencer: typeof import("@/app/api/a-faire/[id]/commencer/route");
  ajouter: typeof import("@/app/api/a-faire/ajouter/route");
  lot: typeof import("@/app/api/a-faire/lots/[lot]/route");
  classer: typeof import("@/app/api/a-faire/lots/[lot]/classer/route");
  annulerLot: typeof import("@/app/api/a-faire/lots/[lot]/annuler/route");
  creneaux: typeof import("@/app/api/a-faire/creneaux/route");
  compteurs: typeof import("@/app/api/pilotage/compteurs/route");
};

const H = 3_600_000;
const J = 86_400_000;
const fetchOriginal = globalThis.fetch;
const appelsReseau: string[] = [];
let numero = 0;

const requete = (chemin: string, corps?: unknown) =>
  new NextRequestClasse(`http://localhost:3001${chemin}`, corps === undefined ? { method: "GET" } : { method: "POST", body: JSON.stringify(corps), headers: { "Content-Type": "application/json" } });
const avecId = (id: string) => ({ params: Promise.resolve({ id }) });
const avecLot = (lot: string) => ({ params: Promise.resolve({ lot }) });
/** La réponse d'une route, appelée au nom de Lucas (comme depuis l'écran, derrière sa session). */
async function json<T>(reponse: Response | Promise<Response>): Promise<{ status: number; corps: T }> {
  const lue = await reponse;
  return { status: lue.status, corps: (await lue.json()) as T };
}
const commeLucas = <T,>(appel: () => Promise<T>) => avecActeur({ acteur: "HUMAIN:lucas@coverswap.fr" }, appel);

/** Une tâche d'essai écrite directement (ce qu'un détecteur aurait vu hier). */
async function uneTache(p: { type?: string; titre?: string; source?: string; niveau?: number; dureeMin?: number; lot?: string | null; lotLibelle?: string | null; leadId?: string | null; dossierId?: string | null; donnees?: Record<string, unknown>; raccourci?: Record<string, unknown> } = {}) {
  const n = ++numero;
  const type = p.type ?? "DEVIS";
  const sujet = p.dossierId ? { sujetType: "DOSSIER", sujetId: p.dossierId } : p.leadId ? { sujetType: "LEAD", sujetId: p.leadId } : { sujetType: "SYSTEME", sujetId: null };
  return prisma.tacheAFaire.create({
    data: {
      cle: `${type}:essai-ecran:${n}`,
      type,
      source: p.source ?? "DOSSIERS",
      ...sujet,
      leadId: p.leadId ?? null,
      dossierId: p.dossierId ?? null,
      titre: p.titre ?? `Faire le devis · Essai ${n}`,
      raison: "simulation validée hier",
      niveau: p.niveau ?? 3,
      depuis: new Date(Date.now() - J - n * 60_000),
      dureeMin: p.dureeMin ?? 10,
      raccourci: JSON.stringify(p.raccourci ?? { genre: "DOSSIER", libelle: "Ouvrir le dossier" }),
      donnees: JSON.stringify(p.donnees ?? {}),
      lot: p.lot ?? null,
      lotLibelle: p.lotLibelle ?? null,
      statut: "A_FAIRE",
    },
  });
}

async function unLead(prenom: string) {
  return prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${String(200000 + ++numero).padStart(7, "0")}`, ville: "Lattes", source: "META_ADS" } });
}

async function lireListe(): Promise<ListeTaches> {
  return (await json<ListeTaches>(await routes.liste.GET())).corps;
}

before(async () => {
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  globalThis.fetch = (async (url: unknown) => {
    appelsReseau.push(String(url));
    throw new Error(`Aucune requête réseau dans les essais (${String(url)})`);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  NextRequestClasse = (await import("next/server")).NextRequest;
  creneaux = await import("@/lib/agenda/creneaux");
  affichage = await import("./affichage");
  ecran = await import("./ecran");
  routes = {
    liste: await import("@/app/api/a-faire/route"),
    minutes: await import("@/app/api/a-faire/minutes/route"),
    reponse: await import("@/app/api/a-faire/[id]/reponse/route"),
    annuler: await import("@/app/api/a-faire/[id]/annuler/route"),
    commencer: await import("@/app/api/a-faire/[id]/commencer/route"),
    ajouter: await import("@/app/api/a-faire/ajouter/route"),
    lot: await import("@/app/api/a-faire/lots/[lot]/route"),
    classer: await import("@/app/api/a-faire/lots/[lot]/classer/route"),
    annulerLot: await import("@/app/api/a-faire/lots/[lot]/annuler/route"),
    creneaux: await import("@/app/api/a-faire/creneaux/route"),
    compteurs: await import("@/app/api/pilotage/compteurs/route"),
  };
  await (await import("@/lib/base/preparation")).preparerBase();
});

beforeEach(async () => {
  // Chaque essai part d'une liste vide : les tâches des essais précédents sont retirées (archivées).
  await prisma.tacheAFaire.updateMany({ where: { archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "essai suivant" } });
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await prisma.$disconnect();
});

describe("routes de l'écran Tâches", () => {
  test("GET /api/a-faire : la liste, « Aujourd'hui » dans l'ordre (niveau d'abord), le temps estimé", async () => {
    const production = await uneTache({ niveau: 3, dureeMin: 10 });
    const argent = await uneTache({ type: "ENCAISSER", titre: "Encaisser l'acompte · Essai", niveau: 1, dureeMin: 1 });
    const liste = await lireListe();
    assert.deepEqual(
      liste.aujourdhui.map((t) => t.id),
      [argent.id, production.id]
    );
    assert.equal(liste.compteurs.aujourdhui, 2);
    assert.equal(liste.compteurs.minutesAujourdhui, 11);
    assert.equal(affichage.sousTitreTaches(liste.compteurs), "2 aujourd'hui · environ 11 min");
    assert.equal(liste.aujourdhui[0].raccourci.genre, "DOSSIER");
  });

  test("Fait, puis Annuler : la tâche passe dans « Fait aujourd'hui », puis revient telle qu'avant", () =>
    commeLucas(async () => {
      const t = await uneTache();
      const fait = await json<{ tache: TacheVue; effet: unknown; annulable: boolean }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "FAIT" }), avecId(t.id)));
      assert.equal(fait.status, 200);
      assert.equal(fait.corps.tache.statut, "FAITE");
      assert.equal(fait.corps.annulable, true);
      let liste = await lireListe();
      assert.equal(liste.aujourdhui.some((v) => v.id === t.id), false);
      assert.equal(liste.faitAujourdhui[0]?.id, t.id);
      assert.match(affichage.ligneFaite(liste.faitAujourdhui[0]), /^fait par /);

      // Répondre deux fois : refusé (Annuler d'abord), au format des erreurs métier.
      const deux = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "FAIT" }), avecId(t.id)));
      assert.equal(deux.status, 409);
      assert.equal(typeof deux.corps.error, "string");

      const annule = await json<{ tache: TacheVue; nonDefaits: string[] }>(await routes.annuler.POST(requete(`/api/a-faire/${t.id}/annuler`, {}), avecId(t.id)));
      assert.equal(annule.status, 200);
      assert.equal(annule.corps.tache.statut, "A_FAIRE");
      liste = await lireListe();
      assert.equal(liste.aujourdhui.some((v) => v.id === t.id), true);
    }));

  test("Plus tard (demain, « j'attends le client ») : dans « Plus tard » avec sa date de retour ; une raison inconnue est refusée", async () => {
    const t = await uneTache();
    const refus = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PLUS_TARD", quand: "DEMAIN", raison: "FLEMME" }), avecId(t.id)));
    assert.equal(refus.status, 400);
    const r = await json<{ tache: TacheVue }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PLUS_TARD", quand: "DEMAIN", raison: "ATTEND_CLIENT" }), avecId(t.id)));
    assert.equal(r.status, 200);
    assert.equal(r.corps.tache.statut, "PLUS_TARD");
    assert.ok(r.corps.tache.plusTardJusqua && Date.parse(r.corps.tache.plusTardJusqua) > Date.now());
    const liste = await lireListe();
    const reportee = liste.plusTard.find((v) => v.id === t.id);
    assert.ok(reportee, "dans « Plus tard »");
    assert.equal(liste.demain, 1, "revient demain");
    assert.match(affichage.ligneGrise(reportee, new Date()), /^revient demain 9 h · j'attends le client$/);
    assert.equal(affichage.texteDemain(liste.demain), "Demain : 1 tâche revient");
  });

  test("Pas à faire : la raison est exigée et adaptée au type ; « client perdu » demande le motif ; « autre » un texte", () =>
    commeLucas(async () => {
      const t = await uneTache();
      const sansRaison = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PAS_A_FAIRE" }), avecId(t.id)));
      assert.equal(sansRaison.status, 400);
      assert.match(sansRaison.corps.error, /choisis la raison/);
      const horsType = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PAS_A_FAIRE", raison: "PAS_DE_REPONSE_A_FAIRE" }), avecId(t.id)));
      assert.equal(horsType.status, 400, "« ne demande pas de réponse » n'est pas une raison pour un devis");
      const perduSansMotif = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PAS_A_FAIRE", raison: "CLIENT_PERDU" }), avecId(t.id)));
      assert.equal(perduSansMotif.status, 400);
      const autreSansTexte = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PAS_A_FAIRE", raison: "AUTRE" }), avecId(t.id)));
      assert.equal(autreSansTexte.status, 400);
      const r = await json<{ tache: TacheVue }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "PAS_A_FAIRE", raison: "DEJA_FAIT" }), avecId(t.id)));
      assert.equal(r.status, 200);
      assert.equal(r.corps.tache.statut, "PAS_A_FAIRE");
      const liste = await lireListe();
      const faite = liste.faitAujourdhui.find((v) => v.id === t.id);
      assert.ok(faite);
      assert.match(affichage.ligneFaite(faite), /^pas à faire : déjà fait hors crm · /);
    }));

  test("identifiant illisible : 404 ; corps illisible : 400 — au format des autres routes", async () => {
    const illisible = await json<{ error: string }>(await routes.reponse.POST(requete("/api/a-faire/x/reponse", { reponse: "FAIT" }), avecId("../x")));
    assert.equal(illisible.status, 404);
    const inconnue = await json<{ error: string }>(await routes.reponse.POST(requete("/api/a-faire/c0000000000000000000000000/reponse", { reponse: "FAIT" }), avecId("c0000000000000000000000000")));
    assert.equal(inconnue.status, 404);
    const t = await uneTache();
    const mauvaise = await json<{ error: string }>(await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "SUPPRIMER" }), avecId(t.id)));
    assert.equal(mauvaise.status, 400);
    assert.match(mauvaise.corps.error, /FAIT, PLUS_TARD ou PAS_A_FAIRE/);
  });

  test("Ajouter une tâche (texte, date, contact) : une tâche à moi, en tête de la liste du jour", async () => {
    const lead = await unLead("Ajout");
    const cree = await json<{ tache: TacheVue }>(await routes.ajouter.POST(requete("/api/a-faire/ajouter", { titre: "Rappeler le carreleur · Essai", echeance: "2026-12-01", leadId: lead.id })));
    assert.equal(cree.status, 201);
    assert.equal(cree.corps.tache.type, "MANUELLE");
    assert.equal(cree.corps.tache.leadId, lead.id);
    assert.equal(cree.corps.tache.raccourci.genre, "LEAD");
    assert.ok(cree.corps.tache.echeance?.startsWith("2026-12-01"));
    const liste = await lireListe();
    assert.equal(liste.aujourdhui.some((v) => v.id === cree.corps.tache.id), true);
    const vide = await json<{ error: string }>(await routes.ajouter.POST(requete("/api/a-faire/ajouter", { titre: " " })));
    assert.equal(vide.status, 400);
    const sansCible = await json<{ tache: TacheVue }>(await routes.ajouter.POST(requete("/api/a-faire/ajouter", { titre: "Commander des rouleaux" })));
    assert.equal(sansCible.corps.tache.raccourci.genre, "PAGE");
    assert.equal(sansCible.corps.tache.raccourci.href, null, "rien à ouvrir : le bouton principal la dit faite");
  });

  test("« J'ai 15 minutes » : ce qui tient, regroupé ; minutes illisibles refusées", async () => {
    const lead1 = await unLead("Minute");
    const lead2 = await unLead("Seconde");
    await uneTache({ type: "APPELER", titre: "Appeler · Minute", source: "LEADS", niveau: 2, dureeMin: 2, leadId: lead1.id, raccourci: { genre: "APPEL", libelle: "Appeler", telephone: "+33600000001", leadId: lead1.id } });
    await uneTache({ type: "RAPPELER", titre: "Rappeler · Seconde", source: "LEADS", niveau: 2, dureeMin: 2, leadId: lead2.id, raccourci: { genre: "APPEL", libelle: "Appeler", telephone: "+33600000002", leadId: lead2.id } });
    await uneTache({ type: "DEVIS", niveau: 3, dureeMin: 10 });
    await uneTache({ type: "SIMULATION", titre: "Préparer la simulation · Trop long", niveau: 3, dureeMin: 30 });
    const plan = await json<{ minutes: number; utilisees: number; groupes: { libelle: string; ids: string[] }[] }>(await routes.minutes.GET(requete("/api/a-faire/minutes?m=15")));
    assert.equal(plan.status, 200);
    assert.equal(plan.corps.utilisees, 14);
    assert.deepEqual(
      plan.corps.groupes.map((g) => g.libelle),
      ["2 appels · 4 min", "1 devis · 10 min"]
    );
    const refus = await routes.minutes.GET(requete("/api/a-faire/minutes?m=beaucoup"));
    assert.equal(refus.status, 400);
  });

  test("les lots : une ligne, « Revoir un par un », « Tout classer » (un contact avec dossier est laissé), puis Annuler", async () => {
    const seul = await unLead("Ancien");
    const autre = await unLead("Vieux");
    const avecDossier = await unLead("Signé");
    await prisma.dossier.create({ data: { clientNom: "Signé Essai", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000000", objet: "Cuisine", source: "ENTRANT", leadId: avecDossier.id } });
    for (const lead of [seul, autre, avecDossier]) {
      await uneTache({ type: "CLASSER_LEAD", titre: `Classer · ${lead.prenom}`, source: "LEADS", niveau: 5, dureeMin: 1, leadId: lead.id, lot: "anciens-leads", lotLibelle: "ancien lead contacté sans suite|anciens leads contactés sans suite", raccourci: { genre: "LEAD", libelle: "Ouvrir la fiche", leadId: lead.id } });
    }
    const liste = await lireListe();
    assert.equal(liste.aujourdhui.length, 0, "un lot n'entre pas dans « Aujourd'hui »");
    assert.deepEqual(
      liste.lots.map((l) => [l.cle, l.libelle, l.nombre]),
      [["anciens-leads", "3 anciens leads contactés sans suite", 3]]
    );
    const un = await json<{ taches: TacheVue[] }>(await routes.lot.GET(requete("/api/a-faire/lots/anciens-leads"), avecLot("anciens-leads")));
    assert.equal(un.corps.taches.length, 3);
    const classe = await json<{ classees: number; laissees: number }>(await routes.classer.POST(requete("/api/a-faire/lots/anciens-leads/classer", {}), avecLot("anciens-leads")));
    assert.equal(classe.status, 200);
    assert.deepEqual([classe.corps.classees, classe.corps.laissees], [2, 1]);
    assert.equal((await lireListe()).lots[0]?.nombre, 1, "reste le contact qui a un dossier");
    const annule = await json<{ restaurees: number }>(await routes.annulerLot.POST(requete("/api/a-faire/lots/anciens-leads/annuler", {}), avecLot("anciens-leads")));
    assert.equal(annule.corps.restaurees, 2);
    assert.equal((await lireListe()).lots[0]?.nombre, 3);
    const inconnu = await routes.lot.GET(requete("/api/a-faire/lots/%2E%2E"), avecLot("%2E%2E"));
    assert.equal(inconnu.status, 404);
  });

  test("commencer : la mesure du temps réel est posée (sans effet sur une tâche close)", async () => {
    const t = await uneTache();
    const r = await json<{ commence: boolean }>(await routes.commencer.POST(requete(`/api/a-faire/${t.id}/commencer`, {}), avecId(t.id)));
    assert.equal(r.corps.commence, true);
    assert.ok((await prisma.tacheAFaire.findUniqueOrThrow({ where: { id: t.id } })).commenceLe);
    await routes.reponse.POST(requete(`/api/a-faire/${t.id}/reponse`, { reponse: "FAIT" }), avecId(t.id));
    const apres = await json<{ commence: boolean }>(await routes.commencer.POST(requete(`/api/a-faire/${t.id}/commencer`, {}), avecId(t.id)));
    assert.equal(apres.corps.commence, false);
  });
});

describe("compteurs de la navigation", () => {
  test("tachesAujourdhui (10 au plus) ; mailATraiter compte les tâches venues du mail ou de l'espace (source ou sources vues)", async () => {
    await uneTache({ type: "REPONDRE", titre: "Répondre · Mail", source: "MAIL" });
    await uneTache({ type: "REPONDRE", titre: "Répondre · Espace", source: "ESPACE_MESSAGES" });
    await uneTache({ type: "REPONDRE", titre: "Répondre · Vu deux fois", source: "DOSSIERS", donnees: { sourcesVues: ["DOSSIERS", "MAIL"] } });
    await uneTache({ type: "DEVIS", source: "DOSSIERS", donnees: { note: "MAIL" } });
    const reportee = await uneTache({ type: "LIRE_MAIL", titre: "Lire · Banque", source: "MAIL" });
    await prisma.tacheAFaire.update({ where: { id: reportee.id }, data: { statut: "PLUS_TARD", plusTardJusqua: new Date(Date.now() + 2 * H) } });
    for (let i = 0; i < 9; i++) await uneTache();
    const r = await json<{ tachesAujourdhui: number; mailATraiter: number; leadsEnRetard: number; tachesEnEchec: number }>(await routes.compteurs.GET());
    assert.equal(r.status, 200);
    assert.equal(r.corps.tachesAujourdhui, 10, "le badge compte « Aujourd'hui » : 10 au plus");
    assert.equal(r.corps.mailATraiter, 3, "la reportée ne compte pas ; une donnée « MAIL » quelconque non plus");
    assert.equal(typeof r.corps.tachesEnEchec, "number");
    assert.equal(await ecran.compterMailATraiter(new Date(Date.now() + 3 * H)), 4, "revenue : elle compte à nouveau");
  });
});

describe("créneaux libres pour la date du chantier", () => {
  /** Mercredi 30/09/2026, 10 h à Paris. */
  const MERCREDI = new Date("2026-09-30T08:00:00.000Z");

  test("les 10 prochains jours ouvrés, à partir de demain, sans le week-end (heure de Paris)", () => {
    assert.deepEqual(creneaux.prochainsJoursOuvres(MERCREDI), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]);
    // Vendredi 23 h 30 à Paris (21 h 30 UTC) : lundi d'abord.
    assert.equal(creneaux.prochainsJoursOuvres(new Date("2026-10-02T21:30:00.000Z"), 1)[0], "2026-10-05");
    // Samedi 0 h 30 à Paris (vendredi 22 h 30 UTC) : c'est déjà samedi à Paris ; lundi d'abord.
    assert.equal(creneaux.prochainsJoursOuvres(new Date("2026-10-02T22:30:00.000Z"), 1)[0], "2026-10-05");
    assert.equal(creneaux.libelleJour("2026-10-01"), "jeudi 1er octobre");
    assert.equal(creneaux.libelleJour("2026-10-05"), "lundi 5 octobre");
  });

  test("sans agenda : les jours ouvrés tels quels, en le disant ; aucune lecture tentée", async () => {
    let lu = false;
    const r = await creneaux.creneauxLibres(MERCREDI, {
      disponible: async () => false,
      lire: async () => {
        lu = true;
        return [];
      },
    });
    assert.equal(r.agenda, false);
    assert.equal(r.message, "agenda non connecté");
    assert.equal(r.libres.length, 10);
    assert.equal(r.occupes.length, 0);
    assert.equal(lu, false);
  });

  test("avec un faux agenda : écarte les jours « toute la journée » ou occupés 4 h ; pas les rappels du CRM, les annulés ni les « disponible »", async () => {
    let fenetre: [Date, Date] | null = null;
    const r = await creneaux.creneauxLibres(MERCREDI, {
      disponible: async () => true,
      lire: async (debut, fin) => {
        fenetre = [debut, fin];
        return [
          { summary: "Chantier Essai", start: { date: "2026-10-01" }, end: { date: "2026-10-03" } }, // jeudi et vendredi
          { summary: "Métrés", start: { dateTime: "2026-10-05T08:00:00+02:00" }, end: { dateTime: "2026-10-05T12:30:00+02:00" } }, // lundi 4 h 30
          { summary: "Rendez-vous court", start: { dateTime: "2026-10-06T09:00:00+02:00" }, end: { dateTime: "2026-10-06T11:00:00+02:00" } }, // 2 h : libre
          { summary: "Rappeler Essai – Lattes", start: { date: "2026-10-07" }, end: { date: "2026-10-08" } }, // rappel du CRM : libre
          { summary: "Annulé", status: "cancelled", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } },
          { summary: "Disponible", transparency: "transparent", start: { date: "2026-10-09" }, end: { date: "2026-10-10" } },
          { summary: "Nuit et matin", start: { dateTime: "2026-10-12T20:00:00+02:00" }, end: { dateTime: "2026-10-13T11:00:00+02:00" } }, // 4 h le 12, 11 h le 13
        ];
      },
    });
    assert.equal(r.agenda, true);
    assert.equal(r.message, null);
    assert.deepEqual(
      r.occupes.map((j) => j.jour),
      ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-12", "2026-10-13"]
    );
    assert.deepEqual(
      r.libres.map((j) => j.jour),
      ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-14"]
    );
    assert.ok(fenetre);
    const [debut, fin] = fenetre as [Date, Date];
    assert.equal(debut.toISOString(), "2026-09-30T22:00:00.000Z", "jeudi 0 h à Paris");
    assert.equal(fin.toISOString(), "2026-10-14T22:00:00.000Z", "le lendemain du dernier jour, 0 h à Paris");
  });

  test("un agenda illisible : les jours ouvrés, en le disant (rien ne casse)", async () => {
    const r = await creneaux.creneauxLibres(MERCREDI, {
      disponible: async () => true,
      lire: async () => {
        throw new Error("Google Calendar a refusé la lecture (403).");
      },
    });
    assert.equal(r.agenda, false);
    assert.match(r.message ?? "", /^agenda illisible/);
    assert.equal(r.libres.length, 10);
  });

  test("GET /api/a-faire/creneaux?dossierId= : le dossier et les jours ; Google non connecté, aucun appel réseau", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Créneau Essai", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "+33600000000", objet: "Cuisine", source: "ENTRANT", dateSouhaitee: new Date("2026-10-20T12:00:00.000Z") } });
    const avant = appelsReseau.length;
    const r = await json<{ agenda: boolean; message: string; libres: unknown[]; dossier: { clientNom: string; dateSouhaitee: string | null } }>(await routes.creneaux.GET(requete(`/api/a-faire/creneaux?dossierId=${dossier.id}`)));
    assert.equal(r.status, 200);
    assert.equal(r.corps.agenda, false);
    assert.equal(r.corps.message, "agenda non connecté");
    assert.equal(r.corps.libres.length, 10);
    assert.deepEqual([r.corps.dossier.clientNom, r.corps.dossier.dateSouhaitee], ["Créneau Essai", "2026-10-20"]);
    assert.equal(appelsReseau.length, avant);
    const inconnu = await routes.creneaux.GET(requete("/api/a-faire/creneaux?dossierId=c0000000000000000000000000"));
    assert.equal(inconnu.status, 404);
  });
});

describe("textes de l'écran", () => {
  const MAINTENANT = new Date("2026-09-30T08:00:00.000Z"); // mercredi 10 h à Paris

  test("durées, sous-titre, « Commencer », demain", () => {
    assert.deepEqual([5, 45, 60, 75, 125].map(affichage.dureeLisible), ["5 min", "45 min", "1 h", "1 h 15", "2 h 05"]);
    assert.equal(affichage.sousTitreTaches({ aujourdhui: 7, minutesAujourdhui: 45 }), "7 aujourd'hui · environ 45 min");
    assert.equal(affichage.sousTitreTaches({ aujourdhui: 0, minutesAujourdhui: 0 }), "Rien pour aujourd'hui");
    assert.equal(affichage.libelleCommencer(1, 3), "Commencer · 1 tâche · environ 3 min");
    assert.equal(affichage.libelleCommencer(7, 45), "Commencer · 7 tâches · environ 45 min");
    assert.deepEqual([0, 1, 4].map(affichage.texteDemain), ["Rien de prévu pour demain", "Demain : 1 tâche revient", "Demain : 4 tâches reviennent"]);
    assert.deepEqual([5, 15, 30, 60].map(affichage.libelleChoixMinutes), ["5 min", "15 min", "30 min", "1 h"]);
  });

  test("le moment d'un retour, heure de Paris ; le nom dans le titre", () => {
    assert.equal(affichage.momentLisible("2026-09-30T16:00:00.000Z", MAINTENANT), "ce soir 18 h");
    assert.equal(affichage.momentLisible("2026-10-01T07:00:00.000Z", MAINTENANT), "demain 9 h");
    assert.equal(affichage.momentLisible("2026-10-05T07:00:00.000Z", MAINTENANT), "lundi 9 h");
    assert.equal(affichage.momentLisible("2026-10-12T07:30:00.000Z", MAINTENANT), "le 12 oct. 9 h 30");
    assert.equal(affichage.nomDuTitre("Appeler · Essai Deux"), "Essai Deux");
    assert.equal(affichage.nomDuTitre("Commander des rouleaux"), "Commander des rouleaux");
  });

  test("« Fait aujourd'hui » : la raison d'une coche du CRM telle quelle ; qui et quand pour une réponse", () => {
    const base = { statut: "FAITE" as const, reponse: "FAIT" as const, reponseRaison: null, reponduLe: "2026-09-30T08:12:00.000Z" };
    assert.equal(affichage.ligneFaite({ ...base, reponseTexte: "coché par le CRM : devis 2026-043 déposé", reponduParLisible: "le CRM" }), "coché par le CRM : devis 2026-043 déposé");
    assert.equal(affichage.ligneFaite({ ...base, reponseTexte: null, reponduParLisible: "Lucas" }), "fait par Lucas à 10:12");
    assert.equal(affichage.ligneFaite({ ...base, statut: "PAS_A_FAIRE", reponse: "PAS_A_FAIRE", reponseRaison: "CLIENT_LE_FAIT", reponseTexte: null, reponduParLisible: "Claude" }), "pas à faire : le client le fait lui-même · Claude à 10:12");
  });

  test("la ligne grise : la marche à suivre d'une page, sinon la raison", () => {
    const base = { raison: "jeton Meta expiré", statut: "A_FAIRE" as const, plusTardJusqua: null, reponseRaison: null };
    assert.equal(affichage.ligneGrise({ ...base, raccourci: { genre: "PAGE", libelle: "Ouvrir Meta", href: "https://exemple.test", externe: true, marche: "Paramètres → Connexions → Renouveler" } }, MAINTENANT), "Paramètres → Connexions → Renouveler");
    assert.equal(affichage.ligneGrise({ ...base, raccourci: { genre: "DOSSIER", libelle: "Ouvrir" } }, MAINTENANT), "jeton Meta expiré");
  });
});
