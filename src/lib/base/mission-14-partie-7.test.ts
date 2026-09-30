import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m14-p7-"));

/**
 * Mission 14 (29/09/2026), partie 7 — l'agenda et les notifications des rappels. Chaque rappel daté (lead, ou
 * « Rappeler… » d'un dossier) a UN événement Google Agenda de 15 minutes, mis à jour quand la date change, supprimé
 * quand elle disparaît ; sans droit agenda la tâche attend et l'événement se pose à la reconnexion ; la notification
 * part 10 minutes avant, avec le numéro et la fiche, seulement si le rappel n'a pas bougé. Les nombres du jour (point
 * du jour, écran Leads) et la migration des rappels futurs. Google est simulé (aucun appel réseau). Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let google: typeof import("@/lib/google/connexion");
let rappels: typeof import("@/lib/agenda/rappels");
let resume: typeof import("@/lib/agenda/resume");
let planification: typeof import("@/lib/agenda/planification");
let entrants: typeof import("@/lib/prospects/entrants");
let depuisLead: typeof import("@/lib/dossiers/depuis-lead");
let transitions: typeof import("@/lib/dossiers/transitions");
let executeur: typeof import("@/lib/taches/executeur");
let execution: typeof import("@/lib/assistant/execution");
let ecriture: typeof import("@/lib/assistant/outils/ecriture");
let pointDuJour: typeof import("@/lib/assistant/outils/point-du-jour");
let proposables: typeof import("@/lib/relances/proposables");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-7");

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
const dans = (ms: number) => new Date(Date.now() + ms);

/* ── Faux Google : jetons en mémoire, agenda en mémoire ─────────────── */

const API_AGENDA = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
type AppelAgenda = { methode: string; id: string | null; corps: Record<string, unknown> | null };
let appelsAgenda: AppelAgenda[] = [];
const evenements = new Map<string, Record<string, unknown>>();
let rangEvenement = 0;
let porteesAccordees = "";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

async function fauxGoogle(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const parametres = new URLSearchParams(String(init.body ?? ""));
    if (parametres.get("grant_type") === "authorization_code") return json({ access_token: "acces-essai", refresh_token: "renouvellement-essai", expires_in: 3600, scope: porteesAccordees });
    return json({ access_token: "acces-essai", expires_in: 3600 });
  }
  if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "agenda.essai@example.test" });
  if (url.startsWith(API_AGENDA)) {
    const methode = init.method ?? "GET";
    const id = url.length > API_AGENDA.length ? decodeURIComponent(url.slice(API_AGENDA.length + 1)) : null;
    const corps = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    appelsAgenda.push({ methode, id, corps });
    if (methode === "POST") {
      const nouveau = `evt-${++rangEvenement}`;
      evenements.set(nouveau, corps ?? {});
      return json({ id: nouveau, htmlLink: `https://calendar.google.com/event?eid=${nouveau}` });
    }
    if (methode === "PATCH") {
      if (!id || !evenements.has(id)) return json({ error: { code: 404 } }, 404);
      evenements.set(id, { ...evenements.get(id), ...corps });
      return json({ id, htmlLink: `https://calendar.google.com/event?eid=${id}` });
    }
    if (methode === "DELETE") {
      if (!id || !evenements.has(id)) return new Response(null, { status: 410 });
      evenements.delete(id);
      return new Response(null, { status: 204 });
    }
  }
  throw new Error(`Appel Google inattendu : ${init.method ?? "GET"} ${url}`);
}

/** Connexion Google (retour OAuth simulé), avec ou sans le droit agenda. */
async function connecterGoogle(avecAgenda: boolean) {
  const { AGENDA, ...autres } = google.PORTEES_GOOGLE;
  porteesAccordees = ["openid", "email", ...Object.values(autres), ...(avecAgenda ? [AGENDA] : [])].join(" ");
  await google.terminerConnexion({ code: "code-essai", etat: "etat", etatAttendu: "etat", erreur: null });
}

/** L'exécuteur, tour après tour, tant qu'il reste des tâches dues (à `maintenant`). */
async function toutExecuter(maintenant?: Date) {
  for (let tour = 0; tour < 10; tour++) if ((await executeur.executerTour(maintenant ?? new Date())) === 0) return;
}

type AlerteRecue = { alerte: import("@/lib/alertes/canaux").Alerte; options: { canaux?: readonly string[]; origine?: string } };
let alertes: AlerteRecue[] = [];

