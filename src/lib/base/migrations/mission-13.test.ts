import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m13-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

/**
 * Mission 13 (26/09/2026), lot 1 — les bugs métier de l'audit, et les
 * migrations qui corrigent les données existantes (idempotentes) :
 * B1 prochaine action après un devis déposé ; B2 coordonnées de l'espace vers
 * la fiche client ; B3 objet et source d'un dossier d'après le projet validé ;
 * B16 délai de relance par défaut ; B4/B5 jeton Meta : un seul état, d'après
 * les faits ; B19 simulations du site lisibles dans Leads.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let validations: typeof import("@/lib/espace/validations");
let coordonnees: typeof import("@/lib/espace/coordonnees");
let existants: typeof import("@/lib/dossiers/documents-existants");
let controle: typeof import("@/lib/coherence/controle");
let migrations: typeof import("./mission-13-lot-1");
let relances: typeof import("@/lib/relances/service");
let site: typeof import("@/lib/simulations/site");
let sante: typeof import("@/lib/meta/sante");
let taches: typeof import("@/lib/meta/taches");
let normalisation: typeof import("@/lib/clients/normalisation");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const PREPARER = "Préparer le devis (simulation choisie)";
const ATTENDRE = "Attendre l'accord du client sur le devis";
const PROJET_CUISINE = { zones: ["meubles-hauts"], styles: [], propositions: false, metres: 3, repere: null, delai: null, precisions: "" } as Parameters<typeof service.enregistrerProjet>[1];

async function contact(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const dossierDe = (id: string) => prisma.dossier.findUniqueOrThrow({ where: { id } });
const devisDirect = (dossierId: string, numero: string, totalHt: number) => prisma.document.create({ data: { dossierId, type: "DEVIS", numero, dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt, acomptePct: 30, statut: "ENVOYE" } });

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  validations = await import("@/lib/espace/validations");
  coordonnees = await import("@/lib/espace/coordonnees");
  existants = await import("@/lib/dossiers/documents-existants");
  controle = await import("@/lib/coherence/controle");
  migrations = await import("./mission-13-lot-1");
  relances = await import("@/lib/relances/service");
  site = await import("@/lib/simulations/site");
  sante = await import("@/lib/meta/sante");
  taches = await import("@/lib/meta/taches");
  normalisation = await import("@/lib/clients/normalisation");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("B1 — prochaine action après un devis déposé", () => {
  test("un devis rattaché (fait ailleurs) remplace « Préparer le devis » comme un devis généré ; une action écrite par Lucas reste", async () => {
    const c = await contact("Marie");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: PREPARER, prochaineActionDate: new Date() } });
    await avecActeur(LUCAS, () => existants.enregistrerDocumentExistant(c.dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-301", dateEmission: "2026-09-25", montant: 440, inscrireAuRegistre: true })));
    let d = await dossierDe(c.dossierId);
    assert.deepEqual([d.prochaineAction, d.prochaineActionDate], [ATTENDRE, null]);

    const autre = await contact("Paul");
    await prisma.dossier.update({ where: { id: autre.dossierId }, data: { prochaineAction: "Appeler pour le devis", prochaineActionDate: new Date("2026-10-01T00:00:00Z") } });
    await avecActeur(LUCAS, () => existants.enregistrerDocumentExistant(autre.dossierId, existants.schemaDocumentExistant.parse({ type: "DEVIS", numero: "2026-302", dateEmission: "2026-09-25", montant: 100, inscrireAuRegistre: true })));
    d = await dossierDe(autre.dossierId);
    assert.equal(d.prochaineAction, "Appeler pour le devis", "une action écrite par Lucas n'est pas touchée");
  });

  test("le contrôle de cohérence propose « Remplacer par … » quand le devis existe, et le fait", async () => {
    const c = await contact("Nora");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: PREPARER, prochaineActionDate: new Date(), etape: "DEVIS_ENVOYE" } });
    await devisDirect(c.dossierId, "D-NORA", 1500);
    const rapport = await controle.controlerCoherence();
    const incoherence = rapport.incoherences.find((i) => i.code === "PROCHAINE_ACTION_PERIMEE" && i.dossierId === c.dossierId);
    assert.ok(incoherence, JSON.stringify(rapport.incoherences));
    assert.equal(incoherence.correction, `Remplacer par « ${ATTENDRE} »`);
    const resultat = await avecActeur(LUCAS, () => controle.corrigerIncoherence(incoherence.cle));
    assert.equal(resultat.corrigee, true);
    assert.equal((await dossierDe(c.dossierId)).prochaineAction, ATTENDRE);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "COHERENCE_CORRIGEE" } }), 1);
  });

  test("la migration corrige les dossiers déjà dans ce cas (Beites, Fares), une fois ; sans devis, rien ne bouge", async () => {
    const c = await contact("Fawzi");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { prochaineAction: PREPARER, prochaineActionDate: new Date() } });
    await devisDirect(c.dossierId, "D-FAWZI", 2415);
    const sans = await contact("Sans");
    await prisma.dossier.update({ where: { id: sans.dossierId }, data: { prochaineAction: PREPARER } });
    const bilan = await avecActeur(LUCAS, () => migrations.migrationProchaineActionDevis13.executer(prisma));
    assert.equal(bilan.corriges, 1);
    assert.equal((await dossierDe(c.dossierId)).prochaineAction, ATTENDRE);
    assert.equal((await dossierDe(sans.dossierId)).prochaineAction, PREPARER);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: c.dossierId, type: "COHERENCE_CORRIGEE" } }), 1);
    assert.deepEqual(await avecActeur(LUCAS, () => migrations.migrationProchaineActionDevis13.executer(prisma)), { corriges: 0 });
  });
});

describe("B2 — coordonnées de l'espace vers la fiche client", () => {
  const fiche = (id: string) => prisma.client.findUniqueOrThrow({ where: { id }, include: { emails: true, telephones: true } });

  test("le client confirme ses coordonnées sans rien changer : la fiche reçoit l'e-mail et le téléphone du dossier ; un changement garde l'ancien", async () => {
    const client = await prisma.client.create({ data: { nom: "Beites Marie", prenom: "Marie", nomFamille: "Beites", source: "ENTRANT", premierContactLe: new Date() } });
    const dossier = await prisma.dossier.create({ data: { clientNom: "Beites Marie", clientAdresse: "2 rue Mistral", clientCp: "34250", clientVille: "Palavas", clientTelephone: "0685680447", clientEmail: "piresmarie@example.test", objet: "", source: "INCONNUE", etape: "SIMULATION", clientId: client.id } });
    let f = await fiche(client.id);
    assert.deepEqual([f.emails.length, f.telephones.length], [0, 0], "le cas vécu : fiche sans e-mail ni téléphone");

    const resultat = await coordonnees.enregistrerCoordonnees({ dossierId: dossier.id }, {});
    assert.equal(resultat.changements.length, 0);
    f = await fiche(client.id);
    assert.deepEqual([f.emails.map((e) => e.adresse), f.telephones.map((t) => t.numero)], [["piresmarie@example.test"], [normalisation.normaliserTelephone("0685680447")]]);

    await coordonnees.enregistrerCoordonnees({ dossierId: dossier.id }, { email: "marie.pires@example.test" });
    f = await fiche(client.id);
    assert.deepEqual(
      f.emails.map((e) => [e.adresse, e.principale]).sort(),
      [
        ["marie.pires@example.test", true],
        ["piresmarie@example.test", false],
      ]
    );
    assert.equal(f.telephones.length, 1, "rien ne double");
  });

  test("la migration de rattrapage : chaque fiche reçoit ce que ses dossiers savent, une fois", async () => {
    const client = await prisma.client.create({ data: { nom: "Fares Fawzi", prenom: "Fawzi", source: "ENTRANT", premierContactLe: new Date() } });
    await prisma.dossier.create({ data: { clientNom: "Fares Fawzi", clientAdresse: "", clientCp: "", clientVille: "Frontignan", clientTelephone: "0600000001", clientEmail: "fawzi@example.test", objet: "Cuisine", source: "ENTRANT", etape: "DEVIS_ENVOYE", clientId: client.id } });
    const bilan = await avecActeur(LUCAS, () => migrations.migrationCoordonneesVersFiche13.executer(prisma));
    assert.ok(bilan.coordonneesAjoutees >= 2, JSON.stringify(bilan));
    const f = await fiche(client.id);
    assert.deepEqual([f.emails.map((e) => e.adresse), f.telephones.length], [["fawzi@example.test"], 1]);
    assert.equal((await avecActeur(LUCAS, () => migrations.migrationCoordonneesVersFiche13.executer(prisma))).coordonneesAjoutees, 0);
  });
});

describe("B3 — dossier ouvert depuis l'espace : objet et source", () => {
  test("complementDuDossier : objet d'après la famille validée, source « espace client » quand elle manque ; rien d'écrit n'est écrasé", () => {
    assert.deepEqual(validations.complementDuDossier({ objet: "", source: "INCONNUE" }, { familles: { SDB: ["meuble-vasque"] } }), { objet: "Recouvrement de salle de bains", source: "ESPACE_CLIENT" });
    assert.deepEqual(validations.complementDuDossier({ objet: "", source: "ENTRANT" }, { familles: { CUISINE: [], MEUBLES: [] } }), { objet: "Recouvrement : cuisine, mobilier" });
    assert.equal(validations.complementDuDossier({ objet: "Cuisine de Paul", source: "ENTRANT" }, { familles: { CUISINE: [] } }), null);
    assert.deepEqual(validations.complementDuDossier({ objet: "", source: "INCONNUE" }, null), { source: "ESPACE_CLIENT" });
  });

  test("le client valide son projet : le dossier sans objet ni source les reçoit", async () => {
    const c = await contact("Zoé");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { objet: "", source: "INCONNUE" } });
    await service.enregistrerProjet(await espaceDe(c.espaceId), PROJET_CUISINE);
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    const d = await dossierDe(c.dossierId);
    assert.deepEqual([d.objet, d.source], ["Recouvrement de cuisine", "ESPACE_CLIENT"]);
  });

  test("la migration pose objet et source sur les projets déjà validés, une fois", async () => {
    const c = await contact("Yann");
    await service.enregistrerProjet(await espaceDe(c.espaceId), PROJET_CUISINE);
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { objet: "", source: "INCONNUE" } });
    const bilan = await avecActeur(LUCAS, () => migrations.migrationObjetDepuisProjet13.executer(prisma));
    assert.ok(bilan.objetsPoses >= 1 && bilan.sourcesPosees >= 1, JSON.stringify(bilan));
    const d = await dossierDe(c.dossierId);
    assert.deepEqual([d.objet, d.source], ["Recouvrement de cuisine", "ESPACE_CLIENT"]);
    assert.deepEqual(await avecActeur(LUCAS, () => migrations.migrationObjetDepuisProjet13.executer(prisma)), { espacesLus: 0, objetsPoses: 0, sourcesPosees: 0 });
  });
});

describe("B16 — délai de relance par défaut", () => {
  test("5 jours sans paramètre ; la migration l'a posé au 26/09/2026 et ne le repose pas", async () => {
    assert.deepEqual(await relances.lireDelaiRelance(new Date("2026-09-25T12:00:00Z")), { jours: 5, parametre: false });
    assert.deepEqual(await relances.lireDelaiRelance(new Date("2026-09-26T12:00:00Z")), { jours: 5, parametre: true });
    assert.deepEqual(await avecActeur(LUCAS, () => migrations.migrationDelaiRelance13.executer(prisma)), { pose: 0, dejaPose: 1 });
  });
});

describe("B19 — simulations du site dans Leads", () => {
  test("comptées, décrites, rattachées au lead quand il existe ; purgées et anciennes écartées ; l'image d'une purgée est refusée", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Léa", nom: "Site", telephone: "+33612345699", ville: "Pérols", source: "SITE_SIMULATEUR" } });
    const anonyme = await prisma.simulationSite.create({ data: { parcoursId: "p1", projet: "cuisine", references: JSON.stringify([{ zone: "facades", libelle: "Façades", ref: "NE31", nom: "Chêne clair" }]), page: "/simulateur", campagne: "rentree" } });
    await prisma.simulationSite.create({ data: { parcoursId: "p2", projet: "salle-de-bain", references: "[]", leadId: lead.id, rattacheeLe: new Date() } });
    const purgee = await prisma.simulationSite.create({ data: { parcoursId: "p3", projet: "meubles", references: "[]", imageAfterPath: "x.png", archiveLe: new Date(), archiveMotif: "purge" } });
    const vieille = await prisma.simulationSite.create({ data: { parcoursId: "p4", projet: "meubles", references: "[]", createdAt: new Date(Date.now() - 10 * 86_400_000) } });

    const r = await site.simulationsSiteRecentes(7);
    assert.deepEqual([r.total, r.anonymes, r.rattachees], [2, 1, 1]);
    const lignes = new Map(r.lignes.map((l) => [l.id, l]));
    assert.deepEqual([lignes.get(anonyme.id)?.teintes, lignes.get(anonyme.id)?.leadNom, lignes.get(anonyme.id)?.projetLibelle, lignes.get(anonyme.id)?.image], ["Façades : Chêne clair (NE31)", null, "Cuisine", false]);
    const rattachee = r.lignes.find((l) => l.leadId === lead.id)!;
    assert.deepEqual([rattachee.leadNom, rattachee.leadVille, rattachee.projetLibelle, rattachee.teintes], ["Léa Site", "Pérols", "Salle de bain", "teintes non renseignées"]);
    assert.ok(!lignes.has(purgee.id) && !lignes.has(vieille.id));
    await assert.rejects(site.imageSimulationSite(purgee.id, "image"), /purgée/);
  });
});

describe("B4/B5 — jeton Meta : un seul état, d'après les faits", () => {
  const BRUTE = 'ErreurDefinitive: Conversion refusée (HTTP 400) : {"error":{"message":"Error validating access token: The session is invalid because the user logged out.","type":"OAuthException","code":190,"error_subcode":467,"fbtrace_id":"x"}}';
  const PHRASE = "Leads reçus par le webhook ; lecture des formulaires et conversions impossibles (jeton à renouveler).";

  test("etatChaine : une phrase par cas", () => {
    const configuration = { lecture: true, conversions: true };
    const sain = { etat: "sain" as const };
    const rien = { conversionsRefusees: 0, leadsIllisibles: 0 };
    const partielle = sante.etatChaine({ recoit: "OUI", recoitDetail: "", configuration, jeton: { etat: "invalide" }, faits: { conversionsRefusees: 2, leadsIllisibles: 0 } });
    assert.deepEqual([partielle.code, partielle.libelle, partielle.jetonARenouveler, partielle.lectureImpossible, partielle.conversionsImpossibles], ["PARTIELLE", PHRASE, true, true, true]);
    assert.equal(sante.etatChaine({ recoit: "OUI", recoitDetail: "", configuration, jeton: sain, faits: rien }).code, "COMPLETE");
    assert.equal(sante.etatChaine({ recoit: "OUI", recoitDetail: "", configuration: { lecture: true, conversions: false }, jeton: sain, faits: rien }).libelle, "Leads reçus par le webhook ; conversions impossibles (META_PIXEL_ID ou jeton de conversions absent).");
    assert.equal(sante.etatChaine({ recoit: "NON", recoitDetail: "Il manque : META_APP_SECRET absente — le webhook refuse.", configuration, jeton: sain, faits: rien }).code, "COUPEE");
    const silence = sante.etatChaine({ recoit: "PRET", recoitDetail: "", configuration, jeton: { etat: "proche" }, faits: rien });
    assert.deepEqual([silence.code, silence.jetonARenouveler, silence.lectureImpossible], ["SILENCIEUSE", true, false]);
  });

  test("resumerRefus lit le message de Meta dans l'erreur brute ; sans réponse de Meta, verdictJeton tranche d'après les faits", () => {
    assert.equal(taches.resumerRefus(BRUTE), "Error validating access token: The session is invalid because the user logged out.");
    assert.equal(taches.resumerRefus("Jeton Meta refusé par Meta (code 190/467 : session invalide). À renouveler"), "code 190/467 : session invalide");
    const maintenant = new Date("2026-09-26T12:00:00Z");
    const refus = taches.verdictJeton(null, maintenant, { jetonPresent: true, refusLe: new Date("2026-09-25T10:00:00Z"), refusDetail: "session invalide" });
    assert.deepEqual([refus.etat, refus.message], ["invalide", "Jeton Meta refusé par Meta le 25/09/2026 (session invalide) : à renouveler (META_PAGE_ACCESS_TOKEN sur Railway)."]);
    assert.equal(taches.verdictJeton(null, maintenant, { jetonPresent: true, refusLe: null, refusDetail: null }).etat, "non_verifie");
    assert.equal(taches.verdictJeton(null, maintenant, { jetonPresent: false, refusLe: null, refusDetail: null }).etat, "absent");
    assert.equal(taches.verdictJeton(null, maintenant).etat, "absent");
  });

  test("en base : une conversion refusée pour jeton + des leads reçus = la phrase attendue, dans Publicité comme dans sante_systeme, une seule alerte sur le jeton", async () => {
    Object.assign(process.env, { META_PAGE_ACCESS_TOKEN: "jeton-present", META_PIXEL_ID: "123", META_APP_SECRET: "secret-essai", META_VERIFY_TOKEN: "verif-essai" });
    try {
      await prisma.metaLead.create({ data: { leadgenId: "m13-lead-1", soumisLe: new Date(), statut: "TRAITE" } });
      await prisma.tache.create({ data: { type: "META_CONVERSION", cle: "meta-conversion:m13", statut: "ECHEC_DEFINITIF", tentatives: 1, tentativesMax: 8, derniereErreur: BRUTE, demandeePar: "SYSTEME:meta" } });
      const faits = await taches.faitsJeton();
      assert.deepEqual([faits.conversionsRefusees, faits.leadsIllisibles, faits.jetonPresent, faits.refusDetail], [1, 0, true, "Error validating access token: The session is invalid because the user logged out."]);
      const resume = await sante.resumeChaineMeta();
      assert.deepEqual([resume.chaine.libelle, resume.jeton.etat], [PHRASE, "invalide"]);
      const s = await sante.santeMeta({ interrogerMeta: false });
      assert.equal(s.chaine.libelle, PHRASE);
      assert.equal(s.alertes.filter((a) => /jeton/i.test(a)).length, 1, JSON.stringify(s.alertes));
      const { santeSysteme } = await import("@/lib/assistant/outils/lecture");
      assert.equal((await santeSysteme()).meta?.message, PHRASE);
    } finally {
      Object.assign(process.env, { META_PAGE_ACCESS_TOKEN: "", META_PIXEL_ID: "", META_APP_SECRET: "", META_VERIFY_TOKEN: "" });
    }
  });
});
