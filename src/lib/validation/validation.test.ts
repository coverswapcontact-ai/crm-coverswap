import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { z } from "zod/v4";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let service: typeof import("@/lib/validation/service");
let catalogue: typeof import("@/lib/validation/catalogue");
let executeur: typeof import("@/lib/taches/executeur");

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr", origine: "POST /api/validation" };
const AGENT = { acteur: "AGENT:mail" };

let echecsEnvoi = 0;
const envois: string[] = [];

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  service = await import("@/lib/validation/service");
  catalogue = await import("@/lib/validation/catalogue");
  executeur = await import("@/lib/taches/executeur");
  await (await import("@/lib/base/preparation")).preparerBase();
  (await import("@/lib/validation/taches")).enregistrerTachesValidation();
  const { definirProposition } = await import("@/lib/validation/definitions");

  // Envoi fictif vers « l'extérieur », exécuté par la file de tâches.
  catalogue.enregistrerTypeProposition(
    definirProposition({
      type: "ESSAI_ENVOI",
      libelle: "Envoi d'essai",
      schema: z.object({ dossierId: z.string(), texte: z.string().min(1) }),
      sensible: true,
      validationGroupee: false,
      champs: [{ cle: "texte", libelle: "Texte", nature: "texteLong" }],
      execution: "FILE",
      async executer(contenu) {
        if (echecsEnvoi > 0) {
          echecsEnvoi--;
          throw new Error("Serveur de mail injoignable");
        }
        envois.push(contenu.texte);
        await prisma.dossierEvenement.create({
          data: { dossierId: contenu.dossierId, type: "MAIL_ENVOYE", direction: "SORTANT", contenu: contenu.texte },
        });
        return { resultat: { envoye: true } };
      },
    })
  );
  // Règle métier qui refuse à l'exécution, après avoir commencé à écrire : tout doit revenir en arrière.
  const { ErreurMetier } = await import("@/lib/commun/erreurs");
  catalogue.enregistrerTypeProposition(
    definirProposition({
      type: "ESSAI_REFUS",
      libelle: "Action refusée à l'exécution",
      schema: z.object({ dossierId: z.string() }),
      sensible: false,
      validationGroupee: false,
      champs: [],
      execution: "IMMEDIATE",
      async executer(contenu, { tx }) {
        await tx!.dossierEvenement.create({ data: { dossierId: contenu.dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Écrit avant le refus" } });
        await tx!.dossier.update({ where: { id: contenu.dossierId }, data: { etape: "PLANIFIE" } });
        throw new ErreurMetier("La règle d'essai refuse cette action.", 409);
      },
    })
  );
  // Action automatisable (bruit) et action automatisable mais sensible (interdite).
  catalogue.enregistrerTypeProposition(
    definirProposition({
      type: "ESSAI_BRUIT",
      libelle: "Archiver du bruit",
      schema: z.object({ dossierId: z.string() }),
      sensible: false,
      validationGroupee: true,
      automatisable: true,
      execution: "IMMEDIATE",
      async executer(contenu, { tx }) {
        await tx!.dossierEvenement.create({
          data: { dossierId: contenu.dossierId, type: "NOTE_AJOUTEE", direction: "INTERNE", contenu: "Bruit archivé" },
        });
      },
    })
  );
  catalogue.enregistrerTypeProposition(
    definirProposition({
      type: "ESSAI_ENCAISSEMENT",
      libelle: "Enregistrer un encaissement",
      schema: z.object({ montant: z.number() }),
      sensible: true,
      validationGroupee: false,
      automatisable: true,
      execution: "IMMEDIATE",
      async executer() {},
    })
  );
});

after(async () => {
  await prisma.$disconnect();
});

async function dossier(etape = "QUALIFICATION") {
  return prisma.dossier.create({
    data: {
      clientNom: "Durand",
      clientAdresse: "1 rue des Essais",
      clientCp: "34470",
      clientVille: "Pérols",
      clientTelephone: "0600000000",
      objet: "Cuisine",
      source: "ENTRANT",
      etape,
      photos: JSON.stringify(["dossiers/x/photos/a.jpg"]),
    },
  });
}

function proposerNote(dossierId: string, texte = "Le client rappelle lundi", cleUnicite?: string) {
  return avecActeur(AGENT, () =>
    service.proposer({
      type: "NOTE_DOSSIER",
      titre: "Noter l'appel du client",
      raisonnement: "Le mail dit : « je vous rappelle lundi »",
      confiance: 0.8,
      contenu: { dossierId, texte },
      dossierId,
      cleUnicite,
    })
  );
}

describe("proposer", () => {
  test("contenu contrôlé, auteur tracé, même clé proposée une seule fois", async () => {
    const { id: dossierId } = await dossier();
    await assert.rejects(
      avecActeur(AGENT, () =>
        service.proposer({ type: "NOTE_DOSSIER", titre: "Vide", contenu: { dossierId, texte: "" } })
      ),
      /La note est vide/
    );
    const premiere = await proposerNote(dossierId, "Rappel lundi", "note:mail-1");
    const seconde = await proposerNote(dossierId, "Rappel lundi", "note:mail-1");
    assert.equal(premiere.creee, true);
    assert.equal(seconde.creee, false);
    assert.equal(seconde.id, premiere.id);
    const enBase = await prisma.proposition.findUniqueOrThrow({ where: { id: premiere.id } });
    assert.equal(enBase.auteur, "AGENT:mail");
    assert.equal(enBase.statut, "EN_ATTENTE");
  });
});

describe("valider", () => {
  test("telle quelle : exécutée dans la même transaction, écritures attribuées à la personne", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await proposerNote(dossierId);
    const vue = await avecActeur(LUCAS, () => service.validerProposition(id));
    assert.equal(vue.statut, "EXECUTEE");
    assert.equal(vue.modifiee, false);
    assert.equal(vue.decidePar, LUCAS.acteur);

    const note = await prisma.dossierNote.findFirstOrThrow({ where: { dossierId } });
    assert.equal(note.contenu, "Le client rappelle lundi");
    const [ligne] = await prisma.$queryRawUnsafe<{ acteur: string }[]>(
      `SELECT acteur FROM "JournalModification" WHERE "modele" = 'DossierNote' AND "enregistrementId" = ?`,
      note.id
    );
    assert.equal(ligne.acteur, LUCAS.acteur);
  });

  test("corrigée : seuls les champs modifiables comptent, la version de l'agent reste", async () => {
    const { id: dossierId } = await dossier();
    const autre = await dossier();
    const { id } = await proposerNote(dossierId, "Rapel lundi");
    const vue = await avecActeur(LUCAS, () =>
      service.validerProposition(id, { texte: "Rappel lundi à 9 h", dossierId: autre.id })
    );
    assert.equal(vue.modifiee, true);
    assert.equal(vue.contenu.texte, "Rapel lundi");
    assert.equal(vue.contenuValide?.texte, "Rappel lundi à 9 h");
    assert.equal(vue.contenuValide?.dossierId, dossierId);
    assert.equal(await prisma.dossierNote.count({ where: { dossierId: autre.id } }), 0);
  });

  test("seule une personne décide ; une proposition ne se valide qu'une fois", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await proposerNote(dossierId);
    await assert.rejects(avecActeur(AGENT, () => service.validerProposition(id)), /Seule une personne/);
    await assert.rejects(avecActeur({ acteur: "SYSTEME:taches" }, () => service.rejeterProposition(id, { motif: "INUTILE" })), /Seule une personne/);
    await avecActeur(LUCAS, () => service.validerProposition(id));
    await assert.rejects(avecActeur(LUCAS, () => service.validerProposition(id)), /déjà été traitée/);
    assert.equal(await prisma.dossierNote.count({ where: { dossierId } }), 1);
  });

  test("exécution impossible : rien n'est écrit, la proposition reste à valider avec l'erreur", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await avecActeur(AGENT, () =>
      service.proposer({
        type: "ESSAI_REFUS",
        titre: "Action refusée à l'exécution",
        contenu: { dossierId },
        dossierId,
      })
    );
    await assert.rejects(avecActeur(LUCAS, () => service.validerProposition(id)), /Exécution impossible : La règle d'essai refuse/);
    const enBase = await prisma.proposition.findUniqueOrThrow({ where: { id } });
    assert.equal(enBase.statut, "EN_ATTENTE");
    assert.ok(enBase.erreurExecution);
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "QUALIFICATION");
    assert.equal(await prisma.dossierEvenement.count({ where: { dossierId } }), 0);
  });

  test("changement d'étape validé ; devenu sans objet, il est annulé et non exécuté", async () => {
    const { id: dossierId } = await dossier();
    const proposition = (vers: string, cle: string) =>
      avecActeur(AGENT, () =>
        service.proposer({ type: "CHANGEMENT_ETAPE", titre: "Étape", contenu: { dossierId, vers }, cleUnicite: cle })
      );
    const { id: premiere } = await proposition("SIMULATION", "etape-1");
    const { id: doublon } = await proposition("SIMULATION", "etape-2");
    assert.equal((await avecActeur(LUCAS, () => service.validerProposition(premiere))).statut, "EXECUTEE");
    assert.equal((await prisma.dossier.findUniqueOrThrow({ where: { id: dossierId } })).etape, "SIMULATION");
    await assert.rejects(avecActeur(LUCAS, () => service.validerProposition(doublon)), /sans objet/);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: doublon } })).statut, "ANNULEE");
  });
});

