import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-coherence-"));

/**
 * Mission du 22/09/2026 : tout ce que le client valide se dévalide, tout ce que
 * Lucas fait se défait, et le dossier, l'espace, les finances et Leads disent
 * la même chose à chaque geste. Chaque essai fait l'aller ET le retour.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let validations: typeof import("@/lib/espace/validations");
let vueCrm: typeof import("@/lib/espace/vue-crm");
let suivi: typeof import("@/lib/espace/suivi");
let simulations: typeof import("@/lib/simulations/dossier");
let encaissements: typeof import("@/lib/encaissements/service");
let transitions: typeof import("@/lib/dossiers/transitions");
let controle: typeof import("./controle");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = (nom = "cuisine.jpg") => new File([new Uint8Array(JPEG)], nom, { type: "image/jpeg" });
const LIGNES = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement de 12 façades", quantite: 10, unite: "ml", prixUnitaire: 150 }]);

async function client(prenom: string, donnees: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS", ...donnees } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id };
}
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const etapeDe = async (dossierId: string) => (await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape;
const evenements = async (dossierId: string, type: string) => prisma.dossierEvenement.count({ where: { dossierId, type } });

async function simulationPubliee(dossierId: string, titre: string) {
  const vue = await simulations.deposerSimulationDossier(dossierId, photo(`${titre}.jpg`), { titre, preparationId: null });
  await prisma.simulationEspace.update({ where: { id: vue.id }, data: { zones: JSON.stringify([{ zone: "meubles-hauts", libelle: "Meubles hauts", ref: "NE31", nom: "Chêne clair" }]) } });
  await simulations.publierSimulations(dossierId, [vue.id], { prevenir: false });
  return vue.id;
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  validations = await import("@/lib/espace/validations");
  vueCrm = await import("@/lib/espace/vue-crm");
  suivi = await import("@/lib/espace/suivi");
  simulations = await import("@/lib/simulations/dossier");
  encaissements = await import("@/lib/encaissements/service");
  transitions = await import("@/lib/dossiers/transitions");
  controle = await import("./controle");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("le projet : valider, modifier (dévalide), revalider — le dossier suit dans les deux sens", () => {
  test("pastille verte des deux côtés, recul à la modification, historique des deux mouvements", async () => {
    const c = await client("Agathe");
    await service.deposerPhotos(await espaceDe(c.espaceId), [photo()]);
    // Incomplet : ne se valide pas, et dit pourquoi.
    await service.enregistrerProjet(await espaceDe(c.espaceId), { zones: ["meubles-hauts"], styles: [], propositions: false, metres: null, repere: null, delai: null, precisions: "" });
    await assert.rejects(validations.validerProjet(await espaceDe(c.espaceId), "CLIENT"), /taille de votre cuisine/);
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).etape, "PROJET");

    await service.enregistrerProjet(await espaceDe(c.espaceId), { zones: ["meubles-hauts", "meubles-bas"], styles: [], propositions: false, metres: null, repere: "en-l", delai: null, precisions: "Garder les poignées" });
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.projetValide?.par, etat.etape, etat.etapes.find((e) => e.cle === "PROJET")?.fait], ["CLIENT", "SIMULATIONS", true]);
    assert.equal(await etapeDe(c.dossierId), "SIMULATION");
    const ligne = (await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!;
    assert.ok(ligne.faits.projetValideLe, "Espaces clients voit la pastille verte");
    assert.match((await vueCrm.vueEspaceCrm(c.dossierId))!.projet!.resume, /Garder les poignées/);

    // Il modifie son projet : dévalidé, le dossier recule, le CRM le sait.
    await service.enregistrerProjet(await espaceDe(c.espaceId), { zones: ["meubles-hauts"], styles: [], propositions: false, metres: null, repere: "en-l", delai: null, precisions: "Garder les poignées" });
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.projetValide, etat.etape], [null, "PROJET"]);
    assert.equal(await etapeDe(c.dossierId), "QUALIFICATION");
    assert.equal((await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!.faits.projetValideLe, null);

    // Il revalide : tout revient. L'historique garde les deux mouvements, avant comme arrière.
    await validations.validerProjet(await espaceDe(c.espaceId), "CLIENT");
    assert.equal(await etapeDe(c.dossierId), "SIMULATION");
    assert.deepEqual([await evenements(c.dossierId, "ESPACE_PROJET_VALIDE"), await evenements(c.dossierId, "ESPACE_PROJET_DEVALIDE")], [2, 1]);
    const mouvements = await prisma.dossierEvenement.findMany({ where: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "asc" }, select: { contenu: true } });
    assert.ok(mouvements.some((m) => /retour en arrière/.test(m.contenu)) && mouvements.filter((m) => /projet validé/.test(m.contenu)).length === 2, JSON.stringify(mouvements));
  });

  test("Lucas valide et dévalide à la place du client ; un dossier qu'il a avancé lui-même ne recule pas", async () => {
    const c = await client("Bruno");
    await service.enregistrerProjet(await espaceDe(c.espaceId), { zones: ["plan-de-travail"], styles: [], propositions: false, metres: 4, repere: null, delai: null, precisions: "" });
    await avecActeur(LUCAS, () => vueCrm.gesteDeLucas(c.dossierId, { geste: "valider-projet" }));
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))!.projetValide?.par, "LUCAS");
    assert.equal(await etapeDe(c.dossierId), "SIMULATION");
    // Lucas envoie un devis entre-temps : dévalider le projet ne touche plus à l'étape.
    await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-BRUNO", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    await avecActeur(LUCAS, () => vueCrm.gesteDeLucas(c.dossierId, { geste: "devalider-projet" }));
    assert.equal(await etapeDe(c.dossierId), "DEVIS_ENVOYE");
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))!.projetValide, null);
  });
});

describe("quota : 5 offertes, celles du site comptent", () => {
  test("2 simulations faites sur le site avant le lien : il en reste 3", async () => {
    const c = await client("Chloé", { source: "SITE_SIMULATEUR" });
    const espace = await espaceDe(c.espaceId);
    for (const n of [1, 2]) {
      await prisma.simulationEspace.create({ data: { espaceId: espace.id, dossierId: c.dossierId, chemin: `dossiers/${c.dossierId}/simulations/site-${n}.png`, source: "SITE", statut: "PUBLIEE", publieeLe: new Date(), titre: "Votre simulation sur coverswap.fr" } });
    }
    const etat = await service.etatEspace(espace);
    assert.deepEqual([etat.creation.gratuites, etat.creation.faites, etat.creation.faitesSite, etat.creation.restantes], [5, 2, 2, 3]);
    assert.equal((await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!.faits.simulationsRestantes, 3);
    // Toutes les pièces du site sont proposées, pas seulement la cuisine.
    assert.deepEqual(etat.creation.pieces.map((p) => p.piece), ["CUISINE", "SDB", "MEUBLES", "PRO", "MURS"]);
    assert.ok(etat.creation.pieces.find((p) => p.piece === "SDB")!.zones.some((z) => z.zone === "carrelage-mural"));
  });
});

describe("le client défait ce qu'il a fait", () => {
  test("une photo retirée sort de son espace, reste chez Lucas, qui peut la remettre", async () => {
    const c = await client("Denis");
    await service.deposerPhotos(await espaceDe(c.espaceId), [photo("a.jpg"), photo("b.jpg")]);
    const avant = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(avant.photos.length, 2);
    await validations.retirerPhoto(await espaceDe(c.espaceId), avant.photos[0].id, "CLIENT");
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).photos.length, 1);
    const vue = (await vueCrm.vueEspaceCrm(c.dossierId))!;
    assert.deepEqual([vue.photos.length, vue.photosRetirees.length, vue.photosRetirees[0].par], [1, 1, "CLIENT"]);
    assert.ok((await vueCrm.lirePhotoRetiree(c.dossierId, avant.photos[0].id)).contenu.length > 0, "le fichier n'a pas bougé");
    assert.equal(await evenements(c.dossierId, "ESPACE_PHOTO_RETIREE"), 1);
    await avecActeur(LUCAS, () => vueCrm.gesteDeLucas(c.dossierId, { geste: "remettre-photo", photoId: avant.photos[0].id }));
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).photos.length, 2);
  });

  test("simulation validée puis dévalidée, puis une autre ; devis émis : seul Lucas peut encore changer ; masquer la validée la dévalide", async () => {
    const c = await client("Élise");
    const une = await simulationPubliee(c.dossierId, "Chêne");
    const deux = await simulationPubliee(c.dossierId, "Noyer");
    await service.choisir(await espaceDe(c.espaceId), { simulationId: une, commentaire: "" });
    assert.match((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction ?? "", /Préparer le devis/);
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId: c.dossierId, type: "ESPACE_SIMULATION_CHOISIE" } });
    assert.match(evenement?.contenu ?? "", /Chêne clair \(NE31\)/, "les teintes validées sont écrites dans le dossier");

    await validations.devaliderChoix(await espaceDe(c.espaceId), "CLIENT");
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.choix, etat.etapes.find((e) => e.cle === "DEVIS")?.verrouillee], [null, true]);
    assert.doesNotMatch((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction ?? "", /Préparer le devis/);

    await service.choisir(await espaceDe(c.espaceId), { simulationId: deux, commentaire: "" });
    await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-ELISE", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await assert.rejects(validations.devaliderChoix(await espaceDe(c.espaceId), "CLIENT"), /déjà établi/);
    // Lucas masque la simulation validée : le choix tombe avec elle (le client ne valide pas ce qu'il ne voit plus).
    await avecActeur(LUCAS, () => simulations.changerStatutSimulation(c.dossierId, deux, "masquer"));
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(etat.choix, null);
    assert.equal(await evenements(c.dossierId, "ESPACE_SIMULATION_DEVALIDEE"), 2);
  });

  test("demande d'autre proposition : le mot du client arrive ENTIER partout, et la demande se retire", async () => {
    const c = await client("Fanny");
    const sim = await simulationPubliee(c.dossierId, "Marbre");
    const mot = "Je ne sais pas quoi prendre, plutôt quelque chose de clair qui ne marque pas les traces de doigts";
    await service.demanderProposition(await espaceDe(c.espaceId), { commentaire: mot, simulationId: sim });
    const vue = (await vueCrm.vueEspaceCrm(c.dossierId))!;
    assert.equal(vue.proposition?.message, mot);
    assert.equal((await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!.faits.proposition?.message, mot);
    assert.match((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction ?? "", /quelque chose de clair/);
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).propositionMessage, mot);

    await validations.retirerDemandeProposition(await espaceDe(c.espaceId), "CLIENT");
    assert.equal((await vueCrm.vueEspaceCrm(c.dossierId))!.proposition, null);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: c.dossierId } })).prochaineAction, null);
    const retrait = await prisma.dossierEvenement.findFirst({ where: { dossierId: c.dossierId, type: "ESPACE_PROPOSITION_RETIREE" } });
    assert.match(retrait?.contenu ?? "", /traces de doigts/, "le mot n'est pas perdu : il reste dans l'historique");
  });

  test("bon pour accord donné puis retiré : Signé → Devis envoyé, la preuve reste ; redonné : Signé ; après un paiement, il ne se retire plus seul", async () => {
    const c = await client("Gilles");
    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-GILLES", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: devis.id, nom: "Gilles Essai", accepte: true }, { ip: null, navigateur: null });
    assert.equal(await etapeDe(c.dossierId), "SIGNE");
    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.devis?.accepte?.source, etat.devis?.accepte?.retirable, etat.etape], ["ESPACE", true, "ACOMPTE"]);

    await validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT", "Je préfère attendre janvier");
    assert.equal(await etapeDe(c.dossierId), "DEVIS_ENVOYE");
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: devis.id } })).statut, "GENERE");
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.devis?.accepte, etat.etape, etat.paiement], [null, "DEVIS", null]);
    const accords = await prisma.accordDevis.findMany({ where: { dossierId: c.dossierId } });
    assert.deepEqual([accords.length, accords[0].retirePar, accords[0].retireMotif], [1, "CLIENT", "Je préfère attendre janvier"]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: c.leadId } })).statut, "DEVIS_ENVOYE", "Leads suit le recul");

    // Il resigne : nouvelle preuve, l'ancienne est gardée.
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: devis.id, nom: "Gilles Essai", accepte: true }, { ip: null, navigateur: null });
    assert.equal(await etapeDe(c.dossierId), "SIGNE");
    assert.equal(await prisma.accordDevis.count({ where: { dossierId: c.dossierId } }), 2);

    // Acompte encaissé : l'espace le montre payé, et l'accord ne se retire plus d'un geste.
    await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 450, moyen: "CHEQUE", recuLe: "2026-09-20", reference: null } }));
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.paiement?.acompte?.statut, etat.paiement?.acompte?.moyen, etat.paiement?.solde.statut, etat.devis?.accepte?.retirable], ["PAYE", "CHEQUE", "A_REGLER", false]);
    await assert.rejects(validations.retirerAccord(await espaceDe(c.espaceId), "CLIENT"), /déjà engagé/);
  });

  test("Lucas recule le dossier avant « Signé » : l'espace ne dit plus « signé »", async () => {
    const c = await client("Hugo");
    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-HUGO", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: devis.id, nom: "Hugo Essai", accepte: true }, { ip: null, navigateur: null });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    const etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.devis?.accepte, etat.etape], [null, "DEVIS"]);
    assert.equal((await prisma.accordDevis.findFirstOrThrow({ where: { dossierId: c.dossierId } })).retirePar, "LUCAS");
  });
});

describe("devis repris et encaissements (le cas du « 0 € »)", () => {
  test("devis repris signé, acompte encaissé : montants justes, acompte « payé le … par virement », solde à régler ; annulé : à régler", async () => {
    const c = await client("Jérôme");
    // Dossier repris : devis émis avant le CRM (aucune ligne), noté accepté, dossier passé « Signé » à sa date réelle.
    await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "2026-937", dateEmission: new Date("2026-09-14T10:00:00Z"), objet: "Recouvrement de cuisine", lignes: "[]", totalHt: 3460, acomptePct: 30, statut: "ACCEPTE", origine: "REPRISE" } });
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "SIGNE" } });
    await prisma.dossierEvenement.create({ data: { dossierId: c.dossierId, type: "CHANGEMENT_ETAPE", direction: "INTERNE", contenu: "Qualification → Signé (reprise)", metadata: JSON.stringify({ de: "QUALIFICATION", vers: "SIGNE", nature: "REPRISE" }), survenuLe: new Date("2026-09-15T10:00:00Z") } });
    const paiement = await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 1038, moyen: "VIREMENT", recuLe: "2026-09-18", reference: null } }));

    let etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.devis?.total, etat.devis?.acompte, etat.devis?.solde, etat.devis?.repris, etat.devis?.accepte?.source], [3460, 1038, 2422, true, "CRM"]);
    assert.match(etat.devis!.conditions[0], /1 038,00 €/);
    assert.deepEqual([etat.paiement?.total, etat.paiement?.acompte?.statut, etat.paiement?.acompte?.moyen, etat.paiement?.acompte?.payeLe?.slice(0, 10), etat.paiement?.solde.montant, etat.paiement?.solde.statut, etat.paiement?.regle], [3460, "PAYE", "VIREMENT", "2026-09-18", 2422, "A_REGLER", false]);
    assert.equal(etat.paiement?.signeLe?.slice(0, 10), "2026-09-15");
    assert.equal(etat.etapes.find((e) => e.cle === "ACOMPTE")?.verrouillee, false);
    const ligne = (await suivi.listerEspaces()).find((l) => l.dossierId === c.dossierId)!;
    assert.deepEqual([ligne.faits.accordSource, ligne.faits.paiement?.recu, ligne.faits.paiement?.reste], ["CRM", 1038, 2422]);

    // Virement annulé (erreur de saisie) : l'espace revient à « à régler », aussitôt.
    await avecActeur(LUCAS, () => encaissements.annulerEncaissement(paiement.encaissement.id, { motif: "ERREUR_SAISIE" }));
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.paiement?.acompte?.statut, etat.paiement?.recu], ["A_REGLER", 0]);

    // Tout est encaissé : « Réglé, merci ».
    await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 3460, moyen: "VIREMENT", recuLe: "2026-09-21", reference: null } }));
    etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.paiement?.regle, etat.paiement?.solde.statut, etat.paiement?.reste], [true, "PAYE", 0]);
  });

  test("un acompte encaissé sur un devis envoyé fait passer le dossier en « Signé » ; annulé, il revient", async () => {
    const c = await client("Karim");
    await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-KARIM", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "DEVIS_ENVOYE" }));
    const paiement = await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 450, moyen: "VIREMENT", recuLe: "2026-09-20", reference: null } }));
    assert.equal(await etapeDe(c.dossierId), "SIGNE");
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).paiement?.acompte?.statut, "PAYE");
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: c.leadId } })).statut, "SIGNE");
    await avecActeur(LUCAS, () => encaissements.annulerEncaissement(paiement.encaissement.id, { motif: "ERREUR_SAISIE" }));
    assert.equal(await etapeDe(c.dossierId), "DEVIS_ENVOYE");
    const etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.deepEqual([etat.etape, etat.paiement], ["DEVIS", null]);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: c.leadId } })).statut, "DEVIS_ENVOYE");
  });
});

describe("contrôle de cohérence", () => {
  test("une base saine ne signale rien sur ces dossiers ; une incohérence fabriquée est vue, corrigée d'un geste, et ne revient pas", async () => {
    const c = await client("Louise");
    const devis = await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-LOUISE", dateEmission: new Date(), objet: "Cuisine", lignes: LIGNES, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: devis.id, nom: "Louise Essai", accepte: true }, { ip: null, navigateur: null });
    assert.deepEqual((await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId), []);
    // Écriture directe en base (ce qu'aucun écran ne fait) : le dossier recule sans que l'accord ne soit retiré.
    await prisma.dossier.update({ where: { id: c.dossierId }, data: { etape: "DEVIS_ENVOYE" } });
    const vues = (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId);
    // Deux sections se contredisent d'un coup : l'espace (accord donné) et Leads (lead « signé ») face au dossier.
    assert.deepEqual(vues.map((i) => i.code), ["ACCORD_SANS_SIGNATURE", "STATUT_DU_LEAD"]);
    const resultat = await avecActeur(LUCAS, () => controle.corrigerIncoherence(vues[0].cle));
    assert.ok(resultat.corrigee);
    assert.equal(await etapeDe(c.dossierId), "SIGNE");
    assert.deepEqual((await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId), []);
    assert.deepEqual(await controle.corrigerIncoherence(vues[0].cle), { corrigee: false, message: "Cette incohérence n'existe plus : rien à corriger." });
  });

  test("le « 0 € » ne passe plus inaperçu", async () => {
    const c = await client("Marius");
    await prisma.document.create({ data: { dossierId: c.dossierId, type: "DEVIS", numero: "D-MARIUS", dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 0, acomptePct: 30, statut: "ENVOYE", origine: "REPRISE" } });
    const vues = (await controle.controlerCoherence()).incoherences.filter((i) => i.dossierId === c.dossierId);
    assert.ok(vues.some((i) => i.code === "DEVIS_MONTANT_NUL" && i.gravite === "HAUTE"));
  });
});
