import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-lot7-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25 (lot 7) — « une conversation entière rapportée depuis Claude ; le brief arrive avec les bons chiffres » :
 * les neuf outils MCP de la messagerie enchaînés sur un lead fictif (file du jour, envoi confirmé, réponse du client et
 * réponse préparée, report, refus, note « signe dans 2 semaines », pause, « Où on en est »), la suite d'un appel noté
 * par Claude (le message de la messagerie, plus l'ancien SMS), le brief de 8 h, le tableau de bord de la semaine et
 * l'alerte STOP du lundi. Rien n'est envoyé. Clients fictifs (plage 06 39 98).
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;

let prisma: typeof import("@/lib/prisma").default;
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let analyse: typeof import("./analyse");
let suivis: typeof import("./suivis");
let horaires: typeof import("./horaires");
let session: import("@/lib/assistant/execution").Session;

const alertes: import("./alertes").AlerteMessagerie[] = [];
let horloge: Date;
const a = (minutes: number) => new Date(horloge.getTime() + minutes * 60_000);

async function appeler(nom: string, entree: Record<string, unknown>, maintenant: Date): Promise<ResultatOutil> {
  const outil = catalogue.outilParNom(nom);
  assert.ok(outil, `outil inconnu : ${nom}`);
  return execution.executerOutil(outil, { commande: `essai ${nom}`, ...entree }, session, maintenant);
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  analyse = await import("./analyse");
  suivis = await import("./suivis");
  horaires = await import("./horaires");
  (await import("./alertes")).definirAlertesEssai((alerte) => alertes.push(alerte));
  suivis.oublierLancement();
  await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
  let jour = horaires.momentParis(new Date(Date.now() + 86_400_000)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local", maintenant: horloge });
});

after(async () => {
  (await import("./alertes")).definirAlertesEssai(null);
  await prisma.$disconnect();
});

let zelie = { leadId: "", suiviId: "" };

describe("Mission 25 (lot 7) — une conversation entière rapportée depuis Claude", () => {
  test("file du jour → envoi confirmé → réponse du client et réponse préparée → report → refus → note → pause → « Où on en est »", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Zélie", nom: "Fiction", telephone: "0639980080", ville: "Lattes", source: "META_ADS", typeProjet: "CUISINE" } });
    const suiviId = (await suivis.suiviPour({ leadId: lead.id }))!.id;
    zelie = { leadId: lead.id, suiviId };
    await analyse.analyserSuivi(suiviId, horloge);

    const file = await appeler("file_du_jour", {}, a(1));
    assert.match(file.texte, /Message à envoyer — Zélie Fiction/);
    const a1 = await prisma.messagePrepare.findFirstOrThrow({ where: { suiviId, code: "A1" } });
    assert.ok(file.texte.includes(`id ${a1.id}`), file.texte);
    assert.match(file.texte, /Rien n'est envoyé d'ici/);

    const envoi = await appeler("confirmer_envoi", { cible: { leadId: lead.id }, heure: a(2).toISOString() }, a(3));
    assert.match(envoi.texte, /^Noté : A1 · Nouveau lead envoyé à Zélie Fiction à 10 h 02\. La messagerie prépare la suite\.$/);
    assert.equal((await prisma.messagePrepare.findUniqueOrThrow({ where: { id: a1.id } })).statut, "ENVOYE");

    const reponse = await appeler("noter_reponse_client", { cible: { leadId: lead.id }, texte: "Je suis dispo jeudi après-midi pour en parler", heure: a(10).toISOString() }, a(11));
    assert.match(reponse.texte, /^Réponse de Zélie Fiction notée \(reçue à 10 h 10\)\./);
    assert.match(reponse.texte, /Réponse préparée : E3 · .*« C'est noté, je vous rappelle jeudi/);
    const proposee = await appeler("reponse_proposee", { cible: { leadId: lead.id } }, a(12));
    assert.match(proposee.texte, /Le client a écrit : « Je suis dispo jeudi après-midi/);
    assert.match(proposee.texte, /Réponse préparée pour Zélie Fiction : E3/);

    const report = await appeler("reporter_message", { cible: { leadId: lead.id }, quand: "1H" }, a(13));
    assert.match(report.texte, /^E3 · .* pour Zélie Fiction reporté au /);
    const refus = await appeler("non_envoye", { cible: { leadId: lead.id }, raison: "DEJA_FAIT_TELEPHONE" }, a(14));
    assert.match(refus.texte, /non envoyé \(déjà fait par téléphone\)\.$/);

    const note = await appeler("noter_note", { cible: { leadId: lead.id }, texte: "Intéressée, veut du chêne clair, signe dans 2 semaines" }, a(20));
    assert.match(note.texte, /^Note ajoutée pour Zélie Fiction\./);
    assert.match(note.texte, /Lue : Note rangée : rappel le \d\d\/\d\d, relances en pause, « comme convenu » préparé pour ce jour-là ; teinte chêne clair\./);
    const faits = JSON.parse((await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })).faits) as { teintesEvoquees: string[] };
    assert.ok(faits.teintesEvoquees.some((t) => /chêne clair/i.test(t)), JSON.stringify(faits));

    const jusqua = horaires.momentParis(new Date(horloge.getTime() + 20 * 86_400_000)).jour;
    const pause = await appeler("pause_client", { cible: { leadId: lead.id }, jusqua, motif: "vacances" }, a(21));
    assert.match(pause.texte, /^Relances de Zélie Fiction en pause jusqu'au /);
    assert.ok((await prisma.suivi.findUniqueOrThrow({ where: { id: suiviId } })).pauseJusquau);

    const ouEnEst = await appeler("ou_en_est", { cible: { leadId: lead.id } }, a(22));
    assert.match(ouEnEst.texte, /^Où on en est avec Zélie Fiction :\n📍 .+\n👤 .+\n➡️ .+/);
    assert.match(ouEnEst.texte, /Journal \(le plus récent en haut\) :\n- /);
    assert.ok(!(await prisma.sms.findMany({ where: { sens: "SORTANT" } })).some((s) => s.fournisseur !== "rapporte"), "rien n'est parti par un fournisseur");
  });

  test("un message ambigu n'est jamais choisi à la place de Lucas ; une cible inconnue est refusée", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Yves", nom: "Fiction", telephone: "0639980081", ville: "Pérols", source: "META_ADS" } });
    const suiviId = (await suivis.suiviPour({ leadId: lead.id }))!.id;
    await analyse.analyserSuivi(suiviId, horloge);
    await prisma.messagePrepare.create({ data: { suiviId, code: "Q6", cle: `essai:${lead.id}`, canal: "SMS", destinataire: "+33639980081", texte: "Bien reçu, je regarde et je reviens vers vous très vite.", texteValide: "Bien reçu, je regarde et je reviens vers vous très vite.", variante: "defaut", prevuLe: horloge, statut: "A_ENVOYER", mode: "VALIDATION", reponse: true } });
    const r = await appeler("confirmer_envoi", { cible: { leadId: lead.id } }, a(30));
    assert.match(r.texte, /^Yves Fiction a 2 messages en attente, je ne choisis pas à ta place :/);
    assert.equal(await prisma.messagePrepare.count({ where: { suiviId, statut: "ENVOYE" } }), 0);
    // L'outil ne lève pas : il rend l'échec en texte, que Claude lit à Lucas.
    assert.match((await appeler("ou_en_est", { cible: { nom: "Personne Inconnue Nulle Part" } }, a(31))).texte, /Aucun contact ne correspond à « Personne Inconnue Nulle Part »/);
  });

  test("« noter_appel » depuis Claude : la messagerie prépare la suite (A2), l'ancien SMS proposé n'est plus rendu", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Wanda", nom: "Fiction", telephone: "0639980082", ville: "Mauguio", source: "META_ADS", typeProjet: "SDB" } });
    const r = await appeler("noter_appel", { leadId: lead.id, issue: "PAS_DE_REPONSE" }, a(40));
    assert.match(r.texte, /Préparé par la messagerie : A2 · .*« Bonjour Wanda, je viens d'essayer de vous joindre pour votre projet de salle de bain\./);
    assert.ok(!/SMS proposé \(/.test(r.texte), r.texte);
    assert.equal((r.donnees as { sms: unknown }).sms, null);
  });
});