describe("rejeter", () => {
  test("motif obligatoire, commentaire exigé pour « Autre »", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await proposerNote(dossierId);
    await assert.rejects(avecActeur(LUCAS, () => service.rejeterProposition(id, { motif: "" })), /motif du rejet/);
    await assert.rejects(avecActeur(LUCAS, () => service.rejeterProposition(id, { motif: "AUTRE" })), /Précise/);
    const vue = await avecActeur(LUCAS, () =>
      service.rejeterProposition(id, { motif: "AUTRE", commentaire: "Le client n'a jamais dit ça" })
    );
    assert.equal(vue.statut, "REJETEE");
    assert.equal(vue.motifRejet, "AUTRE");
    assert.equal(vue.commentaireRejet, "Le client n'a jamais dit ça");
    assert.equal(await prisma.dossierNote.count({ where: { dossierId } }), 0);
  });
});

describe("l'agent ne décide jamais seul de l'argent ni du client", () => {
  test("exécution sans validation : refusée pour un type non automatisable ou sensible", async () => {
    const { id: dossierId } = await dossier();
    await assert.rejects(
      avecActeur(AGENT, () =>
        service.executerSansValidation(
          { type: "NOTE_DOSSIER", titre: "Note", confiance: 1, contenu: { dossierId, texte: "x" } },
          0.95
        )
      ),
      /interdite/
    );
    await assert.rejects(
      avecActeur(AGENT, () =>
        service.executerSansValidation(
          { type: "ESSAI_ENCAISSEMENT", titre: "Encaissement", confiance: 1, contenu: { montant: 100 } },
          0.95
        )
      ),
      /interdite/
    );
  });

  test("bruit à très haute confiance : exécuté et tracé ; sous le seuil : proposé", async () => {
    const { id: dossierId } = await dossier();
    const haute = await avecActeur(AGENT, () =>
      service.executerSansValidation(
        { type: "ESSAI_BRUIT", titre: "Archiver la newsletter", confiance: 0.99, contenu: { dossierId }, cleUnicite: "bruit-1" },
        0.95
      )
    );
    assert.equal(haute.execution, "AUTOMATIQUE");
    const tracee = await prisma.proposition.findUniqueOrThrow({ where: { id: haute.id } });
    assert.equal(tracee.statut, "AUTOMATIQUE");
    assert.equal(tracee.decidePar, "AGENT:mail");
    assert.ok(tracee.executeLe);

    const basse = await avecActeur(AGENT, () =>
      service.executerSansValidation(
        { type: "ESSAI_BRUIT", titre: "Archiver ?", confiance: 0.7, contenu: { dossierId }, cleUnicite: "bruit-2" },
        0.95
      )
    );
    assert.equal(basse.execution, "PROPOSEE");
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: basse.id } })).statut, "EN_ATTENTE");
  });

  test("validation en lot : les propositions sensibles restent à valider une par une", async () => {
    const { id: dossierId } = await dossier();
    const { id: note } = await proposerNote(dossierId, "Note en lot");
    const { id: perte } = await avecActeur(AGENT, () =>
      service.proposer({
        type: "CHANGEMENT_ETAPE",
        titre: "Dossier perdu",
        contenu: { dossierId, vers: "PERDU", motifPerte: MOTIF_PERTE_ESSAI },
      })
    );
    const bilan = await avecActeur(LUCAS, () => service.validerEnLot([note, perte]));
    assert.deepEqual(bilan.validees, [note]);
    assert.equal(bilan.ignorees[0].id, perte);
    assert.match(bilan.ignorees[0].raison, /une par une/);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id: perte } })).statut, "EN_ATTENTE");
  });
});

