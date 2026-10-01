import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 14 (29/09/2026), partie 9 — restes. L'API Google Calendar n'est pas activée dans le projet Google Cloud
 * (403 `accessNotConfigured` alors que la portée agenda est accordée) : la tâche d'agenda ATTEND (6 h) au lieu
 * d'échouer, Paramètres → Connexions, `sante_systeme` et « planifier » le disent, et tout se pose dès que l'API
 * répond ; la migration remet en attente les tâches déjà en échec pour cette raison. Google est simulé (aucun appel
 * réseau). Noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let google: typeof import("@/lib/google/connexion");
let rappels: typeof import("@/lib/agenda/rappels");
let planification: typeof import("@/lib/agenda/planification");
let entrants: typeof import("@/lib/prospects/entrants");
let executeur: typeof import("@/lib/taches/executeur");
let execution: typeof import("@/lib/assistant/execution");
let lecture: typeof import("@/lib/assistant/outils/lecture");
let migration: typeof import("@/lib/base/migrations/mission-14-partie-9");

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
const API_AGENDA = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MESSAGE_GOOGLE = "Google Calendar API has not been used in project 123456789 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123456789 then retry.";
/** La réponse de Google telle qu'elle arrive quand l'API n'est pas activée dans le projet. */
const REFUS_API = {
  error: {
    code: 403,
    message: MESSAGE_GOOGLE,
    errors: [{ message: MESSAGE_GOOGLE, domain: "usageLimits", reason: "accessNotConfigured", extendedHelp: "https://console.developers.google.com" }],
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com", metadata: { service: "calendar-json.googleapis.com", consumer: "projects/123456789" } }],
  },
};

let apiActivee = false;
let appelsAgenda: { methode: string; id: string | null }[] = [];
let rangEvenement = 0;
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });

async function fauxGoogle(url: string, init: RequestInit = {}): Promise<Response> {
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const parametres = new URLSearchParams(String(init.body ?? ""));
    if (parametres.get("grant_type") === "authorization_code") {
      return json({ access_token: "acces-essai", refresh_token: "renouvellement-essai", expires_in: 3600, scope: ["openid", "email", ...Object.values(google.PORTEES_GOOGLE)].join(" ") });
    }
    return json({ access_token: "acces-essai", expires_in: 3600 });
  }
  if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ email: "agenda.essai@example.test" });
  if (url.startsWith(API_AGENDA)) {
    const methode = init.method ?? "GET";
    const id = url.length > API_AGENDA.length ? decodeURIComponent(url.slice(API_AGENDA.length + 1)) : null;
    appelsAgenda.push({ methode, id });
    if (!apiActivee) return json(REFUS_API, 403);
    if (methode === "POST") return json({ id: `evt-${++rangEvenement}`, htmlLink: "https://calendar.google.com/event?eid=essai" });
    if (methode === "PATCH") return json({ id, htmlLink: "https://calendar.google.com/event?eid=essai" });
    return new Response(null, { status: 204 });
  }
  throw new Error(`Appel Google inattendu : ${init.method ?? "GET"} ${url}`);
}

/** L'exécuteur, tour après tour, tant qu'il reste des tâches dues. */
async function toutExecuter() {
  for (let tour = 0; tour < 10; tour++) if ((await executeur.executerTour(new Date())) === 0) return;
}

let numero = 0;
const lead = (prenom: string, nom: string) => prisma.lead.create({ data: { prenom, nom, telephone: `+336123900${String(++numero).padStart(2, "0")}`, ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE" } });
const leadDe = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });
const tacheAgenda = (leadId: string) => prisma.tache.findUniqueOrThrow({ where: { cle: `agenda-rappel:LEAD:${leadId}` } });
const outil = (definition: unknown) => definition as import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;
const session = () => execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai" });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
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
  planification = await import("@/lib/agenda/planification");
  entrants = await import("@/lib/prospects/entrants");
  executeur = await import("@/lib/taches/executeur");
  execution = await import("@/lib/assistant/execution");
  lecture = await import("@/lib/assistant/outils/lecture");
  migration = await import("@/lib/base/migrations/mission-14-partie-9");
  await (await import("@/lib/base/preparation")).preparerBase();
  google.definirTransportGoogleEssai(fauxGoogle);
  rappels.definirAlerteurRappelsEssai(async () => [{ canal: "ntfy", ok: true, configure: true }]);
  rappels.enregistrerTachesRappels();
  // Google connecté, portée agenda accordée : c'est l'API du projet Google Cloud qui manque.
  await google.terminerConnexion({ code: "code-essai", etat: "etat", etatAttendu: "etat", erreur: null });
});
after(async () => {
  google.definirTransportGoogleEssai(null);
  rappels.definirAlerteurRappelsEssai(null);
  await prisma.$disconnect();
});

