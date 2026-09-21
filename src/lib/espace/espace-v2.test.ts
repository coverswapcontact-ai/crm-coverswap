import assert from "node:assert/strict";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-espace-v2-"));

let prisma: typeof import("@/lib/prisma").default;
let liens: typeof import("./liens");
let service: typeof import("./service");
let etapes: typeof import("./etapes");
let simulations: typeof import("@/lib/simulations/dossier");

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const photo = (nom = "cuisine.jpg") => new File([new Uint8Array(JPEG)], nom, { type: "image/jpeg" });

function reglerEnvironnement(): void {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  delete process.env.ESPACE_CLIENT_SECRET;
  process.env.SITE_URL = "https://coverswap.fr";
}

async function dossierAvecEspace(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espace: ouvert.espace };
}

const relire = async (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });

/** Une simulation publiée, avec ses teintes par zone. */
async function simulationPubliee(dossierId: string, zones: { zone: string; libelle: string; ref: string; nom: string }[], titre: string) {
  const vue = await simulations.deposerSimulationDossier(dossierId, photo(`${titre}.jpg`), { titre, preparationId: null });
  await prisma.simulationEspace.update({ where: { id: vue.id }, data: { zones: JSON.stringify(zones) } });
  await simulations.publierSimulations(dossierId, [vue.id], { prevenir: false });
  return vue.id;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  reglerEnvironnement();
  liens = await import("./liens");
  service = await import("./service");
  etapes = await import("./etapes");
  simulations = await import("@/lib/simulations/dossier");
});
after(async () => {
  await prisma.$disconnect();
});

describe("une seule chose à faire à la fois", () => {
  const base = { photos: 0, projet: false, simulationsCrm: 0, simulationsSite: 0, choix: false, devis: false, accord: false, acompteRecu: false, etapeDossier: "QUALIFICATION" };
  test("l'étape suit ce qui fait signer : devis > choix > photos > projet", () => {
    assert.equal(etapes.etapeEspace(base), "PHOTOS");
    assert.equal(etapes.etapeEspace({ ...base, photos: 2 }), "PROJET");
    // Espace v3 : projet précisé, il crée lui-même sa simulation (il n'attend plus CoverSwap).
    assert.equal(etapes.etapeEspace({ ...base, photos: 2, projet: true }), "SIMULATIONS");
    // Un lead du simulateur retrouve sa simulation : il ne lui reste qu'à préciser.
    assert.equal(etapes.etapeEspace({ ...base, simulationsSite: 1 }), "PROJET");
    assert.equal(etapes.etapeEspace({ ...base, simulationsCrm: 2 }), "SIMULATIONS", "des simulations à choisir passent devant les photos manquantes");
    assert.equal(etapes.etapeEspace({ ...base, simulationsCrm: 2, choix: true, projet: true, photos: 1 }), "ATTENTE_DEVIS");
    assert.equal(etapes.etapeEspace({ ...base, devis: true }), "DEVIS", "un devis à signer passe devant tout le reste");
    assert.equal(etapes.etapeEspace({ ...base, devis: true, accord: true }), "ACOMPTE");
    assert.equal(etapes.etapeEspace({ ...base, devis: true, accord: true, acompteRecu: true }), "CHANTIER");
    assert.equal(etapes.etapeEspace({ ...base, etapeDossier: "ENCAISSE" }), "TERMINE");
    const progression = etapes.progression({ ...base, photos: 1, projet: true, simulationsCrm: 1 });
    assert.deepEqual(progression.map((e) => [e.cle, e.fait, e.courante]), [["PHOTOS", true, false], ["PROJET", true, false], ["SIMULATIONS", false, true], ["DEVIS", false, false], ["ACOMPTE", false, false]]);
    // Devis et Paiement verrouillés, avec ce qui les débloque, dit au client.
    assert.deepEqual(progression.map((e) => [e.cle, e.verrouillee, e.libelle]), [["PHOTOS", false, "Photos"], ["PROJET", false, "Projet"], ["SIMULATIONS", false, "Simulations"], ["DEVIS", true, "Devis"], ["ACOMPTE", true, "Paiement"]]);
    assert.equal(progression.find((e) => e.cle === "DEVIS")?.raison, "Validez une simulation pour recevoir votre devis.");
    const validee = etapes.progression({ ...base, photos: 1, projet: true, simulationsClient: 1, choix: true });
    assert.equal(validee.find((e) => e.cle === "DEVIS")?.verrouillee, false, "une simulation validée débloque le devis");
    assert.equal(validee.find((e) => e.cle === "ACOMPTE")?.verrouillee, true, "le paiement attend le bon pour accord");
  });
});

