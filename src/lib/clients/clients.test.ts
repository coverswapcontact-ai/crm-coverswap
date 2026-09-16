import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { preparerBaseEssai } from "@/test/base-essai";
import { definirTransportAnnuaireEssai, lireReponseAnnuaire, rechercherEntreprises, termeAnnuaire } from "./annuaire";
import {
  avertissementSiret,
  cleNom,
  erreurSaisieSiret,
  formaterSiret,
  formaterTelephone,
  lireNotesAcquisition,
  nomAffichage,
  normaliserEmail,
  normaliserTelephone,
  siretValide,
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

  test("SIRET : 14 chiffres exigés, clé de contrôle signalée (exception de La Poste comprise)", () => {
    assert.equal(siretValide("912 345 678 00011"), true);
    assert.equal(siretValide("91234567800012"), false, "un chiffre faux");
    assert.equal(siretValide("9123456780001"), false, "13 chiffres");
    assert.equal(siretValide("35600000049837"), true, "La Poste : somme des chiffres multiple de 5");
    assert.equal(siretValide("35600000011111"), false);
    assert.equal(formaterSiret("91234567800011"), "912 345 678 00011");
    assert.equal(erreurSaisieSiret("912 345", false), null, "rien tant que la saisie n'est pas finie");
    assert.equal(erreurSaisieSiret("912 345", true), "14 chiffres attendus.");
    assert.equal(erreurSaisieSiret("912 345 678 0001A", false), "14 chiffres attendus.");
    assert.equal(erreurSaisieSiret("912 345 678 00012", false), null, "une clé fausse n'empêche pas d'enregistrer");
    assert.match(avertissementSiret("912 345 678 00012") ?? "", /Clé de contrôle fausse/);
    assert.equal(avertissementSiret("912 345 678 00011"), null);
    assert.equal(avertissementSiret("912 345"), null, "le format se dit par l'erreur, pas par l'avertissement");
    assert.equal(erreurSaisieSiret("", true), null);
  });
});