describe("l'API Google Calendar n'est pas activée dans le projet Google Cloud", () => {
  test("403 accessNotConfigured : la tâche attend 6 h (pas d'échec) ; Paramètres, la santé et « planifier » le disent ; API activée + Reconnecter → l'événement se pose", async () => {
    const avant = await google.etatConnexionGoogle();
    assert.deepEqual([avant.agenda, avant.agendaApiActivee, avant.agendaApiMessage], [true, true, null], "portée accordée, rien à dire tant qu'aucune tâche n'a buté");

    const alice = await lead("Alice", "Calendrier");
    await entrants.modifierEntrant(alice.id, { rappelLe: new Date(Date.now() + 2 * JOUR).toISOString() });
    appelsAgenda = [];
    await toutExecuter();
    const attente = await tacheAgenda(alice.id);
    assert.equal(attente.statut, "EN_ATTENTE", "en attente, pas en échec définitif");
    assert.equal(attente.tentatives, 0, "l'essai n'est pas compté");
    assert.match(attente.derniereErreur ?? "", /^\[en attente\] Google : API Google Calendar non activée dans le projet Google Cloud \(accessNotConfigured\) : à activer dans la console Google Cloud → API et services → Google Calendar API, puis tout repart seul\. Réponse de Google : Google Calendar API has not been used in project 123456789/);
    assert.ok(attente.prochainEssaiLe.getTime() > Date.now() + 5 * HEURE, "6 h entre deux essais, pas un quart d'heure");
    assert.ok(attente.prochainEssaiLe.getTime() <= Date.now() + 6 * HEURE + 60_000);
    assert.deepEqual(
      appelsAgenda.map((a) => a.methode),
      ["POST"],
      "un seul essai chez Google"
    );
    assert.equal((await leadDe(alice.id)).agendaEvenementId, null);
    assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "google-coupe" } }), 0, "pas d'alerte « Google coupé » : ce n'est pas une coupure");

    // L'état exposé (Paramètres → Connexions) : le droit est là, l'API non, avec ce que Google a répondu.
    const etat = await google.etatConnexionGoogle();
    assert.deepEqual([etat.agenda, etat.agendaApiActivee, etat.agendaApiMessage], [true, false, MESSAGE_GOOGLE]);

    // sante_systeme : le bloc Google le dit, sans lister de tâche en échec.
    const sante = await lecture.santeSysteme();
    assert.deepEqual(sante.agendaApi, { activee: false, message: MESSAGE_GOOGLE });
    assert.equal(sante.taches.enEchec.length, 0);
    const s = await session();
    const texte = (await execution.executerOutil(outil((await import("@/lib/assistant/outils/etat")).outilEtatCrm), { partie: "SANTE" }, s)).texte;
    assert.match(texte, /^Aucune tâche en échec\.$/m);
    assert.match(texte, /^Google Calendar : l'API n'est pas activée dans le projet Google Cloud \(console Google Cloud → API et services → Google Calendar API\) ; les rappels attendent et s'inscriront seuls une fois l'API activée\. Réponse de Google : Google Calendar API has not been used in project 123456789/m);
    assert.doesNotMatch(texte, /Google : rien à signaler/);

    // « planifier » ne promet pas l'agenda : le rappel est dans le CRM, la tâche attend.
    const bruno = await lead("Bruno", "Planifie");
    const p = await planification.planifierAction({ leadId: bruno.id, nom: "Bruno Planifie", action: "Rappeler", debut: new Date(Date.now() + 3 * JOUR) });
    assert.match(p.texte, /Pas inscrit dans Google Calendar : l'API Google Calendar n'est pas activée dans le projet Google Cloud \(Paramètres → Connexions\) ; le rappel est dans le CRM et s'inscrira dans Google Calendar dès que ce sera fait\.$/);
    assert.equal(p.rappel, true);
    await toutExecuter();
    assert.equal((await tacheAgenda(bruno.id)).statut, "EN_ATTENTE");

    // Lucas active l'API, puis « Reconnecter » : le retour de Google réveille les tâches en attente, tout se pose.
    apiActivee = true;
    appelsAgenda = [];
    await google.terminerConnexion({ code: "code-essai", etat: "etat", etatAttendu: "etat", erreur: null });
    assert.ok((await tacheAgenda(alice.id)).prochainEssaiLe.getTime() <= Date.now(), "réveillée par la reconnexion (préfixe « [en attente] Google »)");
    await toutExecuter();
    assert.deepEqual([(await tacheAgenda(alice.id)).statut, (await tacheAgenda(bruno.id)).statut], ["TERMINEE", "TERMINEE"]);
    assert.equal(appelsAgenda.filter((a) => a.methode === "POST").length, 2);
    assert.ok((await leadDe(alice.id)).agendaEvenementId);
    const apres = await google.etatConnexionGoogle();
    assert.deepEqual([apres.agendaApiActivee, apres.agendaApiMessage], [true, null], "plus aucune tâche n'attend : rien à dire");
    assert.match((await execution.executerOutil(outil((await import("@/lib/assistant/outils/etat")).outilEtatCrm), { partie: "SANTE" }, s)).texte, /^Google : rien à signaler\.$/m);
  });

  test("appelGoogle : « SERVICE_DISABLED » seul attend aussi (6 h) ; un autre 403 reste définitif ; le nom de l'API suit l'adresse", async () => {
    const { AttenteExterne, ErreurDefinitive } = await import("@/lib/taches/registre");
    let corps: unknown = { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } };
    google.definirTransportGoogleEssai(async (url, init) => (url.startsWith("https://oauth2.googleapis.com/token") ? fauxGoogle(url, init) : json(corps, 403)));
    try {
      await assert.rejects(
        google.appelGoogle("https://gmail.googleapis.com/gmail/v1/users/me/messages", { portee: google.PORTEES_GOOGLE.GMAIL_MODIFIER }),
        (erreur: unknown) =>
          erreur instanceof google.ApiGoogleNonActivee &&
          erreur instanceof AttenteExterne &&
          erreur.api === "Gmail" &&
          erreur.detail === null &&
          erreur.reprendreDansMs === 6 * HEURE &&
          erreur.message === "Google : API Gmail non activée dans le projet Google Cloud (accessNotConfigured) : à activer dans la console Google Cloud → API et services → Gmail API, puis tout repart seul."
      );
      corps = { error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } };
      await assert.rejects(
        google.appelGoogle("https://www.googleapis.com/drive/v3/files", { portee: google.PORTEES_GOOGLE.DRIVE }),
        (erreur: unknown) => erreur instanceof ErreurDefinitive && !(erreur instanceof AttenteExterne) && erreur.message === "Accès refusé par Google (insufficientPermissions)."
      );
    } finally {
      google.definirTransportGoogleEssai(fauxGoogle);
    }
    assert.deepEqual(
      ["https://www.googleapis.com/calendar/v3/calendars/primary/events/abc", "https://gmail.googleapis.com/gmail/v1/users/me/messages", "https://www.googleapis.com/upload/drive/v3/files", "https://www.googleapis.com/drive/v3/files/x", "https://example.googleapis.com/autre"].map(google.nomApiGoogle),
      ["Google Calendar", "Gmail", "Google Drive", "Google Drive", "Google"]
    );
    assert.equal(await prisma.alerteEnvoi.count({ where: { origine: "google-coupe" } }), 0);
  });

  test("Gmail ou Drive non activée : la tâche en attente se lit aussi (Paramètres → Connexions, sante_systeme), sans toucher l'état de l'agenda", async () => {
    // Le message que l'exécuteur écrit pour une ApiGoogleNonActivee (« [en attente] » + le message de l'erreur, vérifié ci-dessus).
    const reponse = "Gmail API has not been used in project 123456789 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456789 then retry.";
    const tache = await prisma.tache.create({
      data: { type: "MAIL_RANGER", cle: "mail-ranger:essai-9-gmail", charge: "{}", demandeePar: "SYSTEME:essai", statut: "EN_ATTENTE", prochainEssaiLe: new Date(Date.now() + 6 * HEURE), derniereErreur: google.messageAttenteApiNonActivee("Gmail", reponse) },
    });
    const etat = await google.etatConnexionGoogle();
    assert.deepEqual([etat.agendaApiActivee, etat.agendaApiMessage, etat.autresApisNonActivees], [true, null, [{ api: "Gmail", message: reponse }]]);
    const sante = await lecture.santeSysteme();
    assert.deepEqual([sante.agendaApi, sante.autresApisNonActivees, sante.taches.enEchec.length], [{ activee: true, message: null }, [{ api: "Gmail", message: reponse }], 0]);
    const texte = (await execution.executerOutil(outil((await import("@/lib/assistant/outils/etat")).outilEtatCrm), { partie: "SANTE" }, await session())).texte;
    assert.match(texte, /^Gmail : l'API n'est pas activée dans le projet Google Cloud \(console Google Cloud → API et services → Gmail API\) ; les tâches attendent et repartiront seules une fois l'API activée\. Réponse de Google : Gmail API has not been used in project 123456789/m);
    assert.doesNotMatch(texte, /Google : rien à signaler|Google Calendar : l'API/);

    await prisma.tache.update({ where: { id: tache.id }, data: { statut: "TERMINEE", termineLe: new Date() } });
    assert.deepEqual((await google.etatConnexionGoogle()).autresApisNonActivees, [], "plus aucune tâche n'attend : rien à dire");
    assert.match((await execution.executerOutil(outil((await import("@/lib/assistant/outils/etat")).outilEtatCrm), { partie: "SANTE" }, await session())).texte, /^Google : rien à signaler\.$/m);
  });
});

