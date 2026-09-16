import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";
import {
  cleNom,
  formaterTelephone,
  lireNotesAcquisition,
  nomAffichage,
  normaliserEmail,
  normaliserTelephone,
  sourceDepuisLead,
} from "./normalisation";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-uploads-"));

describe("normalisation", () => {
  test("un même numéro, quelle que soit sa saisie", () => {
    const attendu = "+33612345678";
    for (const saisie of ["06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "+33612345678", "0033612345678", "612345678", "+33 (0)6 12 34 56 78", "06.12.34.56.78"]) {
      assert.equal(normaliserTelephone(saisie), attendu, saisie);
    }
    assert.equal(normaliserTelephone("+32 470 12 34 56"), "+32470123456");
    assert.equal(normaliserTelephone("12 34"), null);
    assert.equal(normaliserTelephone(""), null);
    assert.equal(formaterTelephone(attendu), "06 12 34 56 78");
  });

  test("adresses, noms d'affichage, noms comparables", () => {
    assert.equal(normaliserEmail("  Alice.Durand@Gmail.COM "), "alice.durand@gmail.com");
    assert.equal(normaliserEmail("pas une adresse"), null);
    assert.equal(nomAffichage({ prenom: "Alice", nomFamille: "Durand" }), "Alice Durand");
    assert.equal(nomAffichage({ prenom: "Paul", nomFamille: "Paul" }), "Paul");
    assert.equal(nomAffichage({ prenom: "Inconnu", nomFamille: "Inconnu" }), null);
    assert.equal(nomAffichage({ prenom: "Alice", raisonSociale: "Hôtel du Parc" }), "Hôtel du Parc");
    assert.equal(cleNom("Durand  Alice"), cleNom("alice DURAND"));
    assert.equal(cleNom("Hélène Gâté"), "gate helene");
  });

  test("les anciennes notes d'acquisition se relisent", () => {
    assert.deepEqual(lireNotesAcquisition("Formulaire: Devis cuisine | Pub: Avant-après | Campagne: Septembre 2026"), {
      formulaire: "Devis cuisine",
      publicite: "Avant-après",
      campagne: "Septembre 2026",
    });
    assert.deepEqual(lireNotesAcquisition("Form: Cuisine 34 | FormID: 123 | PageID: 456 | LeadgenID: 789 | Via: Zapier"), {
      formulaire: "Cuisine 34",
      formulaireId: "123",
      pageId: "456",
      metaLeadgenId: "789",
      via: "Zapier",
    });
    assert.deepEqual(lireNotesAcquisition("Client très motivé, rappeler le soir"), {});
    assert.deepEqual(sourceDepuisLead("TIKTOK"), { source: "RESEAUX_SOCIAUX", sourceDetail: "TikTok" });
    assert.deepEqual(sourceDepuisLead("REFERENCE"), { source: "RECOMMANDATION" });
  });
});

describe("détection des doublons", () => {
  const fiche = (id: string, telephone: string, dossiers = 0, nom = `Client ${id}`) => ({
    id,
    nom,
    ville: "Pérols",
    codePostal: "34470",
    siret: null,
    premierContactLe: new Date(`2026-01-${String(10 + Number(id.replace(/\D/g, "") || 0)).padStart(2, "0")}`),
    emails: [],
    telephones: [telephone],
    dossiers,
  });

  test("trois fiches au même numéro : deux propositions, vers la fiche de référence", async () => {
    const { pairesSuspectes } = await import("./doublons");
    const paires = pairesSuspectes([
      fiche("c1", "+33611111111", 0, "Alice Durand"),
      fiche("c2", "+33611111111", 2, "Bruno Marchal"),
      fiche("c3", "+33611111111", 0, "Chantal Vidal"),
    ]);
    assert.equal(paires.length, 2);
    assert.ok(paires.every((paire) => paire.a.id === "c2" || paire.b.id === "c2"));
  });

  test("un numéro partagé par beaucoup de fiches est un standard, pas un doublon", async () => {
    const { pairesSuspectes, TAILLE_MAX_GROUPE_IDENTIQUE } = await import("./doublons");
    const noms = ["Hôtel du Parc", "Brasserie du Port", "Cabinet Serre", "Garage Mistral", "Boulangerie Pujol", "Atelier Rey"];
    const nombreuses = noms.slice(0, TAILLE_MAX_GROUPE_IDENTIQUE + 1).map((nom, index) => fiche(`s${index}`, "+33467000000", 0, nom));
    assert.equal(pairesSuspectes(nombreuses).length, 0);
    // Numéros et noms voisins ne font pas des fautes de frappe.
    assert.equal(pairesSuspectes([fiche("l1", "+33600000001", 0, "Résidence Lot 12"), fiche("l2", "+33600000002", 0, "Résidence Lot 13")]).length, 0);
    assert.equal(pairesSuspectes([fiche("d1", "+33600000003", 0, "Alice Durand"), fiche("d2", "+33600000004", 0, "Alice Durant")]).length, 1);
  });
});

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let identification: typeof import("./identification");
let fiches: typeof import("./fiches");
let doublons: typeof import("./doublons");
let moduleFusion: typeof import("./fusion");
let validation: typeof import("@/lib/validation/service");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  identification = await import("./identification");
  fiches = await import("./fiches");
  doublons = await import("./doublons");
  moduleFusion = await import("./fusion");
  validation = await import("@/lib/validation/service");
});

