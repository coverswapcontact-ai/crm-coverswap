import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-etats-en-double-"));

/**
 * Mission 18 (B11, écart 11) : les états en double.
 * - Lectures du devis : `Document.consultations` est la seule source. L'espace n'en garde plus de copie ;
 *   `manager_commercial` lit le devis ; « Réinitialiser » l'étape Devis (écran ou `geste_espace`) remet le compteur
 *   du devis à zéro (le signal « relu sans signer » tombe, la lecture suivante sonne de nouveau).
 * - Teintes : valider une simulation (ou un mélange) reporte ses teintes dans `Dossier.teintes`, sur les sous-parties
 *   du projet qu'elles habillent ; les autres teintes restent ; dévalider ne touche à rien.
 * Chaque cas se lit des deux côtés (`etatDesDeuxCotes`). Rien ne part hors du poste.
 */

type ResultatOutil = import("@/lib/assistant/definition").ResultatOutil;
type DefinitionOutil = import("@/lib/assistant/definition").DefinitionOutil<Record<string, unknown>>;

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let validations: typeof import("@/lib/espace/validations");
let vueCrm: typeof import("@/lib/espace/vue-crm");
let suivi: typeof import("@/lib/espace/suivi");
let teintesChoix: typeof import("@/lib/espace/teintes-choix");
let simulations: typeof import("@/lib/simulations/dossier");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let execution: typeof import("@/lib/assistant/execution");
let catalogue: typeof import("@/lib/assistant/catalogue");
let migration: typeof import("@/lib/base/migrations/mission-18-b11");
let session: import("@/lib/assistant/execution").Session;
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = () => new File([new Uint8Array(JPEG)], "simulation.jpg", { type: "image/jpeg" });
const lignes = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement des façades", quantite: 6, unite: "ml", prixUnitaire: 120 }]);

