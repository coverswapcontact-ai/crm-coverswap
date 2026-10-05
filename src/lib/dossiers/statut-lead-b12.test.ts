import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { ETAPES, REGLES_ETAPES, type EtapeDossier } from "./constants";
import { STATUT_LEAD_PAR_ETAPE, statutLeadSelonDossiers } from "./statut-lead";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-statut-lead-b12-"));
for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
process.env.SITE_URL = "https://coverswap.fr";
process.env.TACHES_DESACTIVEES = "1";

/**
 * Mission 18 (B12, écart 12) : le statut du lead suit l'étape pour TOUTES les étapes (une seule table, statut-lead.ts) ;
 * un dossier ouvert sur un lead « Devis demandé », « À traiter » ou perdu le met à jour, dans la transaction de
 * l'ouverture ; plusieurs dossiers : le vivant le plus avancé décide (perdus seulement : PERDU ; en pause : rien ne
 * bouge). Le contrôle de cohérence (`STATUT_DU_LEAD`) lit la même règle. Chaque cas : le déclencheur, puis l'état DES
 * DEUX CÔTÉS (`etatDesDeuxCotes` : étape, main, prochaine action, statut du lead, étape de l'espace, relances, tâches).
 * Rien ne sort du poste : réseau coupé.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let dossiers: typeof import("./dossiers");
let depuisLead: typeof import("./depuis-lead");
let transitions: typeof import("./transitions");
let liens: typeof import("@/lib/espace/liens");
let coherence: typeof import("@/lib/coherence/controle");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const appelsReseau: string[] = [];
const fetchOriginal = globalThis.fetch;

let compteur = 0;
const lead = (donnees: Record<string, unknown> = {}) => {
  compteur++;
  return prisma.lead.create({
    data: { prenom: "Essai", nom: `Statut${compteur}`, telephone: `+3361300${String(compteur).padStart(4, "0")}`, email: `statut${compteur}.b12@example.test`, ville: "Lattes", codePostal: "34970", source: "SITE_DEVIS", typeProjet: "CUISINE", ...donnees },
  });
};
/** La main que les écrans affichent : celle écrite, à défaut le responsable de l'étape (dossier tout juste ouvert). */
const mainAffichee = (etat: { main: string | null; etape: string }) => etat.main ?? REGLES_ETAPES[etat.etape as EtapeDossier].responsable;
const statutDe = async (leadId: string) => (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).statut;
/** Un dossier de plus pour le même lead (ouvert à la main depuis sa fiche, à l'étape donnée). */
const ouvrir = (leadId: string, etape: (typeof ETAPES)[number] = "QUALIFICATION") =>
  avecActeur(LUCAS, () => dossiers.creerDossier(dossiers.schemaCreation.parse({ clientNom: "Essai Statut", clientTelephone: "06 13 00 00 00", leadId, etape }), []));
const etape = (dossierId: string, vers: (typeof ETAPES)[number]) =>
  avecActeur(LUCAS, () => transitions.changerEtape(dossierId, { vers, ...(vers === "PERDU" ? { motifPerte: "PRIX" as const } : {}) }));
const statutsDuLead = (rapport: Awaited<ReturnType<typeof coherence.controlerCoherence>>, leadId: string) =>
  rapport.incoherences.filter((i) => i.code === "STATUT_DU_LEAD" && i.leadId === leadId);

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
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  dossiers = await import("./dossiers");
  depuisLead = await import("./depuis-lead");
  transitions = await import("./transitions");
  liens = await import("@/lib/espace/liens");
  coherence = await import("@/lib/coherence/controle");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  assert.deepEqual(appelsReseau, [], "aucun appel réseau");
  await prisma.$disconnect();
});

