import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m18-relecture-a-"));
// Vides, pas supprimées : Prisma reprendrait la valeur de .env.
for (const cle of ["NTFY_TOPIC", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY", "VAPID_PRIVATE_KEY", "META_ACCESS_TOKEN", "META_PIXEL_ID"]) process.env[cle] = "";
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 — relecture de la partie A. La demande d'avis n'ouvre jamais d'espace ; le filtre « Espaces » retrouve le
 * tri de l'ancien onglet (fait par le serveur, gardé par l'écran) ; le suivi des espaces lit les rendus et les envois du
 * lien d'une traite, bornés aux espaces lus ; plus aucun texte ne renvoie à l'écran retiré ; les pastilles du filtre
 * sont des boutons à `aria-pressed`. (L'ouverture automatique a ses tests dans dossiers/depuis-lead.test.ts.) Base
 * d'essai, noms fictifs, rien ne part.
 */

let prisma: typeof import("@/lib/prisma").default;
let dossiersLib: typeof import("@/lib/dossiers/dossiers");
let liens: typeof import("@/lib/espace/liens");
let suivi: typeof import("@/lib/espace/suivi");
let service: typeof import("@/lib/espace/service");
let proposition: typeof import("@/lib/sms/proposition");
let NextRequestClasse: typeof import("next/server").NextRequest;
let route: typeof import("@/app/api/dossiers/route");

const RACINE = path.resolve(__dirname, "..", "..", "..");
const J = 86_400_000;
let numero = 0;
const telephone = () => `+3367${String(2_000_000 + ++numero).padStart(7, "0")}`;
const nouveauDossier = (nom: string, donnees: Record<string, unknown> = {}) =>
  prisma.dossier.create({ data: { clientNom: nom, clientAdresse: "1 rue des Essais", clientCp: "34970", clientVille: "Lattes", clientTelephone: telephone(), objet: "Cuisine", source: "ENTRANT", etape: "QUALIFICATION", ...donnees } });
async function avecEspace(nom: string, main: "MOI" | "CLIENT", donnees: Record<string, unknown> = {}) {
  const dossier = await nouveauDossier(nom, donnees);
  const ouvert = await liens.ouvrirEspace(dossier.id);
  await prisma.dossier.update({ where: { id: dossier.id }, data: { main } });
  return { dossierId: dossier.id, espaceId: ouvert.espace.id, permanentId: ouvert.permanent.id };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  await (await import("@/lib/base/preparation")).preparerBase();
  dossiersLib = await import("@/lib/dossiers/dossiers");
  liens = await import("@/lib/espace/liens");
  suivi = await import("@/lib/espace/suivi");
  service = await import("@/lib/espace/service");
  proposition = await import("@/lib/sms/proposition");
  NextRequestClasse = (await import("next/server")).NextRequest;
  route = await import("@/app/api/dossiers/route");
});
after(async () => {
  await prisma.$disconnect();
});

describe("la demande d'avis n'ouvre jamais d'espace", () => {
  test("dossier sans espace : refus 409, aucun espace créé ; lien désactivé : refus ; espace ouvert : le lien sur #apres", async () => {
    const sans = await nouveauDossier("Avis Sans-Espace", { etape: "FACTURE" });
    await assert.rejects(proposition.proposerSms({ action: "RELANCE_AVIS", dossierId: sans.id, relance: { type: "AVIS", rang: 1 } }), /pas d'espace client ouvert/);
    assert.equal(await prisma.espaceClient.count({ where: { dossierId: sans.id } }), 0, "rien n'est écrit");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: sans.id, type: "ESPACE_LIEN_CREE" } }), 0);

    const desactive = await avecEspace("Avis Desactive", "CLIENT", { etape: "FACTURE" });
    await prisma.espacePermanent.update({ where: { id: desactive.permanentId }, data: { revoqueLe: new Date() } });
    await assert.rejects(proposition.proposerSms({ action: "RELANCE_AVIS", dossierId: desactive.dossierId }), /lien est désactivé/);

    const ouvert = await avecEspace("Avis Ouvert", "CLIENT", { etape: "FACTURE" });
    const sms = await proposition.proposerSms({ action: "RELANCE_AVIS", dossierId: ouvert.dossierId, relance: { type: "AVIS", rang: 1 } });
    assert.equal(sms.code, "DEMANDE_AVIS");
    assert.match(sms.lien ?? "", /\/e\/[^#]+#apres$/);
  });
});