let numero = 0;
const lead = (prenom: string, nom: string, donnees: Record<string, unknown> = {}) =>
  prisma.lead.create({ data: { prenom, nom, telephone: `+336123400${String(++numero).padStart(2, "0")}`, ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE", ...donnees } });
const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const tacheAgenda = (type: "LEAD" | "DOSSIER", id: string) => prisma.tache.findUniqueOrThrow({ where: { cle: `agenda-rappel:${type}:${id}` } });
const appelsDe = (methode: string) => appelsAgenda.filter((a) => a.methode === methode);

async function session() {
  return execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });
}
const outil = (definition: unknown) => definition as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  // Après l'import de Prisma (qui recharge .env) : ni canal d'alerte réel, un Google configuré pour les essais.
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.GOOGLE_CLIENT_ID = "client-essai";
  process.env.GOOGLE_CLIENT_SECRET = "secret-essai";
  process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.GOOGLE_REDIRECT_BASE_URL = "https://crm.coverswap.fr";
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.coverswap.fr";
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  process.env.TACHES_DESACTIVEES = "1";
  google = await import("@/lib/google/connexion");
  rappels = await import("@/lib/agenda/rappels");
  resume = await import("@/lib/agenda/resume");
  planification = await import("@/lib/agenda/planification");
  entrants = await import("@/lib/prospects/entrants");
  depuisLead = await import("@/lib/dossiers/depuis-lead");
  transitions = await import("@/lib/dossiers/transitions");
  executeur = await import("@/lib/taches/executeur");
  execution = await import("@/lib/assistant/execution");
  ecriture = await import("@/lib/assistant/outils/ecriture");
  pointDuJour = await import("@/lib/assistant/outils/point-du-jour");
  proposables = await import("@/lib/relances/proposables");
  migration = await import("@/lib/base/migrations/mission-14-partie-7");
  await (await import("@/lib/base/preparation")).preparerBase();
  google.definirTransportGoogleEssai(fauxGoogle);
  rappels.definirAlerteurRappelsEssai(async (alerte, options) => {
    alertes.push({ alerte, options });
    return [{ canal: "ntfy", ok: true, configure: true }];
  });
  rappels.enregistrerTachesRappels();
});
after(async () => {
  google.definirTransportGoogleEssai(null);
  rappels.definirAlerteurRappelsEssai(null);
  await prisma.$disconnect();
});