describe("Mission 25 (lot 7) — le brief de 8 h, le tableau de bord, l'alerte STOP", () => {
  test("le brief : les messages du jour, les réponses, les rappels promis ; la notification du matin le porte en tête", async () => {
    const { briefDuJour } = await import("./brief");
    const huit = horaires.instantParis(horaires.momentParis(a(60 * 22)).jour, 8 * 60 + 5);
    const brief = await briefDuJour(huit);
    assert.ok(brief.messages >= 1, JSON.stringify(brief));
    assert.match(brief.texte ?? "", /^Aujourd'hui : \d+ messages? à envoyer/);
    const matin = await import("@/lib/a-faire/matin");
    matin.oublierEnvoiDuMatin();
    const notification = await matin.notifierTachesDuMatin(huit);
    assert.equal(notification.envoyee, true, JSON.stringify(notification));
    assert.match(notification.texte ?? "", /^Aujourd'hui : /);
  });

  test("le tableau de la semaine : A1 envoyé, une réponse du client en quelques minutes ; le coût de l'IA du mois", async () => {
    const { tableauMessagerie } = await import("./tableau");
    const tableau = await tableauMessagerie(a(60 * 5));
    assert.equal(tableau.semaines.length, 4);
    const cetteSemaine = tableau.semaines[0];
    // « Préparés » se lit à la date de création (l'heure réelle des essais, avant l'horloge du scénario) : sur les quatre semaines.
    assert.ok(cetteSemaine.envoyes >= 1 && tableau.semaines.reduce((t, s) => t + s.prepares, 0) >= cetteSemaine.envoyes, JSON.stringify(tableau.semaines));
    assert.ok(cetteSemaine.reportes >= 1 && cetteSemaine.refuses >= 1, "le report et le refus de la conversation");
    const a1 = tableau.parMessage.find((m) => m.code === "A1");
    assert.ok(a1 && a1.envoyes >= 1 && a1.repondus >= 1, JSON.stringify(tableau.parMessage));
    assert.ok(a1.delaiMoyenHeures !== null && a1.delaiMoyenHeures < 1, "Zélie a répondu 8 minutes après A1");
    assert.equal(typeof tableau.coutIaMois, "number");
    assert.equal(tableau.budgetIa, 10);
  });

  test("l'alerte STOP : le lundi à partir de 9 h, quand la semaine passée dépasse 3 % ; rien avant 9 h", async () => {
    const { debutDeSemaine, surveillerStop } = await import("./tableau");
    await prisma.suivi.update({ where: { id: zelie.suiviId }, data: { stopLe: a(30) } });
    const lundi = new Date(debutDeSemaine(new Date(horloge.getTime() + 7 * 86_400_000)).getTime());
    assert.equal(await surveillerStop(new Date(lundi.getTime() + 8 * 3_600_000)), false, "avant 9 h");
    alertes.length = 0;
    assert.equal(await surveillerStop(new Date(lundi.getTime() + 9.5 * 3_600_000)), true);
    const alerte = alertes.find((x) => x.origine === "messagerie-stop");
    assert.ok(alerte);
    assert.match(alerte.texte, /^1 STOP pour 1 clients contactés par SMS \(100 %, seuil 3 %\)/);
  });
});