describe("le filtre « Espaces » retrouve le tri de l'ancien onglet", () => {
  const ids: Record<string, string> = {};

  before(async () => {
    // Trois espaces : « Ancien » à moi, ouvert il y a 10 jours, sans visite ; « Visite » chez le client, ouvert il y a
    // 5 jours, visité à l'instant ; « Recent » chez le client, ouvert aujourd'hui, visité il y a 3 jours.
    const ancien = await avecEspace("Tri Ancien", "MOI");
    const visite = await avecEspace("Tri Visite", "CLIENT");
    const recent = await avecEspace("Tri Recent", "CLIENT");
    await prisma.espaceClient.update({ where: { id: ancien.espaceId }, data: { createdAt: new Date(Date.now() - 10 * J) } });
    await prisma.espaceClient.update({ where: { id: visite.espaceId }, data: { createdAt: new Date(Date.now() - 5 * J), dernierAccesLe: new Date(), premierAccesLe: new Date(Date.now() - 5 * J), nbAcces: 2 } });
    await prisma.espaceClient.update({ where: { id: recent.espaceId }, data: { dernierAccesLe: new Date(Date.now() - 3 * J), premierAccesLe: new Date(Date.now() - 3 * J), nbAcces: 1 } });
    Object.assign(ids, { ancien: ancien.dossierId, visite: visite.dossierId, recent: recent.dossierId });
  });

  const ordre = async (triEspace?: "MAIN" | "ACTIVITE" | "CREATION") => {
    const page = await dossiersLib.pageDossiers({ espace: "TOUS", recherche: "Tri", ...(triEspace ? { triEspace } : {}) });
    return page.dossiers.map((d) => d.id).filter((id) => Object.values(ids).includes(id));
  };

  test("à moi d'abord (par défaut), dernière activité, lien le plus récent : l'ordre des pages vient du serveur", async () => {
    assert.deepEqual(await ordre(), [ids.ancien, ids.visite, ids.recent], "à moi d'abord, puis dernière activité");
    assert.deepEqual(await ordre("ACTIVITE"), [ids.visite, ids.recent, ids.ancien]);
    assert.deepEqual(await ordre("CREATION"), [ids.recent, ids.visite, ids.ancien]);
  });

  test("GET /api/dossiers?espace=TOUS&triEspace=… le passe au serveur ; un tri inconnu garde « à moi d'abord »", async () => {
    const lire = async (suite: string) => {
      const reponse = await route.GET(new NextRequestClasse(`http://localhost:3001/api/dossiers?espace=TOUS&q=Tri${suite}`));
      assert.equal(reponse.status, 200);
      return ((await reponse.json()) as { dossiers: { id: string }[] }).dossiers.map((d) => d.id).filter((id) => Object.values(ids).includes(id));
    };
    assert.deepEqual(await lire("&triEspace=CREATION"), [ids.recent, ids.visite, ids.ancien]);
    assert.deepEqual(await lire("&triEspace=N_IMPORTE"), [ids.ancien, ids.visite, ids.recent]);
  });

  test("l'écran garde l'ordre du serveur sous le filtre (liste et kanban), le sélecteur de tri est dans le filtre", () => {
    const lire = (f: string) => readFileSync(path.join(RACINE, "src/app/(pilotage)/dossiers/_components", f), "utf8");
    assert.match(lire("DossiersPilotage.tsx"), /tri=\{espaceActif \? null : tri\}/);
    assert.match(lire("DossiersPilotage.tsx"), /ordreServeur=\{espaceActif\}/);
    assert.match(lire("VueListe.tsx"), /tri \? trierDossiers\(dossiers, tri\) : dossiers/);
    assert.match(lire("EspaceColonne.tsx"), /aria-label="Tri des espaces"/);
  });
});