after(async () => {
  await prisma.$disconnect();
});

type LeadAncien = { id: string; nom: string; prenom: string; telephone: string; email?: string; ville: string; source: string; notes?: string; createdAt: number };

/** Ligne écrite comme avant les clients : sans déclencheurs ni colonne client. */
async function leadAncien(lead: LeadAncien) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Lead" ("id", "createdAt", "updatedAt", "nom", "prenom", "telephone", "email", "ville", "source", "notes") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lead.id,
    lead.createdAt,
    lead.createdAt,
    lead.nom,
    lead.prenom,
    lead.telephone,
    lead.email ?? null,
    lead.ville,
    lead.source,
    lead.notes ?? null
  );
}

describe("reprise des données existantes", () => {
  test("une fiche par lead, dossiers rattachés, doublons proposés et jamais fusionnés ; rejouable", async () => {
    await leadAncien({ id: "lead-alice", nom: "Durand", prenom: "Alice", telephone: "06 12 34 56 78", email: "alice@exemple.fr", ville: "Pérols", source: "META_ADS", notes: "Formulaire: Cuisine | Pub: Avant-après | Campagne: Rentrée", createdAt: Date.parse("2026-03-01") });
    await leadAncien({ id: "lead-alice-bis", nom: "DURAND", prenom: "alice", telephone: "+33612345678", ville: "Pérols", source: "SITE_DEVIS", createdAt: Date.parse("2026-05-10") });
    await leadAncien({ id: "lead-bob", nom: "Martin", prenom: "Bob", telephone: "0700000001", ville: "Lattes", source: "REFERENCE", createdAt: Date.parse("2026-04-01") });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Dossier" ("id", "createdAt", "updatedAt", "leadId", "clientNom", "clientAdresse", "clientCp", "clientVille", "clientTelephone", "objet", "source") VALUES ('dossier-alice', ?, ?, 'lead-alice', 'Alice Durand', '3 rue du Port', '34470', 'Pérols', '0612345678', 'Cuisine', 'ENTRANT')`,
      Date.parse("2026-03-05"),
      Date.parse("2026-03-05")
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Dossier" ("id", "createdAt", "updatedAt", "clientNom", "clientAdresse", "clientCp", "clientVille", "clientTelephone", "objet", "source") VALUES ('dossier-fld', ?, ?, 'FLD Tech', '1 zone Fréjorgues', '34130', 'Mauguio', '0467000000', 'Comptoir', 'SOUS_TRAITANCE')`,
      Date.parse("2026-02-01"),
      Date.parse("2026-02-01")
    );

    const { preparerBase } = await import("@/lib/base/preparation");
    await preparerBase();
    await preparerBase();

    const leads = await prisma.lead.findMany({ where: { id: { in: ["lead-alice", "lead-alice-bis", "lead-bob"] } } });
    assert.ok(leads.every((lead) => lead.clientId));
    const alice = leads.find((lead) => lead.id === "lead-alice")!;
    const aliceBis = leads.find((lead) => lead.id === "lead-alice-bis")!;
    assert.notEqual(alice.clientId, aliceBis.clientId, "aucune fusion imposée");
    assert.equal(alice.campagne, "Rentrée");

    const ficheAlice = await prisma.client.findUniqueOrThrow({ where: { id: alice.clientId! }, include: { telephones: true, emails: true } });
    assert.equal(ficheAlice.nom, "Alice Durand");
    assert.equal(ficheAlice.source, "META_ADS");
    assert.equal(ficheAlice.publicite, "Avant-après");
    assert.equal(ficheAlice.telephones[0].numero, "+33612345678");
    assert.equal(ficheAlice.premierContactLe.toISOString().slice(0, 10), "2026-03-01");
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: leads.find((l) => l.id === "lead-bob")!.clientId! } })).source, "RECOMMANDATION");

    const dossierAlice = await prisma.dossier.findUniqueOrThrow({ where: { id: "dossier-alice" } });
    assert.equal(dossierAlice.clientId, alice.clientId);
    const fld = await prisma.client.findUniqueOrThrow({ where: { id: (await prisma.dossier.findUniqueOrThrow({ where: { id: "dossier-fld" } })).clientId! } });
    assert.equal(fld.categorie, "DONNEUR_ORDRE");
    assert.equal(fld.source, "SOUS_TRAITANCE");

    const fusions = await prisma.proposition.findMany({ where: { type: "FUSION_CLIENTS" } });
    assert.equal(fusions.length, 1, "une proposition pour la paire Alice");
    assert.match(fusions[0].raisonnement ?? "", /même numéro/);
    assert.equal(await prisma.client.count(), 4, "rejouer la migration ne crée rien");
  });
});