describe("visites et dépôts en rafale", () => {
  test("deux ouvertures simultanées : une seule visite, une seule « première ouverture »", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Zoé");
    await Promise.all([service.noterVisite(espace), service.noterVisite(espace), service.noterVisite(espace)]);
    const relu = await relire(espace.id);
    assert.equal(relu.nbAcces, 1);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_VISITE" } }), 1);
  });

  test("photos envoyées une à une : un seul événement, qui compte tout le dépôt", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Anaïs");
    for (const nom of ["a.jpg", "b.jpg", "c.jpg"]) await service.deposerPhotos(espace, [photo(nom)]);
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "ESPACE_PHOTOS" } });
    assert.deepEqual(evenements.map((e) => e.contenu), ["3 photos déposées par le client dans son espace"]);
    assert.deepEqual(await service.alerterPhotosDeposees(dossierId), { photos: 3 });
  });
});

describe("le projet du client", () => {
  test("enregistré en un geste, résumé dans le dossier ; l'ancien format reste lisible", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Olivia", { tailleCuisine: "Moyenne", delaiProjet: "COURT", occupation: "PROPRIETAIRE" });
    const avant = await service.etatEspace(espace);
    assert.deepEqual([avant.connu.delai, avant.connu.proprietaire, avant.connu.tailleCuisine, avant.etape], ["vite", true, "Moyenne", "PHOTOS"], "ce que le formulaire a dit n'est jamais redemandé");
    await service.enregistrerProjetOuSouhaits(espace, { zones: ["meubles-hauts", "plan-de-travail"], styles: ["bois-clair", "blanc"], metres: 5, repere: "en-l", delai: "vite", precisions: "Garder les poignées" });
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "ESPACE_SOUHAITS" } });
    assert.match(evenement?.contenu ?? "", /Façades hautes, Plan de travail · ≈ 5 m \(en l\) · Bois clair, Blanc · dès que possible · « Garder les poignées »/, "les goûts et le délai d'avant la v3 ne se perdent pas");
    const etat = await service.etatEspace(await relire(espace.id));
    assert.deepEqual(etat.monProjet?.zones, ["meubles-hauts", "plan-de-travail"]);
    await assert.rejects(service.enregistrerProjetOuSouhaits(espace, { zones: [], metres: 999 }), /60 mètres/);

    // v3 : zones, taille, note. Enregistré à la frappe : une seule alerte, différée, avec la version posée.
    const v3 = await dossierAvecEspace("Rose");
    await service.enregistrerProjetOuSouhaits(v3.espace, { zones: ["meubles-bas"], metres: null, repere: null, precisions: "" });
    await service.enregistrerProjetOuSouhaits(await relire(v3.espace.id), { zones: ["meubles-bas", "autre"], metres: 3, repere: "une-rangee", precisions: "Aussi la porte du cellier" });
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId: v3.dossierId, type: "ESPACE_SOUHAITS" } }), 1, "un événement, mis à jour");
    assert.match((await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId: v3.dossierId, type: "ESPACE_SOUHAITS" } })).contenu, /Façades basses, Autre chose · ≈ 3 m \(un seul mur\) · « Aussi la porte du cellier »$/);
    const taches = await prisma.tache.findMany({ where: { type: service.TACHE_ALERTE_PROJET, cle: `espace-projet:${v3.espace.id}` } });
    assert.equal(taches.length, 1, "une seule alerte pour toute la saisie");
    assert.ok(taches[0].prochainEssaiLe.getTime() > Date.now() + 120_000, "elle part quelques minutes après");
    assert.deepEqual(await service.alerterProjetPrecise(v3.espace.id), { envoyee: true });
    // Rien de saisi dans Paramètres : 5 simulations offertes (pas 0) ; et personne ne lui promet une proposition.
    assert.equal(await service.simulationsGratuites(), 5);
    const etatV3 = await service.etatEspace(await relire(v3.espace.id));
    assert.deepEqual([etatV3.creation.restantes, etatV3.simulationsEnPreparation], [5, null]);
    const noteSeule = await dossierAvecEspace("Sacha");
    await service.enregistrerProjetOuSouhaits(noteSeule.espace, { zones: [], metres: null, repere: null, precisions: "Je ne sais pas encore" });
    // Depuis le 22/09 : la pastille verte vient de la VALIDATION du projet, et un mot seul ne suffit pas à le valider.
    const etatNote = await service.etatEspace(await relire(noteSeule.espace.id));
    assert.deepEqual([etatNote.etapes.find((e) => e.cle === "PROJET")?.fait, etatNote.projetManque], [false, "Indiquez ce que vous voulez traiter."]);

    const ancien = await dossierAvecEspace("Paul");
    await service.enregistrerProjetOuSouhaits(ancien.espace, { teintes: ["Bois clair", "Noir"], style: "Chaleureux", propositions: true, precisions: "" });
    const lu = (await service.etatEspace(await relire(ancien.espace.id))).monProjet;
    assert.deepEqual([lu?.styles, lu?.propositions], [["bois-clair"], true]);
    assert.match(lu?.precisions ?? "", /Teintes : Noir · Ambiance : Chaleureux/);
  });
});

