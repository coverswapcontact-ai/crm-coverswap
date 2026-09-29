import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import { groupeDuLead, intentionDuLead } from "./constantes";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));
process.env.META_PIXEL_ID = "";
process.env.META_ACCESS_TOKEN = "";

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let entrants: typeof import("./entrants");
let identification: typeof import("@/lib/clients/identification");
const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const JOUR = 86_400_000;

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  entrants = await import("./entrants");
  identification = await import("@/lib/clients/identification");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("règles pures", () => {
  test("groupe et intention d'un contact entrant", () => {
    const maintenant = new Date("2026-09-17T10:00:00Z");
    const base = { statut: "NOUVEAU", createdAt: new Date("2026-09-10T10:00:00Z"), archiveLe: null, nbDossiers: 0 };
    assert.equal(groupeDuLead(base, maintenant), "A_TRAITER");
    assert.equal(groupeDuLead({ ...base, createdAt: new Date("2026-06-01T10:00:00Z") }, maintenant), "ANCIENS");
    assert.equal(groupeDuLead({ ...base, statut: "PERDU" }, maintenant), "SANS_SUITE");
    assert.equal(groupeDuLead({ ...base, nbDossiers: 1 }, maintenant), "AVEC_DOSSIER", "le dossier l'emporte sur le statut");
    assert.equal(groupeDuLead({ ...base, statut: "TERMINE" }, maintenant), "AVEC_DOSSIER", "chantier terminé dans l'ancien CRM : pas un contact à relancer");
    assert.equal(groupeDuLead({ ...base, statut: "CONTACTE" }, maintenant), "CONTACTES");
    assert.equal(groupeDuLead({ ...base, archiveLe: new Date() }, maintenant), "ARCHIVES");
    assert.equal(intentionDuLead({ source: "META_ADS", statut: "NOUVEAU", simulations: [{ source: "SITE_DEVIS" }] }), "DEVIS");
    assert.equal(intentionDuLead({ source: "SITE_SIMULATEUR", statut: "NOUVEAU", simulations: [] }), "SIMULATION");
    assert.equal(intentionDuLead({ source: "META_ADS", statut: "NOUVEAU", simulations: [] }), "CONTACT");
  });
});