describe("le suivi des espaces lit d'une traite", () => {
  test("liensEnvoyes accepte plusieurs motifs (bornés aux espaces lus) ; une liste vide ne lit rien", async () => {
    const a = await avecEspace("Envoi Alpha", "CLIENT");
    const b = await avecEspace("Envoi Beta", "CLIENT");
    const permanentA = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: a.permanentId } });
    const permanentB = await prisma.espacePermanent.findUniqueOrThrow({ where: { id: b.permanentId } });
    const [codeA, codeB] = [permanentA.code, permanentB.code];
    for (const [dossierId, permanent] of [[a.dossierId, permanentA], [b.dossierId, permanentB]] as const) {
      await prisma.dossierEvenement.create({ data: { dossierId, type: "SMS_COPIE", direction: "SORTANT", contenu: `Bonjour, votre espace : https://coverswap.fr/e/${liens.jetonEspace(permanent)}` } });
    }
    const deA = await suivi.liensEnvoyes([`/e/${codeA}-`]);
    assert.ok(deA.some((e) => e.texte.includes(codeA)));
    assert.ok(!deA.some((e) => e.texte.includes(codeB)), "seulement les espaces demandés");
    assert.equal((await suivi.liensEnvoyes([`/e/${codeA}-`, `/e/${codeB}-`])).filter((e) => e.texte.includes(codeA) || e.texte.includes(codeB)).length, 2);
    assert.deepEqual(await suivi.liensEnvoyes([]), []);
    // Le signal « Lien pas encore envoyé » reste juste avec la lecture bornée : le lien de A est noté envoyé.
    const espaces = await suivi.listerEspaces(new Date(), { permanentIds: [a.permanentId] });
    assert.ok(espaces.every((l) => !l.signaux.some((s) => s.code === "NON_ENVOYE")), JSON.stringify(espaces.map((l) => l.signaux)));
  });

  test("les rendus du site rangés dans les photos se lisent pour toute une liste ; photosDuClient rend la même chose", async () => {
    const d = await nouveauDossier("Rendus Liste", { photos: JSON.stringify(["dossiers/x/avant-1.jpg", "dossiers/x/rendu-2.png"]) });
    const autre = await nouveauDossier("Rendus Autre");
    const idRendu = (await service.photosDuClient(d.id, d.photos)).find((p) => p.chemin.includes("rendu-2"))!.id;
    const lead = await prisma.lead.create({ data: { prenom: "Rendu", nom: "Essai", telephone: telephone(), email: `rendu${numero}@exemple.fr`, ville: "Lattes", source: "SITE_SIMULATEUR" } });
    await prisma.simulation.create({ data: { leadId: lead.id, dossierId: d.id, photosDossier: JSON.stringify({ avant: null, rendu: idRendu }) } });
    const rendus = await service.rendusDesDossiers([d.id, autre.id]);
    assert.deepEqual([[...(rendus.get(d.id) ?? [])], rendus.get(autre.id)?.size], [[idRendu], 0]);
    const seul = await service.photosDuClient(d.id, d.photos);
    const groupe = await service.photosDuClient(d.id, d.photos, rendus.get(d.id));
    assert.deepEqual(groupe, seul);
    assert.deepEqual(seul.map((p) => p.chemin), ["dossiers/x/avant-1.jpg"], "le rendu n'est pas une photo du client");
  });
});

describe("textes et accessibilité", () => {
  test("plus aucun texte visible ne renvoie à l'écran « Espaces clients » retiré", () => {
    const fichiers = [
      "src/lib/espace/projets.ts",
      "src/lib/espace/creation.ts",
      "src/lib/parametres/definitions.ts",
      "src/app/(pilotage)/dossiers/_components/ArchivageDossier.tsx",
      "src/lib/assistant/outils/espace.ts",
      "src/lib/assistant/outils/gestes.ts",
      "src/lib/assistant/outils/lecture.ts",
      "src/lib/assistant/outils/lister.ts",
    ];
    for (const f of fichiers) {
      const texte = readFileSync(path.join(RACINE, f), "utf8");
      assert.doesNotMatch(texte, /depuis Espaces clients|ou Espaces clients\)|d&apos;Espaces clients|lien\("Espaces clients"/, f);
    }
  });

  test("les pastilles du filtre sont des boutons à aria-pressed (pas des onglets) ; l'icône des cartes n'allonge pas leur nom", () => {
    const texte = readFileSync(path.join(RACINE, "src/app/(pilotage)/dossiers/_components/EspaceColonne.tsx"), "utf8");
    assert.doesNotMatch(texte, /role="tab/);
    assert.match(texte, /role="group" aria-label="Filtre des espaces"/);
    assert.match(texte, /aria-pressed=\{filtre === valeur\}/);
    assert.match(texte, /libelle="aucun"/, "la ligne courte (carte, téléphone) : l'icône est décorative");
    assert.match(readFileSync(path.join(RACINE, "src/app/(pilotage)/dossiers/_components/CarteDossier.tsx"), "utf8"), /libelle="court"/);
  });
});