describe("un rappel, un événement Google Agenda", () => {
  test("sans Google puis sans droit agenda : planifier le dit, la tâche attend ; droit accordé + réveil → l'événement se pose", async () => {
    const bastien = await lead("Bastien", "Attente", { ville: "Montpellier" });
    const debut = dans(2 * JOUR);
    const sansGoogle = await planification.planifierAction({ leadId: bastien.id, nom: "Bastien Attente", action: "Rappeler", debut });
    assert.match(sansGoogle.texte, /^Planifié : Rappeler pour Bastien Attente/);
    assert.match(sansGoogle.texte, /Pas inscrit dans Google Calendar : Google n'est pas connecté \(Paramètres → Connexions\) ; le rappel est dans le CRM/);
    assert.equal(sansGoogle.rappel, true);

    await connecterGoogle(false);
    assert.equal((await google.etatConnexionGoogle()).agenda, false, "Paramètres le sait : le droit agenda manque");
    const sansDroit = await planification.planifierAction({ leadId: bastien.id, nom: "Bastien Attente", action: "Rappeler", debut });
    assert.match(sansDroit.texte, /Pas inscrit dans Google Calendar : le droit « agenda » n'est pas accordé \(Paramètres → Connexions → Reconnecter\)/);

    appelsAgenda = [];
    await toutExecuter();
    const attente = await tacheAgenda("LEAD", bastien.id);
    assert.equal(attente.statut, "EN_ATTENTE");
    assert.match(attente.derniereErreur ?? "", /^\[en attente\] Google : droit « agenda » non accordé/);
    assert.ok(attente.prochainEssaiLe.getTime() > Date.now() + 5 * HEURE, "sans droit, elle ne réessaie pas tous les quarts d'heure");
    assert.equal(appelsAgenda.length, 0, "rien n'est tenté chez Google");
    assert.equal((await leadDe(bastien.id)).agendaEvenementId, null);

    // Lucas accorde le droit (Reconnecter) : le retour de Google réveille la tâche, l'événement se pose.
    await connecterGoogle(true);
    assert.equal((await google.etatConnexionGoogle()).agenda, true);
    assert.ok((await tacheAgenda("LEAD", bastien.id)).prochainEssaiLe.getTime() <= Date.now(), "réveillée par la reconnexion");
    await toutExecuter();
    const cree = appelsDe("POST").find((a) => String(a.corps?.summary).includes("Bastien"));
    assert.equal(cree?.corps?.summary, "Rappeler Bastien Attente – Montpellier");
    const relu = await leadDe(bastien.id);
    assert.ok(relu.agendaEvenementId);
    assert.equal((await tacheAgenda("LEAD", bastien.id)).statut, "TERMINEE");
  });

  test("rappel posé → événement de 15 min (titre, tel:, fiche) rangé ; date changée → PATCH du même ; date retirée → DELETE et id effacé", async () => {
    const camille = await lead("Camille", "Essai");
    const premier = dans(3 * JOUR);
    await entrants.modifierEntrant(camille.id, { rappelLe: premier.toISOString() });
    assert.equal((await tacheAgenda("LEAD", camille.id)).type, "AGENDA_RAPPEL");

    appelsAgenda = [];
    await toutExecuter();
    assert.equal(appelsDe("POST").length, 1);
    const corps = appelsDe("POST")[0].corps!;
    assert.equal(corps.summary, "Rappeler Camille Essai – Lattes");
    assert.deepEqual(corps.start, { dateTime: premier.toISOString(), timeZone: "Europe/Paris" });
    assert.deepEqual(corps.end, { dateTime: new Date(premier.getTime() + 15 * 60_000).toISOString(), timeZone: "Europe/Paris" });
    assert.equal(corps.description, `Appeler : tel:${camille.telephone}\nFiche : https://crm.coverswap.fr/leads?lead=${camille.id}`);
    assert.deepEqual(corps.reminders, { useDefault: true });
    const id = (await leadDe(camille.id)).agendaEvenementId;
    assert.ok(id);

    // La puce de la liste déplace le rappel : le même événement bouge.
    const second = dans(4 * JOUR);
    appelsAgenda = [];
    await entrants.modifierEntrant(camille.id, { rappelLe: second.toISOString() });
    await toutExecuter();
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id]), [["PATCH", id]]);
    // PATCH : l'autre forme de l'horaire est remise à null (Google fusionne les objets d'un PATCH).
    assert.deepEqual(appelsAgenda[0].corps?.start, { dateTime: second.toISOString(), timeZone: "Europe/Paris", date: null });
    assert.equal((await leadDe(camille.id)).agendaEvenementId, id);

    // « Retirer la date » : l'événement est supprimé, l'identifiant effacé.
    appelsAgenda = [];
    await entrants.modifierEntrant(camille.id, { rappelLe: null });
    const apresModification = (await leadDe(camille.id)).updatedAt;
    await toutExecuter();
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id]), [["DELETE", id]]);
    assert.equal(evenements.has(id!), false);
    const relu = await leadDe(camille.id);
    assert.equal(relu.agendaEvenementId, null);
    assert.equal(relu.updatedAt.toISOString(), apresModification.toISOString(), "ranger l'événement n'est pas une activité du contact");
    assert.match(JSON.parse((await tacheAgenda("LEAD", camille.id)).resultat ?? "{}").resume, /Rappel retiré : événement supprimé/);

    // Un lead qui n'a jamais eu de rappel ne crée aucune tâche.
    const sansRappel = await lead("Denis", "Sansrappel");
    await entrants.modifierEntrant(sansRappel.id, { ville: "Sète" });
    assert.equal(await prisma.tache.count({ where: { cle: { contains: sansRappel.id } } }), 0);
  });

  test("le rappel migre : dossier ouvert → l'événement du lead part, celui du dossier se pose (heure exacte) ; dossier perdu → supprimé", async () => {
    const chloe = await lead("Chloé", "Migration", { ville: "Pérols" });
    const rappel = new Date(Math.floor(dans(5 * JOUR).getTime() / 60_000) * 60_000 + 17 * 60_000);
    await entrants.modifierEntrant(chloe.id, { rappelLe: rappel.toISOString() });
    await toutExecuter();
    const idLead = (await leadDe(chloe.id)).agendaEvenementId!;
    assert.ok(evenements.has(idLead));

    appelsAgenda = [];
    const { dossierId } = await depuisLead.ouvrirDossierDuLead(chloe.id, { motif: "BOUTON" });
    const dossier = await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } });
    assert.deepEqual([dossier.prochaineAction, dossier.prochaineActionDate?.toISOString()], ["Rappeler", rappel.toISOString()], "le rappel garde son heure sur le dossier");
    await toutExecuter();
    assert.ok(appelsDe("DELETE").some((a) => a.id === idLead), "l'événement du lead est supprimé");
    const pose = appelsDe("POST").find((a) => String(a.corps?.description).includes(`/dossiers?dossier=${dossierId}`));
    assert.equal(pose?.corps?.summary, "Rappeler Chloé Migration – Pérols");
    assert.deepEqual(pose?.corps?.start, { dateTime: rappel.toISOString(), timeZone: "Europe/Paris" });
    assert.equal((await leadDe(chloe.id)).agendaEvenementId, null);
    const idDossier = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).agendaEvenementId;
    assert.ok(idDossier && evenements.has(idDossier));

    // Pas intéressé : le dossier passe perdu, son rappel quitte l'agenda.
    appelsAgenda = [];
    await transitions.changerEtape(dossierId, { vers: "PERDU", motifPerte: "PRIX" });
    await toutExecuter();
    assert.deepEqual(appelsDe("DELETE").map((a) => a.id), [idDossier]);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).agendaEvenementId, null);
  });

  test("« planifier » deux fois le rappel d'un lead : un seul événement, déplacé ; un rappel de dossier garde son heure, une autre action garde son événement à part", async () => {
    const eloise = await lead("Éloïse", "Planifiee");
    const s = await session();
    const premier = await execution.executerOutil(outil(ecriture.outilPlanifier), { leadId: eloise.id, action: "Rappeler", quand: "2030-06-12 14:00" }, s);
    assert.match(premier.texte, /^Planifié : Rappeler pour Éloïse Planifiee, 12 juin 2030 à 14:00\. Inscrit dans Google Calendar \(un seul événement par rappel : replanifier le déplace\)\./);
    appelsAgenda = [];
    await toutExecuter();
    const id = (await leadDe(eloise.id)).agendaEvenementId;
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id]), [["POST", null]]);

    await execution.executerOutil(outil(ecriture.outilPlanifier), { leadId: eloise.id, action: "Rappeler", quand: "2030-06-13 15:30" }, s);
    appelsAgenda = [];
    await toutExecuter();
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id]), [["PATCH", id]], "replanifier déplace le même événement");
    assert.deepEqual(appelsAgenda[0].corps?.start, { dateTime: "2030-06-13T13:30:00.000Z", timeZone: "Europe/Paris", date: null });
    assert.equal([...evenements.values()].filter((e) => String(e.summary).includes("Éloïse")).length, 1);

    // Un dossier : « Rappeler » à l'heure dite (plus de jour seul) ; « Passer prendre les mesures » : événement direct, au jour.
    const client = await prisma.client.create({ data: { nom: "Fabre Gaston", prenom: "Gaston", source: "ENTRANT", premierContactLe: new Date() } });
    const dossier = await prisma.dossier.create({ data: { clientNom: "Fabre Gaston", clientAdresse: "1 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0612340099", objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION", clientId: client.id } });
    const rappelDossier = await execution.executerOutil(outil(ecriture.outilPlanifier), { dossierId: dossier.id, action: "Rappeler Gaston", quand: "2030-06-14 18:15" }, s);
    assert.match(rappelDossier.texte, /Inscrit dans Google Calendar \(un seul événement/);
    const relu = await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } });
    assert.deepEqual([relu.prochaineAction, relu.prochaineActionDate?.toISOString()], ["Rappeler Gaston", "2030-06-14T16:15:00.000Z"]);
    appelsAgenda = [];
    await toutExecuter();
    assert.equal(appelsDe("POST")[0]?.corps?.summary, "Rappeler Fabre Gaston – Montpellier");
    const idDossier = (await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).agendaEvenementId;

    appelsAgenda = [];
    const mesures = await execution.executerOutil(outil(ecriture.outilPlanifier), { dossierId: dossier.id, action: "Passer prendre les mesures", quand: "2030-06-20 09:00" }, s);
    assert.match(mesures.texte, /^Planifié : Passer prendre les mesures pour .*\. Inscrit dans Google Calendar\.$/);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).prochaineActionDate?.toISOString(), "2030-06-20T12:00:00.000Z", "une autre action reste au jour");
    assert.equal(appelsDe("POST")[0]?.corps?.summary, "Passer prendre les mesures — Fabre Gaston", "créée tout de suite, comme avant");
    await toutExecuter();
    assert.ok(appelsDe("DELETE").some((a) => a.id === idDossier), "le rappel remplacé quitte l'agenda");
  });

  test("estRappel : « Rappeler… » seulement", () => {
    assert.deepEqual(["Rappeler", "Rappeler (pas de réponse)", "rappeler Mme X", "Appeler : nouveau projet", "Rappelez-lui le devis", null].map(rappels.estRappel), [true, true, true, false, false, false]);
  });
});