describe("statut du lead ↔ étape (mission 18, B12)", () => {
  test("une seule table, pour toutes les étapes ; la règle du plus avancé, des perdus, de la pause", () => {
    assert.deepEqual(Object.keys(STATUT_LEAD_PAR_ETAPE).sort(), [...ETAPES].sort(), "chaque étape a sa ligne");
    assert.deepEqual(
      ETAPES.map((e) => [e, STATUT_LEAD_PAR_ETAPE[e]]),
      [
        ["QUALIFICATION", "CONTACTE"],
        ["SIMULATION", "CONTACTE"],
        ["DEVIS_ENVOYE", "DEVIS_ENVOYE"],
        ["RELANCE", "DEVIS_ENVOYE"],
        ["SIGNE", "SIGNE"],
        ["PLANIFIE", "CHANTIER_PLANIFIE"],
        ["CHANTIER", "CHANTIER_PLANIFIE"],
        ["FACTURE", "TERMINE"],
        ["ENCAISSE", "TERMINE"],
        ["PERDU", "PERDU"],
        ["EN_PAUSE", null],
      ]
    );
    const d = (id: string, e: string) => ({ id, etape: e });
    assert.deepEqual(statutLeadSelonDossiers([d("a", "QUALIFICATION"), d("b", "SIGNE"), d("c", "PERDU")]), { statut: "SIGNE", decideur: d("b", "SIGNE") });
    assert.deepEqual(statutLeadSelonDossiers([d("a", "PERDU"), d("b", "EN_PAUSE"), d("c", "SIMULATION")])?.statut, "CONTACTE", "un vivant décide, même moins avancé qu'un perdu");
    assert.deepEqual(statutLeadSelonDossiers([d("a", "PERDU"), d("b", "PERDU")]), { statut: "PERDU", decideur: d("a", "PERDU") });
    assert.equal(statutLeadSelonDossiers([d("a", "EN_PAUSE")]), null, "en pause : inchangé");
    assert.equal(statutLeadSelonDossiers([d("a", "EN_PAUSE"), d("b", "PERDU")]), null, "en pause et perdu : inchangé");
    assert.equal(statutLeadSelonDossiers([]), null);
  });

  test("dossier ouvert sur un lead « Devis demandé » (demande du site) : Contacté dans l'ouverture, des deux côtés", async () => {
    const contact = await lead({ statut: "DEVIS_DEMANDE", message: "Devis pour ma cuisine" });
    const ouverture = await depuisLead.ouvrirDossierAutomatique(contact.id, { demande: true });
    assert.ok(ouverture?.cree);
    const etat = await etatDesDeuxCotes(ouverture.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.prochaineAction, etat.etapeEspace], ["QUALIFICATION", "CONTACTE", "Appeler : demande de devis", null]);
    assert.equal(mainAffichee(etat), etat.mainCalculee, "la main affichée est celle de la règle");
    assert.deepEqual(etat.relances.proposables, []);
    assert.ok(!etat.taches.some((t) => t.cle.includes("STATUT_DU_LEAD")), "aucune incohérence du statut à corriger");
  });

  test("dossier ouvert sur un lead perdu (ancien dossier perdu) : il redevient Contacté ; l'ancien perdu ne décide plus", async () => {
    const contact = await lead({ statut: "NOUVEAU" });
    const ancien = await ouvrir(contact.id);
    assert.equal(await statutDe(contact.id), "CONTACTE", "« À traiter » → Contacté à l'ouverture");
    await etape(ancien, "PERDU");
    assert.equal(await statutDe(contact.id), "PERDU", "seul dossier, perdu : le lead est perdu");

    // Il revient (bouton « Ouvrir un dossier », ou demande du site) : un nouveau dossier vivant.
    const espace = await liens.ouvrirEspaceDuContact(contact.id);
    assert.notEqual(espace.dossierId, ancien, "le dossier perdu ne se rouvre pas");
    const etat = await etatDesDeuxCotes(espace.dossierId);
    assert.deepEqual([etat.etape, etat.statutLead, etat.etapeEspace], ["QUALIFICATION", "CONTACTE", "PHOTOS"]);
    assert.equal(mainAffichee(etat), etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, [], "aucune relance d'un dossier qui s'ouvre");
    const rapport = await coherence.controlerCoherence({ etendu: true });
    assert.deepEqual(statutsDuLead(rapport, contact.id), [], "le perdu n'impose plus « PERDU » : le vivant décide");
  });

  test("plusieurs dossiers : le vivant le plus avancé décide ; pause sans effet ; tous perdus → PERDU", async () => {
    const contact = await lead({ statut: "NOUVEAU" });
    const signe = await ouvrir(contact.id, "SIGNE");
    assert.equal(await statutDe(contact.id), "SIGNE");
    // Un second projet, en Qualification : le client signé ne redevient pas « Contacté ».
    const second = await ouvrir(contact.id);
    let etat = await etatDesDeuxCotes(second);
    assert.deepEqual([etat.etape, etat.statutLead], ["QUALIFICATION", "SIGNE"]);
    assert.equal(mainAffichee(etat), etat.mainCalculee);
    await etape(second, "SIMULATION");
    assert.equal(await statutDe(contact.id), "SIGNE", "le second avance sans dépasser le premier : rien ne bouge");

    // Le premier part en pause : le second (seul vivant) décide.
    await etape(signe, "EN_PAUSE");
    etat = await etatDesDeuxCotes(signe);
    assert.deepEqual([etat.etape, etat.statutLead], ["EN_PAUSE", "CONTACTE"]);
    assert.equal(mainAffichee(etat), etat.mainCalculee);
    // Le second est perdu : le premier, en pause, ne dit rien → inchangé.
    await etape(second, "PERDU");
    assert.equal(await statutDe(contact.id), "CONTACTE", "en pause et perdu : le statut ne bouge pas");
    // Le premier aussi : tous perdus → PERDU.
    await etape(signe, "PERDU");
    etat = await etatDesDeuxCotes(signe);
    assert.deepEqual([etat.etape, etat.statutLead, etat.prochaineAction === null || typeof etat.prochaineAction === "string"], ["PERDU", "PERDU", true]);
    assert.deepEqual(etat.relances.proposables, []);
    // Le premier reprend (retour de pause vers son étape d'avant) : Signé de nouveau.
    await etape(signe, "SIGNE");
    assert.equal(await statutDe(contact.id), "SIGNE");
  });

  test("un dossier seul en pause ne change rien ; ses effets d'après (changement non synchronisé) suivent la même règle", async () => {
    const contact = await lead({ statut: "NOUVEAU" });
    const dossierId = await ouvrir(contact.id, "DEVIS_ENVOYE");
    assert.equal(await statutDe(contact.id), "DEVIS_ENVOYE", "ouvert à son étape : le statut de cette étape");
    await etape(dossierId, "EN_PAUSE");
    const etat = await etatDesDeuxCotes(dossierId);
    assert.deepEqual([etat.etape, etat.statutLead], ["EN_PAUSE", "DEVIS_ENVOYE"]);
    assert.equal(mainAffichee(etat), etat.mainCalculee);

    // Un second dossier en Qualification, écrit sans passer par la transaction de l'étape, puis ses effets d'après :
    // ils alignent sur la règle (le vivant décide), pas sur l'étape du dernier changé.
    const second = await ouvrir(contact.id);
    assert.equal(await statutDe(contact.id), "CONTACTE");
    await prisma.lead.update({ where: { id: contact.id }, data: { statut: "PERDU" } });
    await prisma.dossier.update({ where: { id: second }, data: { etape: "SIMULATION" } });
    await transitions.effetsDuChangementEtape({ dossierId: second, de: "QUALIFICATION", vers: "SIMULATION", nature: "RETOUR" });
    assert.equal(await statutDe(contact.id), "CONTACTE");
  });

  test("cohérence : Qualification et Simulation comptent, un seul signalement sur le dossier qui décide, réparé par la même règle", async () => {
    const contact = await lead({ statut: "NOUVEAU" });
    const avance = await ouvrir(contact.id, "PLANIFIE");
    const petit = await ouvrir(contact.id);
    // Écrit de travers (ancienne base, geste hors du CRM).
    await prisma.lead.update({ where: { id: contact.id }, data: { statut: "DEVIS_DEMANDE" } });
    const rapport = await coherence.controlerCoherence();
    const vues = statutsDuLead(rapport, contact.id);
    assert.deepEqual(vues.map((i) => [i.dossierId, i.correction]), [[avance, "Aligner le lead sur « CHANTIER_PLANIFIE »"]], "sur le plus avancé seulement");
    assert.match(vues[0].constat, /le plus avancé de ses 2 dossiers/);
    assert.equal((await avecActeur(LUCAS, () => coherence.corrigerIncoherence(vues[0].cle))).corrigee, true);
    assert.equal(await statutDe(contact.id), "CHANTIER_PLANIFIE");
    const trace = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: avance, type: "COHERENCE_CORRIGEE" }, orderBy: { createdAt: "desc" } });
    assert.match(trace.contenu, /lead aligné sur « CHANTIER_PLANIFIE » \(il était « DEVIS_DEMANDE »\)/);
    assert.deepEqual(statutsDuLead(await coherence.controlerCoherence(), contact.id), [], "second passage : rien");
    const etat = await etatDesDeuxCotes(petit);
    assert.deepEqual([etat.etape, etat.statutLead], ["QUALIFICATION", "CHANTIER_PLANIFIE"]);
    assert.equal(mainAffichee(etat), etat.mainCalculee);

    // Un lead resté « À traiter » sur un dossier en Simulation : signalé (avant B12, ces étapes n'étaient pas regardées).
    const oublie = await lead({ statut: "NOUVEAU" });
    const simule = await ouvrir(oublie.id, "SIMULATION");
    await prisma.lead.update({ where: { id: oublie.id }, data: { statut: "NOUVEAU" } });
    assert.deepEqual(statutsDuLead(await coherence.controlerCoherence(), oublie.id).map((i) => i.dossierId), [simule]);
  });
});