describe("les simulations côté client", () => {
  test("choix composite : les meubles hauts de l'une, le plan de travail de l'autre", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Quentin");
    const chene = await simulationPubliee(dossierId, [{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "AA01", nom: "Beige Oak" }, { zone: "plan-de-travail", libelle: "Plan de travail", ref: "NE31", nom: "Statuary White" }], "Chêne");
    const blanc = await simulationPubliee(dossierId, [{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "J3", nom: "Ultra White" }, { zone: "plan-de-travail", libelle: "Plan de travail", ref: "K5", nom: "Cement Grey" }], "Blanc");
    const brouillon = await simulations.deposerSimulationDossier(dossierId, photo("brouillon.jpg"), { preparationId: null });
    await assert.rejects(service.choisir(espace, { zones: [{ zone: "meubles-hauts", simulationId: brouillon.id }], commentaire: "" }), /introuvable/, "un brouillon ne se choisit pas");
    await assert.rejects(service.choisir(espace, { zones: [{ zone: "credence", simulationId: chene }], commentaire: "" }), /n'existe pas/);

    const choix = await service.choisir(espace, { zones: [{ zone: "meubles-hauts", simulationId: blanc }, { zone: "plan-de-travail", simulationId: chene }], commentaire: "Parfait" });
    assert.equal(choix.mode, "COMPOSITE");
    const etat = await service.etatEspace(await relire(espace.id));
    assert.equal(etat.choix?.mode, "COMPOSITE");
    assert.deepEqual(etat.simulations.map((s) => s.choisie), [true, true]);
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "ESPACE_SIMULATION_CHOISIE" } });
    assert.match(evenement?.contenu ?? "", /Meubles hauts — Ultra White \(J3\) · Plan de travail — Statuary White \(NE31\) : « Parfait »/);
    assert.match((await prisma.dossier.findUnique({ where: { id: dossierId } }))?.prochaineAction ?? "", /Préparer le devis/);

    // Changer d'avis : une seule simulation entière, l'autre n'est plus choisie.
    await service.choisir(await relire(espace.id), { simulationId: chene, commentaire: "" });
    const apres = await service.etatEspace(await relire(espace.id));
    assert.deepEqual(apres.simulations.map((s) => [s.titre, s.choisie]), [["Chêne", true], ["Blanc", false]]);
  });

  test("demander une autre proposition : la main repasse à Lucas", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Rose");
    const sim = await simulationPubliee(dossierId, [], "Première");
    await service.demanderProposition(espace, { commentaire: "Plus clair, svp", simulationId: sim });
    const relu = await relire(espace.id);
    assert.ok(relu.propositionDemandeeLe);
    assert.match((await prisma.dossier.findUnique({ where: { id: dossierId } }))?.prochaineAction ?? "", /autre proposition/);
    assert.match((await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "ESPACE_NOUVELLE_PROPOSITION" } }))?.contenu ?? "", /« Plus clair, svp »/);
  });

  test("les simulations faites sur le site rejoignent l'espace, publiées, sans doublon ; leurs rendus ne comptent pas comme photos", async () => {
    const lead = await prisma.lead.create({ data: { prenom: "Sacha", nom: "Essai", telephone: "+33612121212", ville: "Lattes", source: "SITE_SIMULATEUR" } });
    const dossier = await prisma.dossier.create({ data: { leadId: lead.id, clientNom: "Sacha Essai", clientAdresse: "", clientCp: "34970", clientVille: "Lattes", clientTelephone: "+33612121212", objet: "", source: "ENTRANT", etape: "QUALIFICATION" } });
    await fs.mkdir(path.join(process.env.UPLOADS_DIR!, lead.id, "s1"), { recursive: true });
    await fs.writeFile(path.join(process.env.UPLOADS_DIR!, lead.id, "s1", "after.png"), PNG);
    await fs.writeFile(path.join(process.env.UPLOADS_DIR!, lead.id, "s1", "before.jpg"), JPEG);
    const { rangerImagesDuLead } = await import("@/lib/dossiers/depuis-lead");
    const simulation = await prisma.simulation.create({ data: { leadId: lead.id, imageAfterPath: `${lead.id}/s1/after.png`, imageBeforePath: `${lead.id}/s1/before.jpg`, notes: "Façades (toutes) : AA01 (Beige Oak)" } });
    await rangerImagesDuLead(lead.id, dossier.id);
    // Rendu et photo avant copiés dans les photos du dossier ; seul l'« avant » est une photo du client.
    const copies = JSON.parse((await prisma.simulation.findUniqueOrThrow({ where: { id: simulation.id } })).photosDossier ?? "{}");
    assert.ok(copies.rendu && copies.avant);
    const photos = await service.photosDuClient(dossier.id, (await prisma.dossier.findUniqueOrThrow({ where: { id: dossier.id } })).photos);
    assert.deepEqual(photos.map((p) => p.id), [copies.avant]);

    const { espace } = await liens.ouvrirEspace(dossier.id);
    const etat = await service.etatEspace(espace);
    assert.deepEqual(etat.simulations.map((s) => [s.source, s.zones[0]?.ref]), [["SITE", "AA01"]]);
    assert.equal(etat.etape, "PROJET", "il a vu son rendu : il ne lui reste qu'à préciser");
    assert.equal(await simulations.rangerSimulationsSiteDansLEspace(dossier.id), 0, "rejouer ne crée rien");
    assert.equal(await prisma.simulationEspace.count({ where: { dossierId: dossier.id } }), 1);
  });
});