describe("fusion validée", () => {
  test("tout rejoint la fiche conservée, l'autre est archivée ; un rejet n'est jamais reproposé", async () => {
    const [fusion] = await prisma.proposition.findMany({ where: { type: "FUSION_CLIENTS", statut: "EN_ATTENTE" } });
    const contenu = JSON.parse(fusion.contenu) as { clientAId: string; clientBId: string; conserver: "A" | "B" };
    const conserve = contenu.conserver === "A" ? contenu.clientAId : contenu.clientBId;
    const absorbe = contenu.conserver === "A" ? contenu.clientBId : contenu.clientAId;
    await avecActeur(LUCAS, () =>
      prisma.consentementMail.create({
        data: { clientId: absorbe, statut: "ACCORDE", moyen: "ORAL", recueilliLe: new Date("2026-05-10") },
      })
    );

    await avecActeur(LUCAS, () => validation.validerProposition(fusion.id));

    const fiche = await prisma.client.findUniqueOrThrow({ where: { id: absorbe } });
    assert.ok(fiche.archiveLe);
    assert.equal(fiche.fusionneDansId, conserve);
    assert.equal(await prisma.lead.count({ where: { clientId: conserve } }), 2);
    assert.equal(await prisma.dossier.count({ where: { clientId: conserve } }), 1);
    assert.equal(await prisma.consentementMail.count({ where: { clientId: conserve } }), 1);
    const telephones = await prisma.clientTelephone.findMany({ where: { clientId: conserve } });
    assert.equal(telephones.filter((telephone) => telephone.principal).length, 1);
    assert.equal((await moduleFusion.ficheVivante(absorbe))?.id, conserve);

    // Une paire rejetée ne revient pas.
    const nouvelle = await avecActeur(LUCAS, () =>
      fiches.creerClientManuel({
        categorie: "PARTICULIER",
        prenom: "Bob",
        nomFamille: "Martin",
        raisonSociale: null,
        siret: null,
        adresse: null,
        codePostal: null,
        ville: "Lattes",
        source: "BOUCHE_A_OREILLE",
        sourceDetail: null,
        campagne: null,
        publicite: null,
        formulaire: null,
        recommandeParId: null,
        recommandeParTexte: null,
        notes: null,
        telephone: "07 00 00 00 01",
        forcer: true,
      })
    );
    assert.ok(nouvelle);
    await avecActeur({ acteur: "SYSTEME:doublons" }, () => doublons.proposerFusions());
    const pairesBob = await prisma.proposition.findMany({ where: { type: "FUSION_CLIENTS", statut: "EN_ATTENTE" } });
    assert.equal(pairesBob.length, 1);
    await avecActeur(LUCAS, () => validation.rejeterProposition(pairesBob[0].id, { motif: "PERSONNES_DIFFERENTES" }));
    assert.equal(await avecActeur({ acteur: "SYSTEME:doublons" }, () => doublons.proposerFusions()), 0);
  });
});