describe("annuaire des entreprises", () => {
  // Réponse de recherche-entreprises.api.gouv.fr, réduite aux champs lus ; entreprises fictives.
  const reponse = {
    results: [
      {
        siren: "912345678",
        nom_complet: "HOTEL DES FLOTS (LES FLOTS BLEUS)",
        nom_raison_sociale: "HOTEL DES FLOTS",
        etat_administratif: "A",
        siege: { siret: "91234567800011", adresse: "3 RUE DU PORT 34470 PEROLS", code_postal: "34470", libelle_commune: "PEROLS", est_siege: true, etat_administratif: "A" },
        matching_etablissements: [
          {
            siret: "91234567800029",
            adresse: "12 AVENUE DE LA MER 34280 LA GRANDE-MOTTE",
            code_postal: "34280",
            libelle_commune: "LA GRANDE-MOTTE",
            est_siege: false,
            etat_administratif: "F",
            liste_enseignes: ["LES FLOTS BLEUS"],
          },
          {
            siret: "91234567800011",
            adresse: "3 RUE DU PORT 34470 PEROLS",
            code_postal: "34470",
            libelle_commune: "PEROLS",
            est_siege: true,
            etat_administratif: "A",
            nom_commercial: "HOTEL DES FLOTS",
          },
        ],
      },
      {
        siren: "987654321",
        nom_complet: "[NON-DIFFUSIBLE]",
        nom_raison_sociale: "[NON-DIFFUSIBLE]",
        etat_administratif: "A",
        siege: { siret: "98765432100015", adresse: "[NON-DIFFUSIBLE]", code_postal: "[NON-DIFFUSIBLE]", libelle_commune: "LATTES", est_siege: true, etat_administratif: "A" },
        matching_etablissements: [],
      },
      { siren: "pas un siren" },
    ],
  };

  test("établissements lus : voie seule, enseigne distincte, non diffusible vidé, fermés en dernier", () => {
    const lus = lireReponseAnnuaire(reponse);
    assert.deepEqual(
      lus.map((etablissement) => etablissement.siret),
      ["91234567800011", "98765432100015", "91234567800029"]
    );
    assert.deepEqual(lus[0], {
      siren: "912345678",
      siret: "91234567800011",
      raisonSociale: "HOTEL DES FLOTS",
      enseigne: null,
      adresse: "3 RUE DU PORT",
      codePostal: "34470",
      ville: "PEROLS",
      siege: true,
      ferme: false,
    });
    assert.equal(lus[1].raisonSociale, null);
    assert.equal(lus[1].adresse, null);
    assert.equal(lus[1].codePostal, null);
    assert.equal(lus[1].ville, "LATTES");
    assert.equal(lus[2].enseigne, "LES FLOTS BLEUS");
    assert.equal(lus[2].adresse, "12 AVENUE DE LA MER");
    assert.equal(lus[2].ferme, true);
    assert.deepEqual(lireReponseAnnuaire({ erreur: "inattendu" }), []);
  });

  test("recherche : SIRET tapé avec espaces, saisie trop courte sans appel, annuaire saturé ou injoignable", async () => {
    const appels: string[] = [];
    definirTransportAnnuaireEssai(async (url) => {
      appels.push(url);
      return new Response(JSON.stringify(reponse), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    try {
      assert.equal(termeAnnuaire("  hô "), null);
      assert.deepEqual(await rechercherEntreprises("hô"), []);
      assert.equal(appels.length, 0, "rien ne part pour moins de trois caractères");

      const trouves = await rechercherEntreprises("912 345 678 00011");
      assert.equal(new URL(appels[0]).searchParams.get("q"), "91234567800011");
      assert.equal(trouves[0].raisonSociale, "HOTEL DES FLOTS");

      definirTransportAnnuaireEssai(async () => new Response("{}", { status: 429 }));
      await assert.rejects(rechercherEntreprises("hotel des flots"), (erreur: unknown) => erreur instanceof ErreurMetier && erreur.status === 503 && /saturé/.test(erreur.message));
      definirTransportAnnuaireEssai(async () => {
        throw new TypeError("fetch failed");
      });
      await assert.rejects(rechercherEntreprises("hotel des flots"), /injoignable/);
    } finally {
      definirTransportAnnuaireEssai(null);
    }
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

  test("client pro : l'entité sans prénom ni nom, SIRET à la clé fausse signalé, unique sauf à forcer", async () => {
    const entreprise = {
      categorie: "PROFESSIONNEL" as const,
      prenom: "Marie",
      nomFamille: "Martin",
      raisonSociale: "SARL Les Flots Bleus",
      siret: "91234567800011",
      adresse: "3 rue du Port",
      codePostal: "34470",
      ville: "Pérols",
      source: "PROSPECTION" as const,
      sourceDetail: null,
      campagne: null,
      publicite: null,
      formulaire: null,
      recommandeParId: null,
      recommandeParTexte: null,
      notes: null,
    };
    const { id, avertissements } = await avecActeur(LUCAS, () => fiches.creerClientManuel(entreprise));
    assert.deepEqual(avertissements, []);
    const cree = await prisma.client.findUniqueOrThrow({ where: { id } });
    assert.equal(cree.nom, "SARL Les Flots Bleus");
    assert.equal(cree.prenom, null, "un client pro n'a pas de prénom");
    assert.equal(cree.nomFamille, null);
    assert.equal(cree.siret, "91234567800011");

    await assert.rejects(avecActeur(LUCAS, () => fiches.creerClientManuel({ ...entreprise, raisonSociale: null })), /raison sociale/);
    const cleFausse = await avecActeur(LUCAS, () =>
      fiches.creerClientManuel(fiches.schemaCreationClient.parse({ ...entreprise, raisonSociale: "Atelier Clé Fausse", siret: "912 345 678 00012", source: null }))
    );
    assert.deepEqual(cleFausse.avertissements, [
      "Clé de contrôle fausse : un chiffre est sans doute mal saisi. Le SIRET est gardé tel quel.",
      "Source non renseignée : elle manquera aux statistiques d'acquisition.",
    ]);
    const gardee = await prisma.client.findUniqueOrThrow({ where: { id: cleFausse.id } });
    assert.equal(gardee.siret, "91234567800012");
    assert.equal(gardee.source, "INCONNUE");
    assert.throws(() => fiches.schemaCreationClient.parse({ ...entreprise, siret: "912 345" }), /14 chiffres/);
    await assert.rejects(
      avecActeur(LUCAS, () => fiches.creerClientManuel({ ...entreprise, raisonSociale: "Les Flots Bleus" })),
      (erreur: unknown) => erreur instanceof ErreurMetier && erreur.status === 409 && /déjà ce SIRET/.test(erreur.message) && erreur.details?.clientExistantId === id
    );
    const forcee = await avecActeur(LUCAS, () => fiches.creerClientManuel({ ...entreprise, raisonSociale: "Les Flots Bleus", forcer: true }));
    assert.notEqual(forcee.id, id);

    const { id: particulier } = await avecActeur(LUCAS, () =>
      fiches.creerClientManuel({ ...entreprise, categorie: "PARTICULIER", siret: "98765432100015", telephone: "07 11 22 33 44" })
    );
    const personne = await prisma.client.findUniqueOrThrow({ where: { id: particulier } });
    assert.equal(personne.nom, "Marie Martin");
    assert.equal(personne.raisonSociale, null, "un particulier n'a ni raison sociale ni SIRET");
    assert.equal(personne.siret, null);
  });

  test("modifier une fiche : l'entité ne perd pas son nom, un SIRET nouveau à la clé fausse est signalé, une fiche ancienne reste modifiable", async () => {
    const pro = await prisma.client.findFirstOrThrow({ where: { raisonSociale: "SARL Les Flots Bleus" } });
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierClient(pro.id, { raisonSociale: null })), /raison sociale/);
    assert.deepEqual(await avecActeur(LUCAS, () => fiches.modifierClient(pro.id, { siret: "98765432100016" })), [
      "Clé de contrôle fausse : un chiffre est sans doute mal saisi. Le SIRET est gardé tel quel.",
    ]);
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: pro.id } })).siret, "98765432100016");
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierClient(pro.id, { categorie: "PARTICULIER", raisonSociale: null, siret: null })), /prénom ou un nom/);
    await avecActeur(LUCAS, () => fiches.modifierClient(pro.id, { siret: "98765432100015", notes: "Facturer au siège" }));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: pro.id } })).siret, "98765432100015");

    // Un SIRET enregistré avant le contrôle ne bloque pas la fiche.
    await avecActeur(LUCAS, () => prisma.client.update({ where: { id: pro.id }, data: { siret: "12345678901234" } }));
    assert.deepEqual(await avecActeur(LUCAS, () => fiches.modifierClient(pro.id, { siret: "12345678901234", sourceDetail: "Salon de l'hôtellerie" })), [], "rien de neuf à signaler");

    // Un particulier qui devient pro doit recevoir sa raison sociale.
    const personne = await prisma.client.findFirstOrThrow({ where: { nom: "Marie Martin" } });
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierClient(personne.id, { categorie: "PROFESSIONNEL" })), /raison sociale/);
    await avecActeur(LUCAS, () => fiches.modifierClient(personne.id, { categorie: "PROFESSIONNEL", raisonSociale: "Martin Déco" }));
    const devenuPro = await prisma.client.findUniqueOrThrow({ where: { id: personne.id } });
    assert.equal(devenuPro.nom, "Martin Déco");
    assert.equal(devenuPro.prenom, "Marie", "le contact reste tant qu'on ne le retire pas");

    // Fiche pro venue d'un formulaire, sans nom d'entreprise : modifiable en attendant de le connaître.
    const formulaire = await avecActeur({ acteur: "EXTERNE:/api/webhook" }, () =>
      identification.creerClient(prisma, { categorie: "PROFESSIONNEL", prenom: "Paul", nomFamille: "Durand", source: "SITE_DEVIS", premierContactLe: new Date() })
    );
    await avecActeur(LUCAS, () => fiches.modifierClient(formulaire.id, { categorie: "PROFESSIONNEL", raisonSociale: null, sourceDetail: "Formulaire pro" }));
    await avecActeur(LUCAS, () => fiches.modifierClient(formulaire.id, { raisonSociale: "Durand Agencement" }));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: formulaire.id } })).nom, "Durand Agencement");
  });

  test("rien d'obligatoire au-delà du nom : fiche créée sans coordonnée ni source, code postal étranger accepté", async () => {
    const vide = {
      categorie: "PARTICULIER",
      prenom: null,
      nomFamille: "Coquille",
      raisonSociale: null,
      siret: null,
      adresse: null,
      codePostal: "B-1050",
      ville: "Ixelles",
      source: null,
      sourceDetail: null,
      campagne: null,
      publicite: null,
      formulaire: null,
      recommandeParId: null,
      recommandeParTexte: null,
      notes: null,
    };
    const { id, avertissements } = await avecActeur(LUCAS, () => fiches.creerClientManuel(fiches.schemaCreationClient.parse(vide)));
    assert.deepEqual(avertissements, ["Source non renseignée : elle manquera aux statistiques d'acquisition."]);
    const fiche = await prisma.client.findUniqueOrThrow({ where: { id }, include: { emails: true, telephones: true } });
    assert.equal(fiche.nom, "Coquille");
    assert.equal(fiche.codePostal, "B-1050");
    assert.equal(fiche.emails.length + fiche.telephones.length, 0);
    await assert.rejects(
      avecActeur(LUCAS, () => fiches.creerClientManuel(fiches.schemaCreationClient.parse({ ...vide, nomFamille: null }))),
      /prénom ou un nom/
    );
  });

  test("une coordonnée mal saisie se corrige sur place, le journal garde l'ancienne valeur ; une fiche fusionnée reste figée", async () => {
    const { id } = await avecActeur(LUCAS, () =>
      fiches.creerClientManuel(
        fiches.schemaCreationClient.parse({
          categorie: "PARTICULIER",
          prenom: "Jeanne",
          nomFamille: "Faute",
          raisonSociale: null,
          siret: null,
          adresse: null,
          codePostal: null,
          ville: null,
          source: "BOUCHE_A_OREILLE",
          sourceDetail: null,
          campagne: null,
          publicite: null,
          formulaire: null,
          recommandeParId: null,
          recommandeParTexte: null,
          notes: null,
          telephone: "06 99 88 77 66",
          email: "jeane@exemple.fr",
        })
      )
    );
    const telephone = await prisma.clientTelephone.findFirstOrThrow({ where: { clientId: id } });
    await avecActeur(LUCAS, () => fiches.modifierCoordonnee(id, "telephone", telephone.id, { valeur: "06 99 88 77 65", libelle: "perso" }));
    const corrige = await prisma.clientTelephone.findUniqueOrThrow({ where: { id: telephone.id } });
    assert.equal(corrige.numero, "+33699887765");
    assert.equal(corrige.saisi, "06 99 88 77 65");
    assert.equal(corrige.libelle, "perso");
    assert.equal(corrige.principal, true, "la coordonnée corrigée garde son rang");
    const journal = await prisma.$queryRawUnsafe<{ avant: string | null; apres: string }[]>(
      `SELECT "avant", "apres" FROM "JournalModification" WHERE "modele" = 'ClientTelephone' AND "enregistrementId" = ? ORDER BY "horodatage", rowid`,
      telephone.id
    );
    assert.ok(journal.some((ligne) => ligne.avant?.includes("+33699887766") && ligne.apres.includes("+33699887765")), "l'ancienne valeur reste au journal");

    const email = await prisma.clientEmail.findFirstOrThrow({ where: { clientId: id } });
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierCoordonnee(id, "email", email.id, { valeur: "jeanne@" })), /illisible/);
    await avecActeur(LUCAS, () => fiches.ajouterCoordonnee(id, "email", "jeanne.pro@exemple.fr", null));
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierCoordonnee(id, "email", email.id, { valeur: "Jeanne.Pro@exemple.fr" })), /déjà sur la fiche/);
    await avecActeur(LUCAS, () => fiches.modifierCoordonnee(id, "email", email.id, { valeur: " Jeanne@Exemple.fr " }));
    assert.equal((await prisma.clientEmail.findUniqueOrThrow({ where: { id: email.id } })).adresse, "jeanne@exemple.fr");

    const absorbee = await prisma.client.findFirstOrThrow({ where: { ...AVEC_ARCHIVES, fusionneDansId: { not: null } } });
    await assert.rejects(avecActeur(LUCAS, () => fiches.modifierClient(absorbee.id, { notes: "Trop tard" })), /fiche conservée qui se modifie/);
  });

  test("un client avec un dossier en cours s'archive, c'est signalé ; la fiche archivée reste modifiable", async () => {
    const avecDossier = await prisma.client.findFirstOrThrow({
      where: { archiveLe: null, fusionneDansId: null, dossiers: { some: { etape: "QUALIFICATION", archiveLe: null } } },
    });
    const avertissements = await avecActeur(LUCAS, () => fiches.archiverClient(avecDossier.id, "Déménagement"));
    assert.equal(avertissements.length, 1);
    assert.match(avertissements[0], /^\d+ dossiers? en cours restent? ouverts? dans Dossiers\.$/);
    assert.ok((await prisma.dossier.count({ where: { clientId: avecDossier.id, archiveLe: null, etape: "QUALIFICATION" } })) > 0, "le dossier n'est pas touché");

    assert.deepEqual(await avecActeur(LUCAS, () => fiches.modifierClient(avecDossier.id, { notes: "Nouvelle adresse à demander" })), []);
    const telephone = await prisma.clientTelephone.findFirst({ where: { clientId: avecDossier.id, archiveLe: null } });
    if (telephone) await avecActeur(LUCAS, () => fiches.modifierCoordonnee(avecDossier.id, "telephone", telephone.id, { libelle: "ancien" }));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: avecDossier.id } })).notes, "Nouvelle adresse à demander");

    await avecActeur(LUCAS, () => fiches.restaurerClient(avecDossier.id));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: avecDossier.id } })).archiveLe, null);
  });
});
