import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-espace-"));

let prisma: typeof import("@/lib/prisma").default;
let liens: typeof import("./liens");
let service: typeof import("./service");

function reglerEnvironnement(): void {
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  delete process.env.ESPACE_CLIENT_SECRET;
  process.env.SITE_URL = "https://coverswap.fr";
}

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=", "base64");
const photo = (nom = "cuisine.jpg", type = "image/jpeg", contenu: Buffer = JPEG) => new File([new Uint8Array(contenu)], nom, { type });

async function dossierAvecEspace(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3361${Math.floor(Math.random() * 9e7 + 1e7)}`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espace: ouvert.espace, lien: ouvert.lien, jeton: ouvert.lien.split("/e/")[1] };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  reglerEnvironnement();
  liens = await import("./liens");
  service = await import("./service");
});
after(async () => {
  await prisma.$disconnect();
});

describe("lien signé", () => {
  test("ouvrir l'espace d'un contact ouvre son dossier, et le lien tient dans un SMS", async () => {
    const { lien, dossierId, leadId } = await dossierAvecEspace("Camille");
    assert.match(lien, /^https:\/\/coverswap\.fr\/e\/[a-z0-9]{8}-[A-Za-z0-9_-]{16}$/);
    assert.ok(lien.length <= 50, `lien de ${lien.length} caractères`);
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
    assert.deepEqual([dossier?.etape, dossier?.leadId, dossier?.source, dossier?.prochaineAction], ["QUALIFICATION", leadId, "ENTRANT", "Attendre les photos du client"]);
    // Rouvrir ne crée ni second dossier ni second espace : le même lien repart.
    const encore = await liens.ouvrirEspaceDuContact(leadId);
    assert.deepEqual([encore.lien, encore.nouveau, encore.dossierId], [lien, false, dossierId]);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_LIEN_CREE" } }), 1);
  });

  test("impossible à deviner : signature altérée, code d'un autre, format libre — même refus", async () => {
    const a = await dossierAvecEspace("Alice");
    const b = await dossierAvecEspace("Bruno");
    const [codeA, signatureA] = a.jeton.split(/-(.+)/);
    const [codeB] = b.jeton.split(/-(.+)/);
    // Le premier projet et l'espace permanent du client partagent le code : le lien envoyé EST le lien du client.
    assert.equal((await liens.accesDuJeton(a.jeton)).permanent.code, a.espace.code);
    for (const faux of [`${codeB}-${signatureA}`, `${codeA}-${"A".repeat(16)}`, `${codeA}-${signatureA.slice(0, 15)}${signatureA.endsWith("x") ? "y" : "x"}`, codeA, "../../etc/passwd", ""]) {
      await assert.rejects(liens.accesDuJeton(faux), (erreur: Error & { status?: number; raison?: string }) => erreur.status === 404 && erreur.raison === "inconnu", faux);
    }
  });

  test("permanent : n'expire plus, se révoque, se régénère — l'ancien lien meurt, le nouveau vit", async () => {
    const { espace, jeton } = await dossierAvecEspace("Denis");
    // L'ancienne date d'expiration d'un projet ne compte plus : le lien du client ne meurt pas.
    await prisma.espaceClient.update({ where: { id: espace.id }, data: { expireLe: new Date(Date.now() - 1000) } });
    const acces = await liens.accesDuJeton(jeton);
    assert.equal(acces.permanent.id, espace.permanentId);

    await liens.revoquerEspace(espace.id);
    await assert.rejects(liens.accesDuJeton(jeton), (e: Error & { status?: number; raison?: string }) => e.status === 410 && e.raison === "revoque");

    const renouvele = await liens.renouvelerEspace(espace.id);
    assert.notEqual(renouvele.lien.split("/e/")[1], jeton);
    await assert.rejects(liens.accesDuJeton(jeton), /n'est pas valide/, "l'ancien lien ne renaît pas");
    assert.equal((await liens.accesDuJeton(renouvele.lien.split("/e/")[1])).permanent.id, espace.permanentId);
  });
});

describe("ce que le client fait dans son espace", () => {
  test("photos : enregistrées dans SON dossier, événement écrit, la main passe à Lucas, une seule alerte programmée", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Élise");
    const resultat = await service.deposerPhotos(espace, [photo("a.jpg"), photo("b.jpg"), photo("notes.pdf", "application/pdf")]);
    assert.equal(resultat.deposees, 2);
    assert.match(resultat.refusees[0], /notes\.pdf : format non pris en charge/);
    const etat = await service.etatEspace(espace);
    assert.equal(etat.photos.length, 2);
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
    assert.match(dossier?.prochaineAction ?? "", /Préparer la simulation/);
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId, type: "ESPACE_PHOTOS" } }), 1);
    assert.equal(await prisma.tache.count({ where: { type: service.TACHE_ALERTE_PHOTOS, cle: { startsWith: `espace-photos:${espace.id}:` } } }), 1);
    assert.deepEqual(await service.alerterPhotosDeposees(dossierId), { photos: 2 });
  });

  test("photo trop lourde refusée avec une phrase claire", async () => {
    const { espace } = await dossierAvecEspace("Farid");
    const lourde = photo("lourde.jpg", "image/jpeg", Buffer.alloc(9 * 1024 * 1024 + 1));
    await assert.rejects(service.deposerPhotos(espace, [lourde]), /trop lourde \(9 Mo au plus\)/);
  });

  test("les photos d'un client ne sont jamais visibles par un autre", async () => {
    const a = await dossierAvecEspace("Gaëlle");
    const b = await dossierAvecEspace("Hugo");
    await service.deposerPhotos(a.espace, [photo()]);
    const [photoDeA] = (await service.etatEspace(a.espace)).photos;
    assert.ok((await service.photoDeLEspace(a.espace, photoDeA.id)).contenu.length > 0);
    await assert.rejects(service.photoDeLEspace(b.espace, photoDeA.id), /introuvable/);
    await assert.rejects(service.photoDeLEspace(b.espace, "../../secret"), /introuvable/);
  });

  test("souhaits et coordonnées rejoignent le dossier", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Inès");
    await service.enregistrerSouhaits(espace, { teintes: ["Bois clair", "Blanc"], style: "Chaleureux", propositions: true, precisions: "Garder les poignées" });
    const relu = await prisma.espaceClient.findUnique({ where: { id: espace.id } });
    assert.deepEqual((await service.etatEspace(relu!)).souhaits, { teintes: ["Bois clair", "Blanc"], style: "Chaleureux", propositions: true, precisions: "Garder les poignées" });
    const evenement = await prisma.dossierEvenement.findFirst({ where: { dossierId, type: "ESPACE_SOUHAITS" } });
    assert.match(evenement?.contenu ?? "", /veut des propositions · teintes : Bois clair, Blanc · style : Chaleureux/);

    await service.completerCoordonnees(relu!, { nom: "Inès Petit", adresse: "12 rue des Lilas", codePostal: "34970", ville: "Lattes", email: "ines@exemple.test" });
    const dossier = await prisma.dossier.findUnique({ where: { id: dossierId } });
    assert.deepEqual([dossier?.clientAdresse, dossier?.clientEmail], ["12 rue des Lilas", "ines@exemple.test"]);
    assert.equal((await service.etatEspace(relu!)).coordonnees.completes, true);
  });
});

describe("simulations et bon pour accord", () => {
  test("Lucas dépose (brouillon, invisible), publie ; le client compare, choisit et commente ; une simulation d'un autre espace reste hors d'atteinte", async () => {
    const a = await dossierAvecEspace("Julie");
    const b = await dossierAvecEspace("Karim");
    const chene = await service.deposerSimulation(a.dossierId, photo("chene.jpg"), { titre: "Chêne clair" });
    const noir = await service.deposerSimulation(a.dossierId, photo("noir.jpg"), { titre: "Noir mat" });
    // Un brouillon ne se voit pas : ni dans l'état, ni par son image.
    assert.equal((await service.etatEspace(a.espace)).simulations.length, 0);
    await assert.rejects(service.imagePourLeClient(a.espace, chene.id, "image"), /introuvable/);
    assert.equal((await prisma.dossier.findUnique({ where: { id: a.dossierId } }))?.etape, "QUALIFICATION");
    const { publierSimulations } = await import("@/lib/simulations/dossier");
    await publierSimulations(a.dossierId, [chene.id, noir.id], { prevenir: false });
    assert.equal((await prisma.dossier.findUnique({ where: { id: a.dossierId } }))?.etape, "SIMULATION", "une simulation publiée sort le dossier de la qualification");
    const publie = await service.etatEspace(a.espace);
    assert.deepEqual([publie.avancement, publie.etape, publie.simulations.every((s) => s.nouvelle)], ["SIMULATION", "SIMULATIONS", true]);

    await service.choisirSimulation(a.espace, chene.id, "Parfait, avec les poignées noires");
    const etat = await service.etatEspace(a.espace);
    assert.deepEqual(etat.simulations.map((s) => [s.titre, s.choisie]), [["Chêne clair", true], ["Noir mat", false]]);
    assert.match((await prisma.dossier.findUnique({ where: { id: a.dossierId } }))?.prochaineAction ?? "", /Préparer le devis/);

    await assert.rejects(service.choisirSimulation(b.espace, chene.id, ""), /introuvable/);
    await assert.rejects(service.imageDeSimulation({ espaceId: b.espace.id }, chene.id), /introuvable/);
    assert.ok((await service.imageDeSimulation({ espaceId: a.espace.id }, chene.id)).contenu.length > 0);
  });

  test("bon pour accord en un clic : accord figé, devis accepté, dossier signé — une seule fois", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Léa");
    const autre = await dossierAvecEspace("Marc");
    const lignes = JSON.stringify([{ type: "PRESTATION", designation: "Recouvrement de 12 façades", quantite: 10, unite: "ml", prixUnitaire: 150 }]);
    const devis = await prisma.document.create({ data: { dossierId, type: "DEVIS", numero: "D-ESSAI-0001", dateEmission: new Date(), objet: "Recouvrement de cuisine", lignes, totalHt: 1500, acomptePct: 30, statut: "ENVOYE" } });

    const etatAvant = await service.etatEspace(espace);
    assert.deepEqual([etatAvant.devis?.total, etatAvant.devis?.acompte, etatAvant.avancement], [1500, 450, "DEVIS"]);
    assert.match(etatAvant.virement?.iban ?? "", /^FR76/);

    await assert.rejects(service.accepterDevis(autre.espace, { documentId: devis.id, nom: "Marc", accepte: true }, { ip: null, navigateur: null }), /Devis introuvable/, "le devis d'un autre dossier ne se signe pas");

    const premier = await service.accepterDevis(espace, { documentId: devis.id, nom: "Léa Essai", accepte: true }, { ip: "203.0.113.7", navigateur: "Safari iPhone" });
    const second = await service.accepterDevis(espace, { documentId: devis.id, nom: "Léa Essai", accepte: true }, { ip: "203.0.113.7", navigateur: "Safari iPhone" });
    assert.deepEqual([premier.dejaAccepte, second.dejaAccepte], [false, true]);

    const accord = await prisma.accordDevis.findFirst({ where: { documentId: devis.id } });
    assert.deepEqual([accord?.nomSignataire, accord?.totalHt, accord?.ip, accord?.mention], ["Léa Essai", 1500, "203.0.113.7", "Bon pour accord"]);
    assert.equal(await prisma.accordDevis.count({ where: { documentId: devis.id } }), 1);
    assert.equal((await prisma.document.findUnique({ where: { id: devis.id } }))?.statut, "ACCEPTE");
    assert.equal((await prisma.dossier.findUnique({ where: { id: dossierId } }))?.etape, "SIGNE");
    const etatApres = await service.etatEspace(espace);
    assert.deepEqual([etatApres.avancement, etatApres.devis?.accepte?.nom], ["ACCORD", "Léa Essai"]);
  });

  test("un devis remplacé ne se signe plus", async () => {
    const { espace, dossierId } = await dossierAvecEspace("Nora");
    const devis = await prisma.document.create({ data: { dossierId, type: "DEVIS", numero: "D-ESSAI-0002", dateEmission: new Date(), objet: "Cuisine", lignes: "[]", totalHt: 900, statut: "REMPLACE" } });
    await assert.rejects(service.accepterDevis(espace, { documentId: devis.id, nom: "Nora", accepte: true }, { ip: null, navigateur: null }), /n'est plus en vigueur/);
  });
});