describe("le devis dans l'espace", () => {
  async function avecDevis(prenom: string) {
    const ouvert = await dossierAvecEspace(prenom);
    const lignes = JSON.stringify([{ type: "SECTION", libelle: "Cuisine" }, { type: "PRESTATION", designation: "Recouvrement des façades", sousDesignation: "Film Cover Styl' AA01", quantite: 6, unite: "ml", prixUnitaire: 120 }]);
    const devis = await prisma.document.create({ data: { dossierId: ouvert.dossierId, type: "DEVIS", numero: `D-${prenom}`, dateEmission: new Date(), objet: "Recouvrement de cuisine", lignes, totalHt: 720, acomptePct: 30, statut: "ENVOYE" } });
    return { ...ouvert, devis };
  }

  test("lisible sur le téléphone : lignes, total, acompte, conditions du PDF", async () => {
    const { espace } = await avecDevis("Tom");
    const etat = await service.etatEspace(espace);
    assert.equal(etat.etape, "DEVIS");
    assert.deepEqual([etat.devis?.total, etat.devis?.acompte, etat.devis?.solde], [720, 216, 504]);
    assert.deepEqual(etat.devis?.lignes.map((l) => l.type), ["SECTION", "PRESTATION"]);
    assert.ok(etat.devis?.conditions.some((c) => /Acompte de 30% à la signature du devis, soit 216,00 € TTC/.test(c)));
    assert.ok(etat.devis?.conditions.some((c) => /valable 30 jours/.test(c)));
  });

  test("consultations comptées une fois par visite ; la troisième sonne", async () => {
    const { espace, dossierId, devis } = await avecDevis("Ugo");
    assert.deepEqual(await service.noterConsultationDevis(espace, devis.id), { consultations: 1 });
    assert.deepEqual(await service.noterConsultationDevis(await relire(espace.id), devis.id), { consultations: 1 }, "même visite : pas de double compte");
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { devisConsulteLe: new Date(Date.now() - 3_600_000) } });
    assert.deepEqual(await service.noterConsultationDevis(await relire(espace.id), devis.id), { consultations: 2 });
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { devisConsulteLe: new Date(Date.now() - 3_600_000) } });
    assert.deepEqual(await service.noterConsultationDevis(await relire(espace.id), devis.id), { consultations: 3 });
    const evenements = await prisma.dossierEvenement.findMany({ where: { dossierId, type: "ESPACE_DEVIS_CONSULTE" } });
    assert.equal(evenements.length, 1, "un seul événement, mis à jour");
    assert.match(evenements[0].contenu, /3 fois/);
  });

  test("deux ouvertures simultanées du devis (page + PDF, double appui) : une consultation, un événement", async () => {
    const { espace, dossierId, devis } = await avecDevis("Wanda");
    const resultats = await Promise.all([service.noterConsultationDevis(espace, devis.id), service.noterConsultationDevis(espace, devis.id), service.noterConsultationDevis(espace, devis.id)]);
    assert.deepEqual(resultats.map((r) => r.consultations), [1, 1, 1]);
    assert.equal((await relire(espace.id)).devisConsultations, 1);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_DEVIS_CONSULTE" } }), 1);
  });

  test("bon pour accord avec signature au doigt : l'image est gardée avec l'accord ; une signature invalide est ignorée", async () => {
    const { espace, devis } = await avecDevis("Vera");
    await service.accepterDevis(espace, { documentId: devis.id, nom: "Vera Essai", accepte: true, signature: `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(300)]).toString("base64")}` }, { ip: "203.0.113.9", navigateur: "Safari" });
    const accord = await prisma.accordDevis.findFirstOrThrow({ where: { documentId: devis.id } });
    assert.match(accord.signature ?? "", /^dossiers\/.+\/accords\/signature-/);
    assert.ok((await fs.stat(path.join(process.env.UPLOADS_DIR!, accord.signature!))).size > 0);
    const etat = await service.etatEspace(await relire(espace.id));
    assert.deepEqual([etat.etape, etat.acompte?.montant, etat.acompte?.complet], ["ACOMPTE", 216, false]);

    const autre = await avecDevis("Willy");
    await service.accepterDevis(autre.espace, { documentId: autre.devis.id, nom: "Willy", accepte: true, signature: "data:image/png;base64,AAAA" }, { ip: null, navigateur: null });
    assert.equal((await prisma.accordDevis.findFirstOrThrow({ where: { documentId: autre.devis.id } })).signature, null);
  });
});