async function contact(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3364${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", typeProjet: "CUISINE", email: `${prenom.toLowerCase()}.essai@example.test` } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId };
}
const espaceDe = (dossierId: string) => prisma.espaceClient.findFirstOrThrow({ where: { dossierId } });
const lectures = async (id: string) => {
  const d = await prisma.document.findUniqueOrThrow({ where: { id }, select: { consultations: true, consulteLe: true } });
  return [d.consultations, d.consulteLe !== null];
};
/** Une heure plus tard : la visite suivante compte. */
const uneHeurePlusTard = (id: string) => prisma.document.update({ where: { id }, data: { consulteLe: new Date(Date.now() - 3_600_000) } });
const outil = (nom: string, entree: Record<string, unknown>): Promise<ResultatOutil> => execution.executerOutil(catalogue.outilParNom(nom) as unknown as DefinitionOutil, entree, session, new Date());
const lignesCommerciales = async () => ((await outil("manager_commercial", {})).donnees as { devisEnAttente: { relusSansSignature: number; lignes: { documentId: string; consultations: number }[] } }).devisEnAttente;
/** L'état des deux côtés, sans la date de la prochaine action (calculée à l'instant). */
const sansDate = (etat: Awaited<ReturnType<typeof etatDesDeuxCotes>>) => ({ ...etat, prochaineActionDate: null });

/** Une simulation publiée dans son espace, avec ses teintes zone par zone. */
async function simulationPubliee(dossierId: string, titre: string, zones: { zone: string; libelle: string; ref: string; nom: string }[]) {
  const id = await avecActeur(LUCAS, async () => (await service.deposerSimulation(dossierId, photo(), { titre })).id);
  await prisma.simulationEspace.update({ where: { id }, data: { zones: JSON.stringify(zones) } });
  await avecActeur(LUCAS, () => simulations.publierSimulations(dossierId, [id], { prevenir: false }));
  return id;
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  validations = await import("@/lib/espace/validations");
  vueCrm = await import("@/lib/espace/vue-crm");
  suivi = await import("@/lib/espace/suivi");
  teintesChoix = await import("@/lib/espace/teintes-choix");
  simulations = await import("@/lib/simulations/dossier");
  dossiers = await import("@/lib/dossiers/dossiers");
  execution = await import("@/lib/assistant/execution");
  catalogue = await import("@/lib/assistant/catalogue");
  migration = await import("@/lib/base/migrations/mission-18-b11");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
  session = await execution.ouvrirSession({ jetonId: null, clientNom: "essai", utilisateur: "essai@local" });
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("lectures du devis : le devis seul (mission 18, B11)", () => {
  test("lu par le client : compté sur le devis, pas sur l'espace ; manager_commercial le lit ; réinitialisé par geste_espace : remis à zéro, le signal tombe, la lecture suivante repart de 1", async () => {
    const c = await contact("Lecture");
    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-B11-1", dateEmission: new Date(), objet: "Façades", lignes, totalHt: 720, acomptePct: 30, statut: "ENVOYE" } });
    const avant = await etatDesDeuxCotes(c.dossierId);

    // Deux visites : deux lectures, sur le devis seulement.
    await service.noterConsultationDevis(await espaceDe(c.dossierId), devis.id);
    await uneHeurePlusTard(devis.id);
    assert.deepEqual(await service.noterConsultationDevis(await espaceDe(c.dossierId), devis.id), { consultations: 2 });
    assert.deepEqual(await lectures(devis.id), [2, true]);
    const espace = await espaceDe(c.dossierId);
    assert.deepEqual([espace.devisConsulteId, espace.devisConsultations, espace.devisConsulteLe], [null, 0, null], "plus de copie sur l'espace");
    const commercial = await lignesCommerciales();
    assert.equal(commercial.lignes.find((l) => l.documentId === devis.id)?.consultations, 2, "manager_commercial lit le devis");
    assert.ok(commercial.relusSansSignature >= 1);
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))?.devis?.consultations, 2);
    const lu = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([lu.etape, lu.main, lu.prochaineAction, lu.etapeEspace, lu.relances], [avant.etape, avant.main, avant.prochaineAction, avant.etapeEspace, avant.relances], "lire ne change ni l'étape, ni la main, ni l'espace");
    assert.ok(lu.taches.some((t) => /relu 2 fois sans signer/.test(t.raison)), JSON.stringify(lu.taches));

    // Réinitialiser l'étape Devis par l'assistant (même fonction que l'écran) : aperçu, jeton, puis le geste.
    const apercu = await outil("geste_espace", { geste: "REINITIALISER", dossierId: c.dossierId, etape: "DEVIS" });
    assert.ok(apercu.confirmation?.jeton, apercu.texte);
    assert.deepEqual(await lectures(devis.id), [2, true], "rien sans le jeton");
    const fait = await outil("geste_espace", { geste: "REINITIALISER", dossierId: c.dossierId, etape: "DEVIS", confirmation: apercu.confirmation!.jeton });
    assert.ok(!fait.confirmation, fait.texte);
    assert.deepEqual(await lectures(devis.id), [0, false], "le compteur du devis repart de zéro");
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))?.devis?.consultations, 0);
    assert.equal((await lignesCommerciales()).lignes.find((l) => l.documentId === devis.id)?.consultations, 0);
    const remis = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual(sansDate({ ...remis, taches: [] }), sansDate({ ...avant, taches: [] }), "le dossier et l'espace comme avant la lecture");
    assert.ok(!remis.taches.some((t) => /relu \d+ fois sans signer/.test(t.raison)), "le signal « relu sans signer » est tombé");

    // La lecture suivante repart de 1 et ouvre une nouvelle ligne d'historique (l'ancienne reste).
    assert.deepEqual(await service.noterConsultationDevis(await espaceDe(c.dossierId), devis.id), { consultations: 1 });
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId: c.dossierId, type: "ESPACE_DEVIS_CONSULTE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    assert.deepEqual(evenements.map((e) => e.contenu.replace(/ \(dernière.*$/, "")), ["Le client a consulté son devis D-B11-1 — 2 fois", "Le client a consulté son devis D-B11-1 pour la première fois"]);
  });

  test("migration : le devis prend la plus grande des deux valeurs, jamais abaissée ; rejouée, rien de plus", async () => {
    const c = await contact("Reprise");
    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-B11-2", dateEmission: new Date(), objet: "Façades", lignes, totalHt: 720, acomptePct: 30, statut: "ENVOYE", consultations: 1 } });
    const espace = await espaceDe(c.dossierId);
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { devisConsulteId: devis.id, devisConsultations: 4, devisConsulteLe: new Date("2026-09-30T10:00:00.000Z") } });
    const premiere = await migration.migrationEtatsEnDouble18.executer(prisma);
    assert.ok(premiere.consultations >= 1);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).consultations, 4);
    await prisma.document.update({ where: { id: devis.id }, data: { consultations: 6 } });
    const seconde = await migration.migrationEtatsEnDouble18.executer(prisma);
    assert.equal(seconde.consultations, 0);
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).consultations, 6, "jamais abaissé");
  });
});

