import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-pilotage-"));

let prisma: typeof import("@/lib/prisma").default;
let pilotage: typeof import("./pilotage");
let liens: typeof import("@/lib/espace/liens");
let reception: typeof import("@/lib/sms/reception");
let recalculerMain: typeof import("@/lib/dossiers/main").recalculerMain;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  pilotage = await import("./pilotage");
  liens = await import("@/lib/espace/liens");
  reception = await import("@/lib/sms/reception");
  recalculerMain = (await import("@/lib/dossiers/main")).recalculerMain;
});
after(async () => {
  await prisma.$disconnect();
});

let numero = 10;
const contact = (prenom: string, donnees: Record<string, unknown> = {}) => prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+336130000${numero++}`, ville: "Lattes", source: "META_ADS", ...donnees } });

describe("à qui est la main", () => {
  test("le matin : qui rappeler (dans l'ordre de valeur), quoi préparer, ce qui attend le client", async () => {
    await contact("Standard", { priorite: "STANDARD" });
    await contact("Prioritaire", { priorite: "PRIORITAIRE" });
    await contact("HorsZone", { priorite: "A_ECARTER" });
    await contact("RappelDemain", { statut: "CONTACTE", rappelLe: new Date(Date.now() + 2 * 86_400_000) });
    await contact("RappelDu", { statut: "CONTACTE", rappelLe: new Date(Date.now() - 3_600_000), priorite: "SECONDAIRE" });

    const attendPhotos = await liens.ouvrirEspaceDuContact((await contact("AttendPhotos")).id);
    const photosRecues = await liens.ouvrirEspaceDuContact((await contact("PhotosRecues")).id);
    await prisma.dossier.update({ where: { id: photosRecues.dossierId }, data: { photos: JSON.stringify(["dossiers/x/photos/a-12345678.jpg"]) } });
    // Mission 6 : qui a la main suit les gestes (dossiers/main.ts) — des photos déposées par le client la lui reprennent.
    await prisma.dossierEvenement.create({ data: { dossierId: photosRecues.dossierId, type: "ESPACE_PHOTOS", direction: "ENTRANT", contenu: "1 photo" } });
    await recalculerMain(photosRecues.dossierId);
    const choisie = await liens.ouvrirEspaceDuContact((await contact("SimulationChoisie")).id);
    await prisma.dossier.update({ where: { id: choisie.dossierId }, data: { etape: "SIMULATION" } });
    await prisma.simulationEspace.create({ data: { espaceId: choisie.espace.id, dossierId: choisie.dossierId, chemin: "dossiers/x/simulations/s.jpg", choisieLe: new Date() } });
    await prisma.dossierEvenement.create({ data: { dossierId: choisie.dossierId, type: "ESPACE_SIMULATION_CHOISIE", direction: "ENTRANT", contenu: "Simulation validée" } });
    await recalculerMain(choisie.dossierId);
    const devisEnvoye = await liens.ouvrirEspaceDuContact((await contact("DevisEnvoye")).id);
    await prisma.dossier.update({ where: { id: devisEnvoye.dossierId }, data: { etape: "DEVIS_ENVOYE" } });
    await prisma.document.create({ data: { dossierId: devisEnvoye.dossierId, type: "DEVIS", numero: "D-PIL-0001", dateEmission: new Date(Date.now() - 5 * 86_400_000), objet: "Cuisine", lignes: "[]", totalHt: 1800, statut: "ENVOYE" } });
    const signe = await liens.ouvrirEspaceDuContact((await contact("Signe")).id);
    await prisma.dossier.update({ where: { id: signe.dossierId }, data: { etape: "SIGNE" } });

    const vue = await pilotage.pilotageCommercial();
    const groupeDe = (nom: string) => vue.affaires.find((a) => a.nom.startsWith(nom))?.groupe;
    assert.deepEqual(
      ["Prioritaire", "Standard", "HorsZone", "RappelDemain", "RappelDu", "AttendPhotos", "PhotosRecues", "SimulationChoisie", "DevisEnvoye", "Signe"].map(groupeDe),
      ["RAPPELER", "RAPPELER", "ECARTER", "PLUS_TARD", "RAPPELER", "ATTENTE_PHOTOS", "SIMULATION", "DEVIS", "ATTENTE_DEVIS", "PLANIFIER"]
    );
    // Ordre des appels : la valeur d'abord.
    const aRappeler = vue.affaires.filter((a) => a.groupe === "RAPPELER").map((a) => a.nom.split(" ")[0]);
    assert.deepEqual(aRappeler, ["Prioritaire", "Standard", "RappelDu"]);
    assert.deepEqual([vue.compteurs.rappeler, vue.compteurs.simulations, vue.compteurs.devis, vue.compteurs.planifier], [3, 1, 1, 1]);
    assert.equal(vue.affaires.find((a) => a.nom.startsWith("HorsZone"))?.main, "MOI");
    assert.equal(vue.compteurs.aMoi, 6, "le hors zone ne gonfle pas ce qui m'attend");
    const devis = vue.affaires.find((a) => a.nom.startsWith("DevisEnvoye"))!;
    assert.deepEqual([devis.main, devis.depuisJours, devis.montant], ["CLIENT", 5, 1800]);
    assert.equal(attendPhotos.nouveau, true);
  });

  test("un SMS reçu rend toujours la main à Lucas, quelle que soit l'étape", async () => {
    const lead = await contact("Ecrit");
    const { dossierId } = await liens.ouvrirEspaceDuContact(lead.id);
    await prisma.dossier.update({ where: { id: dossierId }, data: { etape: "DEVIS_ENVOYE" } });
    assert.equal((await pilotage.pilotageCommercial()).affaires.find((a) => a.nom.startsWith("Ecrit"))?.main, "CLIENT");
    await reception.enregistrerSmsEntrant({ identifiant: "pil-1", numero: lead.telephone, texte: "Une question sur le devis", recuLe: new Date() }, "essai");
    const affaire = (await pilotage.pilotageCommercial()).affaires.find((a) => a.nom.startsWith("Ecrit"))!;
    assert.deepEqual([affaire.groupe, affaire.main, affaire.nonLus, affaire.dernier?.texte], ["REPONDRE", "MOI", 1, "Une question sur le devis"]);
  });
});