describe("la notification 10 minutes avant", () => {
  test("programmée à rappel − 10 min ; rappel déplacé → l'ancienne ne notifie pas ; la bonne part (numéro, fiche, canaux poussés)", async () => {
    const gaelle = await lead("Gaëlle", "Notif", { tentatives: 2 });
    const r1 = new Date(Math.floor(dans(2 * HEURE).getTime() / 1000) * 1000);
    await entrants.modifierEntrant(gaelle.id, { rappelLe: r1.toISOString() });
    const cible = { type: "LEAD" as const, id: gaelle.id };
    const t1 = await prisma.tache.findUniqueOrThrow({ where: { cle: rappels.cleNotificationRappel(cible, r1) } });
    assert.equal(t1.type, "RAPPEL_NOTIFICATION");
    assert.equal(t1.prochainEssaiLe.toISOString(), new Date(r1.getTime() - 10 * 60_000).toISOString());

    const r2 = new Date(r1.getTime() + HEURE);
    await entrants.modifierEntrant(gaelle.id, { rappelLe: r2.toISOString() });
    const cle2 = rappels.cleNotificationRappel(cible, r2);
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: cle2 } })).prochainEssaiLe.toISOString(), new Date(r2.getTime() - 10 * 60_000).toISOString());

    alertes = [];
    await toutExecuter(new Date(r1.getTime() - 10 * 60_000 + 1000));
    const ancienne = await prisma.tache.findUniqueOrThrow({ where: { id: t1.id } });
    assert.equal(ancienne.statut, "TERMINEE");
    assert.equal(JSON.parse(ancienne.resultat ?? "{}").notifie, false);
    assert.match(JSON.parse(ancienne.resultat ?? "{}").resume, /Rappel déplacé/);
    assert.equal(alertes.length, 0, "l'ancienne tâche ne notifie pas");
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle: cle2 } })).statut, "EN_ATTENTE", "la bonne attend son heure");

    await toutExecuter(new Date(r2.getTime() - 10 * 60_000 + 1000));
    assert.equal(alertes.length, 1);
    const { alerte, options } = alertes[0];
    assert.equal(alerte.titre, "Rappel dans 10 min : Gaëlle Notif");
    assert.equal(alerte.texte, `Lattes · ${gaelle.telephone.replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, "0$1 $2 $3 $4 $5")} · 2 appels sans réponse · Cuisine`);
    assert.equal(alerte.telephone, gaelle.telephone.replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, "0$1 $2 $3 $4 $5"));
    assert.equal(alerte.lien, `https://crm.coverswap.fr/leads?lead=${gaelle.id}`);
    assert.equal(alerte.libelleLien, "Ouvrir la fiche");
    assert.equal(alerte.etiquette, `rappel:LEAD:${gaelle.id}`);
    assert.deepEqual(options, { canaux: ["telegram", "ntfy", "pushweb"], origine: cle2 });
    assert.equal(JSON.parse((await prisma.tache.findUniqueOrThrow({ where: { cle: cle2 } })).resultat ?? "{}").notifie, true);

    // Remis à la première heure : la tâche de cet instant, passée sans notifier, est réarmée.
    await entrants.modifierEntrant(gaelle.id, { rappelLe: r1.toISOString() });
    const rearmee = await prisma.tache.findUniqueOrThrow({ where: { id: t1.id } });
    assert.deepEqual([rearmee.statut, rearmee.prochainEssaiLe.toISOString()], ["EN_ATTENTE", new Date(r1.getTime() - 10 * 60_000).toISOString()]);
  });

  test("rappel dans 4 minutes : la notification part tout de suite ; rappel passé : aucune ; rappel retiré : rien", async () => {
    const hugo = await lead("Hugo", "Bientot");
    const proche = dans(4 * 60_000);
    await entrants.modifierEntrant(hugo.id, { rappelLe: proche.toISOString() });
    const tache = await prisma.tache.findUniqueOrThrow({ where: { cle: rappels.cleNotificationRappel({ type: "LEAD", id: hugo.id }, proche) } });
    assert.ok(tache.prochainEssaiLe.getTime() <= Date.now());
    alertes = [];
    await toutExecuter();
    assert.equal(alertes.length, 1);
    assert.match(alertes[0].alerte.titre, /^Rappel dans [1-4] min : Hugo Bientot$/);

    const ines = await lead("Inès", "Passee");
    await entrants.modifierEntrant(ines.id, { rappelLe: new Date(Date.now() - HEURE).toISOString() });
    assert.equal(await prisma.tache.count({ where: { cle: { startsWith: `rappel-push:LEAD:${ines.id}:` } } }), 0, "rien pour un rappel passé");

    const jules = await lead("Jules", "Retire");
    const plusTard = dans(3 * HEURE);
    await entrants.modifierEntrant(jules.id, { rappelLe: plusTard.toISOString() });
    await entrants.modifierEntrant(jules.id, { rappelLe: null });
    alertes = [];
    const resultat = await rappels.notifierRappel({ type: "LEAD", id: jules.id, rappelLe: plusTard.toISOString() });
    assert.deepEqual([resultat.notifie, alertes.length], [false, 0]);
  });
});