describe("consentement", () => {
  test("une déclaration ne se modifie pas ; on en enregistre une nouvelle", async () => {
    const client = await prisma.client.findFirstOrThrow({ where: { consentements: { some: {} } }, include: { consentements: true } });
    await assert.rejects(
      () => prisma.consentementMail.update({ where: { id: client.consentements[0].id }, data: { statut: "RETIRE" } }),
      (erreur: unknown) => erreur instanceof Error && erreur.name === "EcritureRefusee" && /ne se modifie pas/.test(erreur.message)
    );
    await avecActeur(LUCAS, () =>
      fiches.enregistrerConsentement(client.id, { statut: "RETIRE", moyen: "EMAIL", recueilliLe: "2026-09-01", preuve: "Mail du 1er septembre" })
    );
    const detail = await fiches.chargerFiche(client.id);
    assert.equal(detail.consentements[0].statut, "RETIRE");
    assert.equal(detail.consentements.length, 2);
  });
});

describe("nouveaux contacts", () => {
  test("un lead entrant rejoint le client qui a déjà ce numéro ; consentement daté enregistré", async () => {
    const existant = await prisma.client.findFirstOrThrow({ where: { telephones: { some: { numero: "+33612345678" } } } });
    const lead = await avecActeur({ acteur: "EXTERNE:/api/webhook" }, () =>
      prisma.lead.create({ data: { nom: "Durand", prenom: "Alice", telephone: "+33 6 12 34 56 78", email: "alice.pro@exemple.fr", ville: "Pérols", source: "SITE_CONTACT" } })
    );
    const clientId = await avecActeur({ acteur: "EXTERNE:/api/webhook" }, () =>
      identification.rattacherLead(prisma, lead.id, { accorde: true, moyen: "FORMULAIRE_SITE", recueilliLe: new Date(), preuve: "Case « J'accepte de recevoir des offres »" })
    );
    assert.equal(clientId, existant.id);
    const emails = await prisma.clientEmail.findMany({ where: { clientId } });
    assert.ok(emails.some((email) => email.adresse === "alice.pro@exemple.fr"));
    const dernier = await prisma.consentementMail.findFirstOrThrow({ where: { clientId }, orderBy: { createdAt: "desc" } });
    assert.equal(dernier.statut, "ACCORDE");
  });

  test("dossier ouvert à la main : client retrouvé par numéro, ou fiche créée", async () => {
    const { creerDossier } = await import("@/lib/dossiers/dossiers");
    const photo = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], "chantier.jpg", { type: "image/jpeg" });
    const entree = {
      clientNom: "Madame Durand",
      clientAdresse: "3 rue du Port",
      clientCp: "34470",
      clientVille: "Pérols",
      clientTelephone: "06-12-34-56-78",
      clientEmail: null,
      objet: "Salle de bains",
      source: "RECOMMANDATION" as const,
      montantEstime: null,
      prochaineAction: null,
      prochaineActionDate: null,
      leadId: null,
      prospectId: null,
    };
    const idDossier = await avecActeur(LUCAS, () => creerDossier(entree, [photo()]));
    const retrouve = await prisma.dossier.findUniqueOrThrow({ where: { id: idDossier } });
    const alice = await prisma.client.findFirstOrThrow({ where: { telephones: { some: { numero: "+33612345678" } } } });
    assert.equal(retrouve.clientId, alice.id);

    const idNouveau = await avecActeur(LUCAS, () =>
      creerDossier({ ...entree, clientNom: "Hôtel des Flots", clientTelephone: "04 67 11 22 33", source: "PROSPECTION" }, [photo()])
    );
    const nouveau = await prisma.dossier.findUniqueOrThrow({ where: { id: idNouveau }, include: { client: true } });
    assert.equal(nouveau.client?.categorie, "PROFESSIONNEL");
    assert.equal(nouveau.client?.nom, "Hôtel des Flots");
  });

  test("création manuelle d'un client déjà connu : refus explicite, sauf à forcer", async () => {
    await assert.rejects(
      avecActeur(LUCAS, () =>
        fiches.creerClientManuel({
          categorie: "PARTICULIER",
          prenom: "Alice",
          nomFamille: "D.",
          raisonSociale: null,
          siret: null,
          adresse: null,
          codePostal: null,
          ville: null,
          source: "AUTRE",
          sourceDetail: null,
          campagne: null,
          publicite: null,
          formulaire: null,
          recommandeParId: null,
          recommandeParTexte: null,
          notes: null,
          email: "ALICE@exemple.fr",
        })
      ),
      /déjà cet e-mail ou ce numéro/
    );
  });

  test("un client avec un dossier en cours ne s'archive pas", async () => {
    const avecDossier = await prisma.client.findFirstOrThrow({ where: { dossiers: { some: { etape: "QUALIFICATION" } } } });
    await assert.rejects(avecActeur(LUCAS, () => fiches.archiverClient(avecDossier.id, "Test")), /dossiers en cours/);
  });
});