describe("contacts entrants", () => {
  test("les groupes se comptent et se listent ; un appel fait passer « Contacté » ; sans suite avec motif ; archivage réversible", async () => {
    const cree = (donnees: Record<string, unknown>) =>
      avecActeur(LUCAS, () => prisma.lead.create({ data: { nom: "Test", prenom: "Contact", telephone: "0600000000", ville: "Lattes", source: "META_ADS", ...donnees } }));
    const recent = await cree({ nom: "Récent", telephone: "0611000001" });
    await cree({ nom: "Ancien", telephone: "0611000002", createdAt: new Date(Date.now() - 90 * JOUR) });
    const perdu = await cree({ nom: "Perdu", telephone: "0611000003", statut: "PERDU" });
    const avecDossier = await cree({ nom: "Converti", telephone: "0611000004" });
    await cree({ nom: "Ancien client", telephone: "0611000005", statut: "TERMINE" });
    await avecActeur(LUCAS, () => prisma.dossier.create({ data: { clientNom: "Contact Converti", clientAdresse: "", clientCp: "", clientVille: "", clientTelephone: "", objet: "", source: "ENTRANT", leadId: avecDossier.id } }));
    await avecActeur(LUCAS, () => prisma.simulation.create({ data: { leadId: recent.id, source: "SITE_DEVIS", prixDevis: 1450, imageBeforePath: "simulations/x/before.jpg" } }));

    const liste = await entrants.listerEntrants();
    assert.deepEqual(liste.compteurs, { A_TRAITER: 1, CONTACTES: 0, ANCIENS: 1, AVEC_DOSSIER: 2, SANS_SUITE: 1, ARCHIVES: 0 });
    assert.deepEqual(liste.lignes.map((ligne) => ligne.nom), ["Contact Récent"]);
    assert.equal(liste.lignes[0].intention, "DEVIS");
    assert.equal(liste.lignes[0].prixSimule, 1450);
    assert.equal(liste.lignes[0].telephone, "06 11 00 00 01");
    assert.equal((await entrants.listerEntrants({ recherche: "11 00 00 03" })).compteurs.SANS_SUITE, 1, "recherche par numéro, espaces compris");
    const parNom = await entrants.listerEntrants({ groupe: "A_TRAITER", recherche: "Récent" });
    assert.deepEqual([parNom.lignes.length, parNom.compteurs.ANCIENS, parNom.compteurs.AVEC_DOSSIER], [1, 0, 0], "la recherche par nom s'applique aussi dans chaque groupe");
    assert.equal((await entrants.listerEntrants({ groupe: "AVEC_DOSSIER", recherche: "06 11 00 00 04" })).lignes.length, 1, "recherche par numéro dans « Devis ou dossier »");

    await avecActeur(LUCAS, () => entrants.ajouterEchange(recent.id, { type: "APPEL", contenu: "Rappel demain pour la visite" }));
    const detail = await entrants.chargerEntrant(recent.id);
    assert.equal(detail.statut, "CONTACTE");
    assert.equal(detail.groupe, "CONTACTES");
    assert.equal(detail.echanges[0].contenu, "Rappel demain pour la visite");
    assert.equal(detail.simulations[0].avant, "/api/uploads/simulations/x/before.jpg");

    // Mission 12 : « sans suite » exige un motif structuré ; la précision reste libre.
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(recent.id, { statut: "PERDU", motif: "Trop cher" })), /Motif obligatoire pour classer sans suite/);
    assert.deepEqual(await avecActeur(LUCAS, () => entrants.modifierEntrant(recent.id, { statut: "PERDU", motifPerte: "PRIX", motif: "trouve ça cher" })), []);
    assert.equal((await entrants.chargerEntrant(recent.id)).echanges[0].contenu, "Statut : Sans suite (Trop cher — trouve ça cher)");
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(avecDossier.id, { statut: "PERDU" })), /suit le dossier/, "le statut d'un contact passé en dossier suit le dossier");
    await assert.rejects(avecActeur(LUCAS, () => entrants.ajouterEchange(avecDossier.id, { type: "APPEL", contenu: "Rappel" })), /sur le dossier/, "le suivi se note sur le dossier");
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(perdu.id, { prenom: "", nomFamille: "" })), /prénom ou un nom/);
    await assert.rejects(avecActeur(LUCAS, () => entrants.modifierEntrant(perdu.id, { telephone: "06 11" })), /illisible/);

    // Numéro corrigé : la fiche client le reçoit aussi, l'ancien y reste.
    const rattache = await avecActeur(LUCAS, () => prisma.$transaction((tx) => identification.rattacherLead(tx, recent.id, null)));
    const avertissements = await avecActeur(LUCAS, () => entrants.modifierEntrant(recent.id, { telephone: "06 99 00 00 01" }));
    assert.match(avertissements.join(" "), /fiche client/);
    const numeros = (await prisma.clientTelephone.findMany({ where: { clientId: rattache }, select: { numero: true } })).map((ligne) => ligne.numero).sort();
    assert.deepEqual(numeros, ["+33611000001", "+33699000001"]);

    await avecActeur(LUCAS, () => entrants.archiverEntrant(perdu.id, "Doublon d'un autre contact"));
    assert.equal((await entrants.listerEntrants({ groupe: "ARCHIVES" })).lignes[0].id, perdu.id);
    await avecActeur(LUCAS, () => entrants.restaurerEntrant(perdu.id));
    assert.equal((await entrants.listerEntrants({ groupe: "ARCHIVES" })).compteurs.ARCHIVES, 0);
  });

  test("saisi à la main : rejoint la fiche client qui a ce numéro ; numéro illisible refusé", async () => {
    const client = await avecActeur(LUCAS, () => prisma.client.create({ data: { nom: "Hélène Existante", source: "RECOMMANDATION", premierContactLe: new Date() } }));
    await avecActeur(LUCAS, () => prisma.clientTelephone.create({ data: { clientId: client.id, numero: "+33622334455", saisi: "06 22 33 44 55", principal: true } }));
    const { clientId } = await avecActeur(LUCAS, () =>
      entrants.creerEntrant(entrants.schemaCreationEntrant.parse({ prenom: "Hélène", nomFamille: "Existante", telephone: "06.22.33.44.55", source: "REFERENCE" }))
    );
    assert.equal(clientId, client.id);
    await assert.rejects(avecActeur(LUCAS, () => entrants.creerEntrant(entrants.schemaCreationEntrant.parse({ nomFamille: "Faute", telephone: "06 22" }))), /illisible/);
    await assert.rejects(avecActeur(LUCAS, () => entrants.creerEntrant(entrants.schemaCreationEntrant.parse({}))), /prénom ou un nom/);
  });
});