describe("les nombres du jour", () => {
  // 15 mars 2030, 10 h à Paris (heure d'hiver, UTC+1).
  const MAINTENANT = new Date("2030-03-15T09:00:00.000Z");

  test("resumeDuJour et la ligne du point du jour : rappels des leads d'aujourd'hui (Paris), retards, relances proposables", async () => {
    // Une base propre pour compter juste : ce que les essais précédents ont laissé est archivé (rien ne se supprime).
    await prisma.lead.updateMany({ data: { archiveLe: new Date(), archiveMotif: "Essai précédent" } });
    await prisma.dossier.updateMany({ data: { archiveLe: new Date(), archiveMotif: "Essai précédent" } });
    await lead("Karim", "Aujourdhui", { rappelLe: new Date(MAINTENANT.getTime() + 3 * HEURE) });
    await lead("Léa", "Retard", { rappelLe: new Date(MAINTENANT.getTime() - 2 * JOUR) });
    await lead("Marc", "Retard", { rappelLe: new Date(MAINTENANT.getTime() - HEURE) });
    await lead("Nina", "Demain", { rappelLe: new Date("2030-03-15T23:30:00.000Z") }); // 00 h 30 le 16 à Paris : demain
    await lead("Oscar", "Archive", { rappelLe: new Date(MAINTENANT.getTime() + HEURE), archiveLe: new Date(), archiveMotif: "Test" });
    const paul = await lead("Paul", "Dossier", { rappelLe: new Date(MAINTENANT.getTime() + 2 * HEURE) });
    await prisma.dossier.create({ data: { leadId: paul.id, clientNom: "Paul Dossier", clientAdresse: "", clientCp: "", clientVille: "Lattes", clientTelephone: paul.telephone, objet: "Recouvrement de cuisine", source: "ENTRANT", etape: "QUALIFICATION" } });
    // Un devis sans réponse depuis 10 jours : une relance proposable.
    const client = await prisma.client.create({ data: { nom: "Quentin Devis", prenom: "Quentin", source: "ENTRANT", premierContactLe: MAINTENANT } });
    const avecDevis = await prisma.dossier.create({ data: { clientNom: "Quentin Devis", clientAdresse: "3 rue des Essais", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000701", objet: "Recouvrement de salle de bains", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: client.id } });
    const emis = new Date(MAINTENANT.getTime() - 10 * JOUR);
    await prisma.document.create({ data: { dossierId: avecDevis.id, clientId: client.id, type: "DEVIS", numero: "2030-701", dateEmission: emis, createdAt: emis, objet: "Meuble vasque", lignes: "[]", totalHt: 630, acomptePct: 30, statut: "ENVOYE" } });
    // Le début de journée à Paris, l'hiver : 23 h 30 la veille n'est pas « aujourd'hui », 23 h 30 ce soir l'est.
    await prisma.dossier.create({ data: { clientNom: "Veille Rémi", clientAdresse: "", clientCp: "", clientVille: "Sète", clientTelephone: "0600000702", objet: "", source: "ENTRANT", etape: "QUALIFICATION", prochaineAction: "Poser la cuisine", prochaineActionDate: new Date("2030-03-14T22:30:00.000Z") } });
    const soir = await prisma.dossier.create({ data: { clientNom: "Soir Sarah", clientAdresse: "", clientCp: "", clientVille: "Sète", clientTelephone: "0600000703", objet: "", source: "ENTRANT", etape: "QUALIFICATION", prochaineAction: "Envoyer le devis", prochaineActionDate: new Date("2030-03-15T22:30:00.000Z") } });

    const relances = (await proposables.relancesProposables(MAINTENANT)).total;
    assert.equal(relances, 1);
    assert.deepEqual(await resume.resumeDuJour(MAINTENANT), { rappelsAujourdhui: 1, rappelsEnRetard: 2, relancesProposables: 1 });

    const point = await pointDuJour.calculerPointDuJour(MAINTENANT, { memoriser: false });
    assert.deepEqual([point.aujourdhui.rappelsAujourdhui, point.aujourdhui.rappelsEnRetard, point.aujourdhui.relancesProposables], [1, 2, 1]);
    assert.deepEqual(point.aujourdhui.actionsDossiers.map((a) => a.dossierId), [soir.id], "la journée de Paris, pas « +02:00 » figé");

    const texte = (await execution.executerOutil(outil(pointDuJour.outilPointDuJour), {}, await session(), MAINTENANT)).texte.split("\n");
    assert.match(texte[2], /^Aujourd'hui : .* propositions? à valider\.$/);
    assert.equal(texte[3], "Rappels : 1 aujourd'hui, 2 en retard, 1 relance proposable.");
  });
});

describe("migration « agenda-des-rappels-14-7 »", () => {
  test("met en file les rappels futurs (leads des listes, dossiers « Rappeler » datés), rejouable, inscrite en dernier", async () => {
    await prisma.lead.updateMany({ data: { archiveLe: new Date(), archiveMotif: "Essai précédent" } });
    await prisma.dossier.updateMany({ data: { archiveLe: new Date(), archiveMotif: "Essai précédent" } });
    const futur = dans(2 * JOUR);
    const rachel = await lead("Rachel", "Future", { rappelLe: futur });
    await lead("Samuel", "Passe", { rappelLe: new Date(Date.now() - JOUR) });
    await lead("Tina", "Archivee", { rappelLe: futur, archiveLe: new Date(), archiveMotif: "Test" });
    await lead("Ugo", "Perdu", { rappelLe: futur, statut: "PERDU", motifPerte: "PRIX" });
    const base = { clientAdresse: "", clientCp: "", clientVille: "Lattes", clientTelephone: "0600000801", objet: "", source: "ENTRANT" };
    const aRappeler = await prisma.dossier.create({ data: { ...base, clientNom: "Vincent Rappel", etape: "QUALIFICATION", prochaineAction: "Rappeler (pas de réponse)", prochaineActionDate: futur } });
    await prisma.dossier.create({ data: { ...base, clientNom: "Wendy Devis", etape: "QUALIFICATION", prochaineAction: "Envoyer le devis", prochaineActionDate: futur } });
    await prisma.dossier.create({ data: { ...base, clientNom: "Xavier Perdu", etape: "PERDU", prochaineAction: "Rappeler", prochaineActionDate: futur } });

    assert.deepEqual(await migration.inscrireLesRappels(prisma), { leads: 1, dossiers: 1 });
    const cles = (await prisma.tache.findMany({ where: { OR: [{ cle: { contains: rachel.id } }, { cle: { contains: aRappeler.id } }] }, select: { cle: true } })).map((t) => t.cle).sort();
    assert.deepEqual(cles, [`agenda-rappel:DOSSIER:${aRappeler.id}`, `agenda-rappel:LEAD:${rachel.id}`, `rappel-push:DOSSIER:${aRappeler.id}:${futur.toISOString()}`, `rappel-push:LEAD:${rachel.id}:${futur.toISOString()}`].sort());
    const avant = await prisma.tache.count();
    assert.deepEqual(await migration.inscrireLesRappels(prisma), { leads: 1, dossiers: 1 });
    assert.equal(await prisma.tache.count(), avant, "rejouée : aucune tâche en double");

    await toutExecuter();
    assert.ok((await leadDe(rachel.id)).agendaEvenementId, "l'événement du lead se pose");
    assert.ok((await prisma.dossier.findUniqueOrThrow({ where: { id: aRappeler.id } })).agendaEvenementId, "celui du dossier aussi");

    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    assert.ok(noms.indexOf("agenda-des-rappels-14-7") > noms.indexOf("relances-un-circuit-14-6") && noms.includes("relances-un-circuit-14-6"), noms.join(", "));
  });
});

describe("relecture : les rappels que la première version laissait de côté", () => {
  const base = { clientAdresse: "", clientCp: "", clientVille: "Frontignan", objet: "Recouvrement de cuisine", source: "ENTRANT" };
  const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });

  test("rappel noté au jour seul : événement « toute la journée », notification à 9 h ; « 14 h » choisi reste à l'heure ; le texte seul changé garde l'heure", async () => {
    const dossiers = await import("@/lib/dossiers/dossiers");
    const d = await prisma.dossier.create({ data: { ...base, clientNom: "Yvan Journee", clientTelephone: "0600000901", etape: "QUALIFICATION" } });
    const cible = { type: "DOSSIER" as const, id: d.id };

    // L'écran du dossier : « Rappeler », le 12 juin, sans heure.
    await dossiers.modifierDossier(d.id, { prochaineAction: "Rappeler", prochaineActionDate: "2030-06-12" });
    appelsAgenda = [];
    await toutExecuter();
    const pose = appelsDe("POST")[0];
    assert.deepEqual([pose?.corps?.start, pose?.corps?.end], [{ date: "2030-06-12" }, { date: "2030-06-13" }], "toute la journée, pas 14 h");
    const jourSeul = new Date("2030-06-12T12:00:00.000Z");
    const tache = await prisma.tache.findUniqueOrThrow({ where: { cle: rappels.cleNotificationRappel(cible, jourSeul) } });
    assert.equal(tache.prochainEssaiLe.toISOString(), "2030-06-12T07:00:00.000Z", "9 h à Paris (heure d'été)");
    alertes = [];
    assert.equal((await rappels.notifierRappel({ ...cible, rappelLe: jourSeul.toISOString() }, new Date("2030-06-12T07:00:30.000Z"))).notifie, true);
    assert.equal(alertes[0]?.alerte.titre, "Rappel aujourd'hui : Yvan Journee");
    assert.deepEqual(await rappels.notifierRappel({ ...cible, rappelLe: jourSeul.toISOString() }, new Date("2030-06-13T08:00:00.000Z")), { notifie: false, resume: "Jour du rappel passé : pas de notification." });
    const id = (await dossierDe(d.id)).agendaEvenementId;

    // « planifier … 14:00 » l'été : midi UTC pile, mais choisi à l'heure — un événement de 15 minutes, pas une journée.
    const s = await session();
    await execution.executerOutil(outil(ecriture.outilPlanifier), { dossierId: d.id, action: "Rappeler", quand: "2030-06-14 14:00" }, s);
    const planifie = await dossierDe(d.id);
    assert.deepEqual([planifie.prochaineActionDate?.toISOString(), planifie.prochaineActionInstant?.toISOString()], ["2030-06-14T12:00:00.000Z", "2030-06-14T12:00:00.000Z"]);
    appelsAgenda = [];
    await toutExecuter();
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id]), [["PATCH", id]]);
    assert.deepEqual(appelsAgenda[0].corps?.start, { dateTime: "2030-06-14T12:00:00.000Z", timeZone: "Europe/Paris", date: null });
    assert.deepEqual(appelsAgenda[0].corps?.end, { dateTime: "2030-06-14T12:15:00.000Z", timeZone: "Europe/Paris", date: null });

    // Un appel pose 18 h ; l'écran renvoie le même jour avec un autre texte : l'heure est gardée.
    await (await import("@/lib/commercial/appels")).noterAppel({ dossierId: d.id, issue: "A_RAPPELER", note: "", rappelLe: "2030-06-15T16:00:00.000Z" });
    await dossiers.modifierDossier(d.id, { prochaineAction: "Rappeler (après son devis)", prochaineActionDate: "2030-06-15" });
    assert.equal((await dossierDe(d.id)).prochaineActionDate?.toISOString(), "2030-06-15T16:00:00.000Z");
    appelsAgenda = [];
    await toutExecuter();
    assert.deepEqual(appelsAgenda.at(-1)?.corps?.start, { dateTime: "2030-06-15T16:00:00.000Z", timeZone: "Europe/Paris", date: null });

    // Un autre jour choisi sans heure : l'événement redevient « toute la journée » (l'heure effacée chez Google).
    await dossiers.modifierDossier(d.id, { prochaineActionDate: "2030-06-16" });
    appelsAgenda = [];
    await toutExecuter();
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.id, a.corps?.start]), [["PATCH", id, { date: "2030-06-16", dateTime: null, timeZone: null }]]);
  });

  test("planifier un rappel hors des listes (lead sans suite, dossier perdu) : événement direct comme avant, et le texte le dit", async () => {
    const zoe = await lead("Zoé", "Perdue", { statut: "PERDU", motifPerte: "DELAI" });
    appelsAgenda = [];
    const p = await planification.planifierAction({ leadId: zoe.id, nom: "Zoé Perdue", action: "Rappeler", debut: new Date("2030-09-12T12:00:00.000Z") });
    assert.equal(p.texte, "Planifié : Rappeler pour Zoé Perdue, 12 septembre 2030 à 14:00. Inscrit dans Google Calendar. Ce contact est sans suite : ce rappel n'est pas dans les listes du CRM et n'aura pas de notification. Événement à part : replanifier en crée un autre.");
    assert.deepEqual([p.rappel, Boolean(p.agenda), p.fin], [false, true, "2030-09-12T12:30:00.000Z"]);
    assert.deepEqual(appelsAgenda.map((a) => [a.methode, a.corps?.summary]), [["POST", "Rappeler — Zoé Perdue"]]);
    assert.equal(await prisma.tache.count({ where: { cle: { startsWith: `rappel-push:LEAD:${zoe.id}:` } } }), 0, "pas de notification promise");

    const perdu = await prisma.dossier.create({ data: { ...base, clientNom: "Aline Perdue", clientTelephone: "0600000902", etape: "PERDU" } });
    const q = await planification.planifierAction({ dossierId: perdu.id, nom: "Aline Perdue", action: "Rappeler dans 6 mois", debut: new Date("2031-03-12T09:00:00.000Z") });
    assert.match(q.texte, /Inscrit dans Google Calendar\. Ce dossier est perdu : ce rappel n'est pas dans les listes du CRM et n'aura pas de notification\./);
    assert.equal(q.rappel, false);

    // Un rappel suivi : 15 minutes, la fin rendue le dit.
    const anouk = await lead("Anouk", "Suivie");
    const suivi = await planification.planifierAction({ leadId: anouk.id, nom: "Anouk Suivie", action: "Rappeler", debut: new Date("2030-09-12T12:00:00.000Z"), dureeMinutes: 45 });
    assert.deepEqual([suivi.rappel, suivi.fin], [true, "2030-09-12T12:15:00.000Z"]);
  });

  test("dossier ouvert depuis l'écran Dossiers avec son lead : le rappel passe sur le dossier ; archivé puis restauré, l'agenda suit le lead", async () => {
    const dossiers = await import("@/lib/dossiers/dossiers");
    const archivage = await import("@/lib/dossiers/archivage");
    const basile = await lead("Basile", "Ouverture", { ville: "Sète" });
    const rappel = new Date(Math.floor(dans(6 * JOUR).getTime() / 60_000) * 60_000 + 7 * 60_000);
    await entrants.modifierEntrant(basile.id, { rappelLe: rappel.toISOString() });
    await toutExecuter();
    const idLead = (await leadDe(basile.id)).agendaEvenementId!;
    assert.ok(idLead);

    appelsAgenda = [];
    const dossierId = await dossiers.creerDossier({ clientNom: "Basile Ouverture", clientVille: "Sète", clientTelephone: basile.telephone, leadId: basile.id } as Parameters<typeof dossiers.creerDossier>[0], []);
    const d = await dossierDe(dossierId);
    assert.deepEqual([d.prochaineAction, d.prochaineActionDate?.toISOString(), (await leadDe(basile.id)).rappelLe], ["Rappeler", rappel.toISOString(), null]);
    await toutExecuter();
    assert.ok(appelsDe("DELETE").some((a) => a.id === idLead), "l'événement du lead part");
    assert.ok(appelsDe("POST").some((a) => String(a.corps?.description).includes(`/dossiers?dossier=${dossierId}`)), "celui du dossier se pose");

    // Archivé : le dossier perd son événement ; le lead revient dans les listes et reçoit un rappel à lui.
    await archivage.archiverDossier(dossierId, "Essai");
    await entrants.modifierEntrant(basile.id, { rappelLe: dans(7 * JOUR).toISOString() });
    appelsAgenda = [];
    await toutExecuter();
    const idLeadRevenu = (await leadDe(basile.id)).agendaEvenementId;
    assert.ok(idLeadRevenu && evenements.has(idLeadRevenu));
    assert.equal((await prisma.dossier.findFirstOrThrow({ where: { id: dossierId, archiveLe: { not: null } } })).agendaEvenementId, null);

    // Restauré : le lead ressort des listes, son événement part ; celui du dossier revient.
    await archivage.restaurerDossier(dossierId);
    appelsAgenda = [];
    await toutExecuter();
    assert.ok(appelsDe("DELETE").some((a) => a.id === idLeadRevenu));
    assert.equal((await leadDe(basile.id)).agendaEvenementId, null);
    assert.ok((await dossierDe(dossierId)).agendaEvenementId);
  });

  test("appel sans réponse : sur un dossier clos, le résumé dit que le rappel n'est pas suivi ; sans lead, la raison compte les appels du dossier", async () => {
    const appels = await import("@/lib/commercial/appels");
    const clos = await prisma.dossier.create({ data: { ...base, clientNom: "Colette Close", clientTelephone: "0600000903", etape: "ENCAISSE" } });
    const suite = await appels.noterAppel({ dossierId: clos.id, issue: "PAS_DE_REPONSE", note: "" });
    assert.match(suite.resume, /^Appel noté\. Rappel .*\. Son dossier est encaissé : ce rappel n'est ni dans l'agenda ni notifié \(ouvre-lui un nouveau dossier pour ce projet pour le suivre\)\.$/);

    const sansLead = await prisma.dossier.create({ data: { ...base, clientNom: "Damien Sanslead", clientTelephone: "0600000904", etape: "QUALIFICATION" } });
    await appels.noterAppel({ dossierId: sansLead.id, issue: "PAS_DE_REPONSE", note: "", rappelLe: dans(JOUR).toISOString() });
    await appels.noterAppel({ dossierId: sansLead.id, issue: "PAS_DE_REPONSE", note: "", rappelLe: dans(2 * JOUR).toISOString() });
    assert.equal((await rappels.lireRappel({ type: "DOSSIER", id: sansLead.id }))?.raison, "2 appels sans réponse · Recouvrement de cuisine");
  });

  test("anonymisation RGPD : l'événement du rappel quitte l'agenda, le rappel est effacé, la notification se tait", async () => {
    const anonymisation = await import("@/lib/rgpd/anonymisation");
    const client = await prisma.client.create({ data: { nom: "Élise Effacee", prenom: "Élise", source: "ENTRANT", premierContactLe: new Date() } });
    const elise = await lead("Élise", "Effacee", { clientId: client.id });
    const rappel = new Date(Math.floor(dans(2 * JOUR).getTime() / 1000) * 1000);
    await entrants.modifierEntrant(elise.id, { rappelLe: rappel.toISOString() });
    await toutExecuter();
    const id = (await leadDe(elise.id)).agendaEvenementId!;
    assert.ok(evenements.has(id));

    await prisma.$transaction((tx) => anonymisation.anonymiserDansTransaction(tx, client.id, { decidePar: "essai" }), { timeout: 60_000 });
    appelsAgenda = [];
    await toutExecuter();
    assert.ok(appelsDe("DELETE").some((a) => a.id === id), "l'événement (nom, numéro) est supprimé de Google");
    const relu = await leadDe(elise.id);
    assert.deepEqual([relu.rappelLe, relu.agendaEvenementId], [null, null]);
    alertes = [];
    assert.equal((await rappels.notifierRappel({ type: "LEAD", id: elise.id, rappelLe: rappel.toISOString() })).notifie, false);
    assert.equal(alertes.length, 0);
  });
});