describe("teintes : le choix de l'espace reporté sur le dossier (mission 18, B11)", () => {
  const ZONES = [
    { zone: "meubles-hauts", libelle: "Façades hautes", ref: "NE31", nom: "Chêne clair" },
    { zone: "meubles-bas", libelle: "Façades basses", ref: "NO12", nom: "Noyer" },
    { zone: "plan-de-travail", libelle: "Plan de travail", ref: "AL23", nom: "Béton" },
  ];

  test("le client valide une simulation : ses teintes vont aux sous-parties de son projet (îlot = façades basses + plan), les autres restent ; dévalider ne touche à rien ; un mélange validé ensuite remplace", async () => {
    const c = await contact("Teintes");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prestations: JSON.stringify({ CUISINE: ["facades-hautes", "ilot", "plan-de-travail", "credence"] }), teintes: JSON.stringify({ "CUISINE.credence": "blanc", "CUISINE.ilot": "chêne" }) } });
    const s1 = await simulationPubliee(c.dossierId, "Chêne et béton", ZONES);
    const s2 = await simulationPubliee(c.dossierId, "Tout blanc", [{ zone: "meubles-hauts", libelle: "Façades hautes", ref: "BL01", nom: "Blanc mat" }]);

    await service.choisir(await espaceDe(c.dossierId), { simulationId: s1, commentaire: "" });
    const attendu = { "CUISINE.credence": "blanc", "CUISINE.facades-hautes": "Chêne clair (NE31)", "CUISINE.ilot": "Noyer (NO12) / Béton (AL23)", "CUISINE.plan-de-travail": "Béton (AL23)" };
    assert.deepEqual((await dossiers.chargerDetail(c.dossierId)).teintes, attendu, "côté CRM : la fiche du dossier");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction, etat.etapeEspace], ["SIMULATION", "MOI", "MOI", "Préparer le devis (simulation choisie)", "ATTENTE_DEVIS"]);
    const ligne = (await suivi.listerEspaces(new Date(), { espaceIds: [(await espaceDe(c.dossierId)).id] }))[0];
    assert.match(ligne.faits.choixTeintes ?? "", /Façades hautes : Chêne clair \(NE31\)/, "côté espace : le même choix");

    // Dévalider (Lucas, à sa place) : le choix tombe, les teintes du dossier restent.
    await validations.devaliderChoix(await espaceDe(c.dossierId), "LUCAS");
    assert.deepEqual((await dossiers.chargerDetail(c.dossierId)).teintes, attendu);
    const devalide = await etatDesDeuxCotes(c.dossierId);
    assert.notEqual(devalide.etapeEspace, "ATTENTE_DEVIS");

    // Puis un mélange : les façades hautes de l'autre simulation, le plan de la première. Les sous-parties qu'il
    // habille prennent ses teintes (l'îlot : le plan seul), la crédence garde la sienne.
    await service.choisir(await espaceDe(c.dossierId), { zones: [{ zone: "meubles-hauts", simulationId: s2 }, { zone: "plan-de-travail", simulationId: s1 }], commentaire: "" });
    assert.deepEqual((await dossiers.chargerDetail(c.dossierId)).teintes, { "CUISINE.credence": "blanc", "CUISINE.facades-hautes": "Blanc mat (BL01)", "CUISINE.ilot": "Béton (AL23)", "CUISINE.plan-de-travail": "Béton (AL23)" });
    const melange = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([melange.etape, melange.main, melange.prochaineAction, melange.etapeEspace], ["SIMULATION", "MOI", "Préparer le devis (simulation choisie)", "ATTENTE_DEVIS"]);
  });

  test("Lucas valide à la place du client (bloc Espace, geste_espace VALIDER_SIMULATION) : même report ; rien de coché au projet, les surfaces du choix disent les sous-parties", async () => {
    const c = await contact("Lucas");
    const s = await simulationPubliee(c.dossierId, "Chêne et béton", ZONES);
    await avecActeur(LUCAS, () => vueCrm.gesteDeLucas(c.dossierId, { geste: "valider-simulation", simulationId: s }));
    assert.deepEqual((await dossiers.chargerDetail(c.dossierId)).teintes, { "CUISINE.facades-hautes": "Chêne clair (NE31)", "CUISINE.facades-basses": "Noyer (NO12)", "CUISINE.plan-de-travail": "Béton (AL23)" });
    const etat = await etatDesDeuxCotes(c.dossierId);
    // Un geste de Lucas à la place du client ne lui rend pas la main (règle de main.ts) : elle reste écrite comme calculée.
    assert.deepEqual([etat.etape, etat.main, etat.mainCalculee, etat.prochaineAction, etat.etapeEspace], ["SIMULATION", "CLIENT", "CLIENT", "Préparer le devis (simulation choisie)", "ATTENTE_DEVIS"]);
  });

  test("un choix illisible n'en est pas un, des deux côtés : la liste des espaces lit comme l'espace du client", async () => {
    const c = await contact("Illisible");
    await simulationPubliee(c.dossierId, "Chêne", ZONES);
    const espace = await espaceDe(c.dossierId);
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { choix: "{illisible", choixLe: new Date() } });
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    const ligne = (await suivi.listerEspaces(new Date(), { espaceIds: [espace.id] }))[0];
    assert.equal(ligne.etape, etat.etapeEspace);
    assert.notEqual(ligne.etape, "ATTENTE_DEVIS");
  });

  test("teintesParSousPartie et lireChoixEspace : sous-parties cochées, sinon celles des surfaces ; choix illisible → null", () => {
    const zones = ZONES.map((z) => ({ zone: z.zone, ref: z.ref, nom: z.nom }));
    assert.deepEqual(teintesChoix.teintesParSousPartie({ CUISINE: ["credence"] }, zones), {}, "la crédence n'est pas dans le choix");
    assert.deepEqual(teintesChoix.teintesParSousPartie({}, [{ zone: "plan-de-travail", ref: null, nom: "Béton" }]), { "CUISINE.plan-de-travail": "Béton" });
    assert.deepEqual(teintesChoix.teintesParSousPartie({ CUISINE: ["ilot"] }, []), {});
    assert.deepEqual([teintesChoix.lireChoixEspace("{illisible"), teintesChoix.lireChoixEspace(JSON.stringify({ mode: "AUTRE" })), teintesChoix.lireChoixEspace(JSON.stringify({ mode: "UNE", simulationId: "a" }))?.mode], [null, null, "UNE"]);
  });

  test("migration : un choix validé avant B11 remplit les sous-parties sans teinte, jamais celles déjà notées ; rejouée, rien de plus", async () => {
    const c = await contact("Ancien");
    const s = await simulationPubliee(c.dossierId, "Chêne et béton", ZONES);
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prestations: JSON.stringify({ CUISINE: ["facades-hautes", "plan-de-travail"] }), teintes: JSON.stringify({ "CUISINE.plan-de-travail": "granit" }) } });
    const espace = await espaceDe(c.dossierId);
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { choix: JSON.stringify({ mode: "UNE", simulationId: s }), choixLe: new Date() } });
    const premiere = await migration.migrationEtatsEnDouble18.executer(prisma);
    assert.ok(premiere.teintes >= 1);
    assert.deepEqual((await dossiers.chargerDetail(c.dossierId)).teintes, { "CUISINE.facades-hautes": "Chêne clair (NE31)", "CUISINE.plan-de-travail": "granit" });
    assert.equal((await migration.migrationEtatsEnDouble18.executer(prisma)).teintes, 0);
  });
});
