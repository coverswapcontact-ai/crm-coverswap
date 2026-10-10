import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-vues-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25 — ce que lisent les écrans : la liste (une ligne par client, filtres, recherche), le fil (canaux réunis,
 * message prêt en bulle préparée), la file « Un par un » (réponses, messages dus, appels, propositions, dans cet ordre),
 * la route de fin d'appel (la feuille de toujours, qui rend le message préparé), le dossier « Démo Messagerie ».
 * Noms et numéros fictifs (plage 06 39 98).
 */

let prisma: typeof import("@/lib/prisma").default;
let vues: typeof import("./vues");
let analyse: typeof import("./analyse");
let gestes: typeof import("./gestes");
let suivis: typeof import("./suivis");
let alertes: typeof import("./alertes");
let horaires: typeof import("./horaires");

let horloge: Date;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  vues = await import("./vues");
  analyse = await import("./analyse");
  gestes = await import("./gestes");
  suivis = await import("./suivis");
  alertes = await import("./alertes");
  horaires = await import("./horaires");
  alertes.definirAlertesEssai(() => undefined);
  const parametres = await import("@/lib/parametres/service");
  suivis.oublierLancement();
  await parametres.enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
  // Un mardi 10 h après maintenant : l'horloge des essais (horaires de travail).
  let jour = horaires.momentParis(new Date(Date.now() + 86_400_000)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
});

after(async () => {
  alertes.definirAlertesEssai(null);
  await prisma.$disconnect();
});

describe("Mission 25 — liste, fil, file du jour", () => {
  let premier = "";
  let second = "";
  test("deux nouveaux leads : deux conversations, A1 à envoyer, filtres et recherche", async () => {
    const a = await prisma.lead.create({ data: { prenom: "Aline", nom: "Fiction", telephone: "0639980023", ville: "Lattes", source: "META_ADS" } });
    const b = await prisma.lead.create({ data: { prenom: "Bruno", nom: "Fiction", telephone: "0639980024", ville: "Sète", source: "SITE_DEVIS" } });
    premier = (await suivis.suiviPour({ leadId: a.id }))!.id;
    second = (await suivis.suiviPour({ leadId: b.id }))!.id;
    await analyse.analyserSuivi(premier, horloge);
    await analyse.analyserSuivi(second, horloge);
    const { lignes, compteurs } = await vues.listerConversations({}, horloge);
    assert.ok(lignes.some((l) => l.nom === "Aline Fiction" && l.aEnvoyer === 1 && l.initiales === "AF"));
    assert.equal(compteurs.A_ENVOYER >= 2, true);
    assert.deepEqual((await vues.listerConversations({ recherche: "sete" }, horloge)).lignes.map((l) => l.nom), ["Bruno Fiction"], "recherche par ville, sans accent");
    assert.deepEqual((await vues.listerConversations({ recherche: "06 39 98 00 23" }, horloge)).lignes.map((l) => l.nom), ["Aline Fiction"], "recherche par numéro");
  });

  test("le fil : le message prêt en bulle préparée, avec la mention STOP du premier SMS ; puis la bulle envoyée", async () => {
    const fil = await vues.filDuSuivi(premier);
    const prepare = fil.find((e) => e.genre === "PREPARE");
    assert.ok(prepare && prepare.genre === "PREPARE");
    assert.match(prepare.message.texte, /STOP pour ne plus recevoir nos SMS\.$/);
    await gestes.confirmerEnvoi(prepare.message.id, {}, new Date(horloge.getTime() + 60_000));
    const apres = await vues.filDuSuivi(premier);
    assert.ok(apres.some((e) => e.genre === "BULLE" && e.sens === "TOI" && e.code === "A1"));
    assert.ok(!apres.some((e) => e.genre === "PREPARE"));
  });

  test("la file du jour : la réponse au client d'abord, puis les messages dus, puis les appels", async () => {
    await gestes.rapporterReponse({ suiviId: premier, texte: "Je suis dispo jeudi après-midi pour en parler", recuLe: new Date(horloge.getTime() + 5 * 60_000) }, new Date(horloge.getTime() + 6 * 60_000));
    const { cartes } = await vues.fileDuJour(new Date(horloge.getTime() + 7 * 60_000));
    const genres = cartes.map((c) => c.genre);
    assert.equal(genres[0], "REPONSE");
    assert.equal(cartes[0].suiviId, premier);
    assert.match(cartes[0].message?.texte ?? "", /^C'est noté, je vous rappelle jeudi/);
    assert.ok(cartes[0].dernierMessageClient?.texte.includes("dispo jeudi"));
    const ordre = (g: string) => genres.indexOf(g as never);
    if (ordre("MESSAGE") >= 0 && ordre("APPEL") >= 0) assert.ok(ordre("MESSAGE") < ordre("APPEL"));
    assert.ok(cartes.some((c) => c.genre === "MESSAGE" && c.suiviId === second), "A1 de Bruno, dû");
  });

  test("la route de fin d'appel : l'appel noté par la fonction de toujours, le message préparé en retour (A2)", async () => {
    const { POST } = await import("@/app/api/messagerie/apres-appel/route");
    const { NextRequest } = await import("next/server");
    const lead = (await prisma.suivi.findUniqueOrThrow({ where: { id: second } })).leadId!;
    const reponse = await POST(new NextRequest("http://localhost:3001/api/messagerie/apres-appel", { method: "POST", body: JSON.stringify({ leadId: lead, issue: "PAS_DE_REPONSE" }), headers: { "content-type": "application/json" } }));
    const corps = (await reponse.json()) as { resume: string; messagerie: { code: string } | null; sms: unknown; tentatives: number };
    assert.equal(reponse.status, 200);
    assert.equal(corps.sms, null, "plus l'ancien écran SMS : le message de la messagerie le remplace");
    assert.equal(corps.tentatives, 1);
    assert.match(corps.resume, /Appel noté/);
    assert.equal(corps.messagerie?.code ?? "A2", "A2");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead } })).tentatives, 1);
  });
});

describe("Mission 25 — le dossier « Démo Messagerie »", () => {
  test("créé à la demande, numéro de fiction, A1 prêt ; recréé : l'ancien archivé, rien ne se supprime", async () => {
    const demo = await import("./demo");
    const premier = await demo.creerDemoMessagerie(horloge);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: premier.leadId } });
    assert.deepEqual([lead.prenom, lead.nom, lead.telephone], ["Démo", "Messagerie", "06 39 98 00 18"]);
    const suivi = (await suivis.suiviPour({ leadId: lead.id }))!;
    await analyse.analyserSuivi(suivi.id, horloge);
    assert.ok((await prisma.messagePrepare.findMany({ where: { suiviId: suivi.id } })).some((m) => m.code === "A1" && m.statut === "A_ENVOYER"));
    const second = await demo.creerDemoMessagerie(new Date(horloge.getTime() + 60_000));
    assert.equal(second.archives, 1);
    assert.ok((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).archiveLe, "l'ancienne démo est archivée");
    assert.ok((await prisma.messagePrepare.findMany({ where: { suiviId: suivi.id } })).every((m) => m.statut !== "A_ENVOYER"));
  });
});