describe("l'aperçu de Lucas", () => {
  test("marque signée, valable deux jours, propre à l'espace et à sa version", async () => {
    const a = await dossierAvecEspace("Xavier");
    const b = await dossierAvecEspace("Yasmine");
    const marque = new URL(liens.lienApercu(a.espace)).searchParams.get("apercu");
    assert.equal(liens.apercuValide(a.espace, marque), true);
    assert.equal(liens.apercuValide(b.espace, marque), false);
    assert.equal(liens.apercuValide({ ...a.espace, version: a.espace.version + 1 }, marque), false, "un nouveau lien invalide l'aperçu");
    assert.equal(liens.apercuValide(a.espace, marque, Date.now() + 3 * 86_400_000), false);
    assert.equal(liens.apercuValide(a.espace, "x".repeat(16)), false);
  });
});

describe("le devis part du choix du client", () => {
  const presets = [
    { id: "p1", designation: "Revêtement adhésif — cuisine / façades", unite: "ml" as const, prixUnitaire: 110 },
    { id: "p2", designation: "Revêtement adhésif — cuisine (variante)", unite: "ml" as const, prixUnitaire: 120 },
    { id: "p3", designation: "Dépose / repose nouvelle crédence", unite: "forfait" as const, prixUnitaire: 650 },
    { id: "p4", designation: "Nouvelle crédence Dibond", unite: "forfait" as const, prixUnitaire: 350 },
    { id: "p5", designation: "Consommables", unite: "forfait" as const, prixUnitaire: 80 },
  ];

  test("façades ensemble au tarif du mètre, avec ses mètres ; ailleurs, jamais de prix inventé", async () => {
    const { proposerLignes } = await import("./devis-propose");
    const lignes = proposerLignes(
      [
        { zone: "meubles-hauts", libelle: "Meubles hauts", ref: "J3", nom: "Ultra White" },
        { zone: "meubles-bas", libelle: "Meubles bas", ref: "AA01", nom: "Beige Oak" },
        { zone: "plan-de-travail", libelle: "Plan de travail", ref: "NE31", nom: "Statuary White" },
        { zone: "credence", libelle: "Crédence", ref: "NE24", nom: "Concrete" },
      ],
      5,
      presets
    );
    assert.deepEqual(
      lignes.map((l) => [l.designation, l.sousDesignation, l.quantite, l.unite, l.prixUnitaire]),
      [
        ["Revêtement adhésif — cuisine / façades", "Meubles hauts : Ultra White (J3) · Meubles bas : Beige Oak (AA01)", 5, "ml", 110],
        // Pas de tarif « plan de travail » : prix et longueur à saisir, le générateur ne laisse pas passer.
        ["Revêtement adhésif — plan de travail", "Statuary White (NE31)", null, "ml", null],
        // Une nouvelle crédence (Dibond, dépose) n'est pas une crédence recouverte.
        ["Revêtement adhésif — crédence", "Concrete (NE24)", null, "ml", null],
      ]
    );
  });

  test("les mètres de meubles ne vont ni au plan de travail ni à la crédence ; une zone inconnue a sa ligne", async () => {
    const { proposerLignes } = await import("./devis-propose");
    const seul = proposerLignes([{ zone: "plan-de-travail", libelle: "Plan de travail", ref: "NE31", nom: "Statuary White" }], 5, presets);
    assert.equal(seul[0].quantite, null);
    const autre = proposerLignes([{ zone: "carrelage-mural", libelle: "Murs carrelés", ref: null, nom: null }], 4, presets);
    assert.deepEqual([autre[0].designation, autre[0].sousDesignation, autre[0].prixUnitaire], ["Revêtement adhésif — murs carrelés", "", null]);
  });

  test("d'un espace : la simulation choisie donne les teintes, le projet les mètres", async () => {
    const { devisProposeDuDossier } = await import("./devis-propose");
    const { dossierId, espace } = await dossierAvecEspace("Yvette");
    assert.equal(await devisProposeDuDossier(dossierId), null, "rien dit, rien proposé");
    await service.enregistrerProjetOuSouhaits(espace, { zones: ["meubles-hauts", "meubles-bas"], styles: ["blanc"], metres: 6, repere: null, delai: null, precisions: "" });
    const depuisProjet = await devisProposeDuDossier(dossierId);
    assert.equal(depuisProjet?.lignes.length, 1);
    assert.equal(depuisProjet?.lignes[0].quantite, 6);
    assert.equal(depuisProjet?.lignes[0].sousDesignation, "", "sans choix, pas de teinte");
    assert.match(depuisProjet?.resume ?? "", /teintes à préciser/);

    const blanc = await simulationPubliee(dossierId, [{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "J3", nom: "Ultra White" }, { zone: "meubles-bas", libelle: "Meubles bas", ref: "K1", nom: "Black Mat" }], "Blanc et noir");
    await service.choisir(await relire(espace.id), { simulationId: blanc, commentaire: "" });
    const depuisChoix = await devisProposeDuDossier(dossierId);
    assert.equal(depuisChoix?.lignes[0].sousDesignation, "Meubles hauts : Ultra White (J3) · Meubles bas : Black Mat (K1)");
    assert.equal(depuisChoix?.lignes[0].quantite, 6);
    assert.match(depuisChoix?.resume ?? "", /Yvette.*Ultra White.*≈ 6 m/);
  });
});