const MOTIF_PERTE_ESSAI = "PRIX";

describe("exécution par la file", () => {
  test("envoi validé : exécuté par la tâche, au nom de la personne ; panne puis relance", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await avecActeur(AGENT, () =>
      service.proposer({ type: "ESSAI_ENVOI", titre: "Relancer le client", contenu: { dossierId, texte: "Bonjour" } })
    );
    echecsEnvoi = 99;
    const validee = await avecActeur(LUCAS, () => service.validerProposition(id, { texte: "Bonjour Madame" }));
    assert.equal(validee.statut, "VALIDEE");

    const cle = `proposition:${id}`;
    for (let essai = 0; essai < 5; essai++) {
      await prisma.tache.update({ where: { cle }, data: { prochainEssaiLe: new Date(Date.now() - 1000) } });
      await executeur.executerTour();
    }
    let enBase = await prisma.proposition.findUniqueOrThrow({ where: { id } });
    assert.equal(enBase.statut, "ECHEC");
    assert.match(enBase.erreurExecution ?? "", /injoignable/);
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { cle } })).statut, "ECHEC_DEFINITIF");

    echecsEnvoi = 0;
    await avecActeur(LUCAS, () => service.reessayerExecution(id));
    await executeur.executerTour();
    enBase = await prisma.proposition.findUniqueOrThrow({ where: { id } });
    assert.equal(enBase.statut, "EXECUTEE");
    assert.deepEqual(envois, ["Bonjour Madame"]);

    const evenement = await prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "MAIL_ENVOYE" } });
    const [ligne] = await prisma.$queryRawUnsafe<{ acteur: string; origine: string }[]>(
      `SELECT acteur, origine FROM "JournalModification" WHERE "enregistrementId" = ?`,
      evenement.id
    );
    assert.equal(ligne.acteur, LUCAS.acteur);
    assert.equal(ligne.origine, "tache:EXECUTION_PROPOSITION");

    // Rejouer la tâche ne renvoie rien.
    await prisma.tache.update({ where: { cle }, data: { statut: "EN_ATTENTE", prochainEssaiLe: new Date(Date.now() - 1000) } });
    await executeur.executerTour();
    assert.deepEqual(envois, ["Bonjour Madame"]);
  });
});

describe("expiration", () => {
  test("une proposition échue expire", async () => {
    const { id: dossierId } = await dossier();
    const { id } = await avecActeur(AGENT, () =>
      service.proposer({
        type: "NOTE_DOSSIER",
        titre: "Note",
        contenu: { dossierId, texte: "À noter" },
        expireLe: new Date(Date.now() - 60_000),
      })
    );
    assert.ok((await service.expirerPropositions()) >= 1);
    assert.equal((await prisma.proposition.findUniqueOrThrow({ where: { id } })).statut, "EXPIREE");
  });
});
