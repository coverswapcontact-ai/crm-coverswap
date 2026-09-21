import assert from "node:assert/strict";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-doublons-"));

let prisma: typeof import("@/lib/prisma").default;
let doublons: typeof import("./doublons");
let liens: typeof import("@/lib/espace/liens");
let depuisLead: typeof import("@/lib/dossiers/depuis-lead");
let identification: typeof import("@/lib/clients/identification");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  doublons = await import("./doublons");
  liens = await import("@/lib/espace/liens");
  depuisLead = await import("@/lib/dossiers/depuis-lead");
  identification = await import("@/lib/clients/identification");
});
after(async () => {
  await prisma.$disconnect();
});

async function contact(donnees: { prenom: string; nom: string; telephone: string; email?: string; ville?: string; codePostal?: string; source?: string }) {
  const lead = await prisma.lead.create({ data: { ville: "Lattes", codePostal: "34970", source: "SITE_SIMULATEUR", ...donnees } });
  await identification.rattacherLead(prisma, lead.id, null);
  return prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
}

async function simulationDuSite(leadId: string) {
  const dossier = path.join(process.env.UPLOADS_DIR!, leadId, "s");
  await fs.mkdir(dossier, { recursive: true });
  await fs.writeFile(path.join(dossier, "after.png"), PNG);
  return prisma.simulation.create({ data: { leadId, imageAfterPath: `${leadId}/s/after.png`, referenceChoisie: "AA01" } });
}

describe("doublon probable", () => {
  test("même nom, même ville, autre numéro et autre e-mail : signalé ; même numéro ou prénom seul : non", async () => {
    const ancien = await contact({ prenom: "Marie", nom: "Durand", telephone: "06 11 22 33 44", email: "marie@exemple.test" });
    const nouveau = await contact({ prenom: "marie", nom: "DURAND", telephone: "07 99 88 77 66", email: "m.durand@autre.test", ville: "LATTES" });
    const signal = await doublons.reperDoublonProbable(nouveau.id);
    assert.equal(signal?.doublonDe, ancien.id);
    assert.match(signal?.motif ?? "", /Même nom et même ville que Marie Durand/);

    const memeNumero = await contact({ prenom: "Marie", nom: "Durand", telephone: "+33 6 11 22 33 44" });
    assert.equal(await doublons.reperDoublonProbable(memeNumero.id), null, "le même numéro, c'est la règle d'identité, pas un doublon « probable »");
    const prenomSeul = await contact({ prenom: "Marie", nom: "Inconnu", telephone: "06 55 55 55 55" });
    assert.equal(await doublons.reperDoublonProbable(prenomSeul.id), null);
    const ailleurs = await contact({ prenom: "Marie", nom: "Durand", telephone: "06 66 66 66 66", ville: "Sète", codePostal: "34200" });
    assert.equal(await doublons.reperDoublonProbable(ailleurs.id), null);
  });

  test("fusion en un clic : ses simulations rejoignent le dossier et l'espace d'origine, rien n'est supprimé", async () => {
    const ancien = await contact({ prenom: "Jean", nom: "Martin", telephone: "06 12 12 12 12", email: "jean@exemple.test" });
    const { dossierId, espace } = await liens.ouvrirEspaceDuContact(ancien.id);
    const nouveau = await contact({ prenom: "Jean", nom: "Martin", telephone: "07 34 34 34 34", email: "jmartin@ailleurs.test" });
    await doublons.reperDoublonProbable(nouveau.id);
    // Sa simulation du site reste sur sa fiche (une simulation seule n'ouvre plus de dossier) ; Lucas lui en avait ouvert un.
    await simulationDuSite(nouveau.id);
    assert.equal(await depuisLead.assurerDossierDeSimulation(nouveau.id), null);
    const auto = await depuisLead.ouvrirDossierDuLead(nouveau.id, { motif: "BOUTON" });
    assert.ok(auto.cree);

    const bilan = await doublons.fusionnerDoublon(nouveau.id);
    assert.deepEqual([bilan.dossierId, bilan.simulations, bilan.dossiersArchives], [dossierId, 1, 1]);
    const archive = await prisma.dossier.findFirstOrThrow({ where: { id: auto.dossierId, archiveLe: undefined } });
    assert.match(archive.archiveMotif ?? "", /Doublon : fusionné dans le dossier de Jean Martin/);
    const leadArchive = await prisma.lead.findFirstOrThrow({ where: { id: nouveau.id, archiveLe: undefined } });
    assert.ok(leadArchive.archiveLe && leadArchive.doublonTraiteLe);
    // La simulation est dans l'espace du client d'origine, publiée (il l'a vue sur le site).
    const dansLEspace = await prisma.simulationEspace.findMany({ where: { espaceId: espace.id } });
    assert.deepEqual(dansLEspace.map((s) => [s.source, s.statut]), [["SITE", "PUBLIEE"]]);
    // Une seule fiche client, qui connaît désormais les deux numéros.
    const client = await prisma.lead.findUniqueOrThrow({ where: { id: ancien.id }, select: { clientId: true } });
    const numeros = await prisma.clientTelephone.findMany({ where: { clientId: client.clientId! }, select: { numero: true } });
    assert.deepEqual(numeros.map((n) => n.numero).sort(), ["+33612121212", "+33734343434"]);
    await assert.rejects(doublons.fusionnerDoublon(nouveau.id), /déjà été traité/);
  });

  test("écarter : le signalement disparaît, rien ne bouge", async () => {
    const a = await contact({ prenom: "Luc", nom: "Petit", telephone: "06 21 21 21 21" });
    const b = await contact({ prenom: "Luc", nom: "Petit", telephone: "06 43 43 43 43" });
    await doublons.reperDoublonProbable(b.id);
    await doublons.ecarterDoublon(b.id);
    const relu = await prisma.lead.findUniqueOrThrow({ where: { id: b.id } });
    assert.deepEqual([relu.doublonDe, Boolean(relu.doublonTraiteLe), relu.archiveLe], [a.id, true, null]);
    assert.match(relu.doublonMotif ?? "", /écarté/);
  });
});