describe("Espaces clients (v3)", () => {
  test("qui a la main : ses photos sans aucune simulation → moi ; sa propre simulation → lui", async () => {
    const { ajouterPhoto } = await import("@/lib/dossiers/dossiers");
    const { listerEspaces } = await import("./suivi");
    const seulesPhotos = await dossierAvecEspace("Yvon");
    await ajouterPhoto(seulesPhotos.dossierId, photo("vue.jpg"));
    const aSimule = await dossierAvecEspace("Zelie");
    await ajouterPhoto(aSimule.dossierId, photo("vue.jpg"));
    await prisma.simulationEspace.create({ data: { espaceId: aSimule.espace.id, dossierId: aSimule.dossierId, chemin: "x/simulation.png", source: "CLIENT", statut: "PUBLIEE", publieeLe: new Date() } });

    const lignes = await listerEspaces();
    const yvon = lignes.find((l) => l.dossierId === seulesPhotos.dossierId)!;
    const zelie = lignes.find((l) => l.dossierId === aSimule.dossierId)!;
    assert.deepEqual([yvon.attente.qui, yvon.attente.geste, yvon.signaux.some((s) => s.code === "PHOTOS_SANS_SIMULATION")], ["MOI", "SIMULATEUR", true]);
    assert.equal(zelie.attente.qui, "CLIENT", "il a sa simulation : à lui de la valider");
    assert.equal(zelie.signaux.some((s) => s.code === "PHOTOS_SANS_SIMULATION"), false);
    assert.deepEqual([zelie.faits.simulationsClient, zelie.faits.simulationsPubliees], [1, 0], "« publiées par moi » ne compte que celles de CoverSwap");
  });
});