describe("migration « agenda-rappels-en-attente-14-9 »", () => {
  test("remet en attente (6 h, sans compter d'essai) les tâches d'agenda en échec « accessNotConfigured », les autres ne bougent pas ; rejouable ; inscrite en dernier", async () => {
    const maintenant = new Date("2030-04-01T08:00:00.000Z");
    const base = { charge: JSON.stringify({ type: "LEAD", id: "essai" }), demandeePar: "SYSTEME:essai", termineLe: new Date(), tentatives: 1 };
    const enEchec = await prisma.tache.create({ data: { ...base, type: "AGENDA_RAPPEL", cle: "agenda-rappel:LEAD:essai-9-a", statut: "ECHEC_DEFINITIF", derniereErreur: "ErreurDefinitive: Accès refusé par Google (accessNotConfigured)." } });
    const autreRaison = await prisma.tache.create({ data: { ...base, type: "AGENDA_RAPPEL", cle: "agenda-rappel:LEAD:essai-9-b", statut: "ECHEC_DEFINITIF", derniereErreur: "ErreurDefinitive: Accès refusé par Google (insufficientPermissions)." } });
    const autreType = await prisma.tache.create({ data: { ...base, type: "DRIVE_MIROIR", cle: "drive:essai-9-c", statut: "ECHEC_DEFINITIF", derniereErreur: "ErreurDefinitive: Accès refusé par Google (accessNotConfigured)." } });
    const terminee = await prisma.tache.create({ data: { ...base, type: "AGENDA_RAPPEL", cle: "agenda-rappel:LEAD:essai-9-d", statut: "TERMINEE", derniereErreur: null } });

    assert.deepEqual(await migration.remettreEnAttenteAgenda(prisma, maintenant), { remisesEnAttente: 1 });
    const remise = await prisma.tache.findUniqueOrThrow({ where: { id: enEchec.id } });
    assert.deepEqual([remise.statut, remise.tentatives, remise.termineLe, remise.verrouJusqua, remise.prochainEssaiLe.toISOString()], ["EN_ATTENTE", 1, null, null, "2030-04-01T14:00:00.000Z"]);
    assert.equal(remise.derniereErreur, "[en attente] Google : API Google Calendar non activée dans le projet Google Cloud (accessNotConfigured) : à activer dans la console Google Cloud → API et services → Google Calendar API, puis tout repart seul.");
    for (const { id, statut } of [
      { id: autreRaison.id, statut: "ECHEC_DEFINITIF" },
      { id: autreType.id, statut: "ECHEC_DEFINITIF" },
      { id: terminee.id, statut: "TERMINEE" },
    ]) {
      assert.equal((await prisma.tache.findUniqueOrThrow({ where: { id } })).statut, statut);
    }
    // Paramètres le sait dès la migration (sans réponse de Google : l'ancienne erreur ne la gardait pas).
    const etat = await google.etatConnexionGoogle();
    assert.deepEqual([etat.agendaApiActivee, etat.agendaApiMessage], [false, null]);
    assert.equal((await lecture.santeSysteme()).taches.enEchec.some((t) => t.erreur?.includes("accessNotConfigured") && t.type === "AGENDA_RAPPEL"), false, "plus d'échec d'agenda pour cette raison");

    assert.deepEqual(await migration.remettreEnAttenteAgenda(prisma, maintenant), { remisesEnAttente: 0 }, "rejouée : rien à refaire");
    assert.deepEqual(await migration.migrationAgendaRappelsEnAttente14.executer(prisma), { remisesEnAttente: 0 });
    // Ordre relatif seulement (comme la partie 7) : chaque mission suivante ajoute sa migration à la fin.
    const noms = (await import("@/lib/base/migrations")).MIGRATIONS_DONNEES.map((m) => m.nom);
    assert.ok(noms.includes("agenda-rappels-en-attente-14-9"), noms.join(", "));
    assert.ok(noms.indexOf("agenda-rappels-en-attente-14-9") > noms.indexOf("agenda-des-rappels-14-7"), noms.join(", "));
  });
});
