import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 15 (30/09/2026), correctif après la partie 2 — en production, une `ApiGoogleNonActivee` (une attente) a été
 * classée en échec définitif par l'exécuteur : le bundle de Next portait deux copies du module des erreurs et
 * `instanceof` échouait entre elles. L'attente et l'échec définitif se reconnaissent désormais par un marqueur qui
 * voyage avec l'objet, et les tâches retombées en échec pour cette raison sont remises en attente.
 */

let prisma: typeof import("@/lib/prisma").default;
let registre: typeof import("@/lib/taches/registre");
let migration: typeof import("@/lib/base/migrations/mission-15-partie-2b");
let google: typeof import("@/lib/google/connexion");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  registre = await import("@/lib/taches/registre");
  migration = await import("@/lib/base/migrations/mission-15-partie-2b");
  google = await import("@/lib/google/connexion");
});

after(async () => {
  await prisma.$disconnect();
});

describe("erreurs de tâche : reconnaissance par marqueur, pas seulement par classe", () => {
  test("une attente venue d'une autre copie du module (même forme, autre classe) est reconnue ; une erreur ordinaire non", () => {
    class AttenteDUnAutreBundle extends Error {
      readonly attenteExterne = true as const;
      readonly reprendreDansMs = 6 * 3_600_000;
    }
    assert.equal(registre.estAttenteExterne(new AttenteDUnAutreBundle("Google : API non activée")), true);
    assert.equal(registre.estAttenteExterne(new registre.AttenteExterne("x")), true);
    assert.equal(registre.estAttenteExterne(new google.ApiGoogleNonActivee("Google Calendar", null)), true, "la sous-classe garde le marqueur");
    assert.equal(registre.estAttenteExterne(new Error("attenteExterne")), false);
    assert.equal(registre.estAttenteExterne({ attenteExterne: true }), false, "sans délai de reprise, ce n'est pas une attente");
    assert.equal(registre.estAttenteExterne(null), false);
  });

  test("un échec définitif se reconnaît de même", () => {
    class DefinitiveDUnAutreBundle extends Error {
      readonly erreurDefinitive = true as const;
    }
    assert.equal(registre.estErreurDefinitive(new DefinitiveDUnAutreBundle("x")), true);
    assert.equal(registre.estErreurDefinitive(new registre.ErreurDefinitive("x")), true);
    assert.equal(registre.estErreurDefinitive(new registre.AttenteExterne("x")), false);
    assert.equal(registre.estErreurDefinitive(new Error("x")), false);
  });
});

describe("migration agenda-rappels-en-attente-15-2b", () => {
  test("les tâches d'agenda retombées en échec « accessNotConfigured » repartent en attente ; rejouable ; Paramètres voit l'API manquante même depuis un échec", async () => {
    const tombee = await prisma.tache.create({
      data: { type: "AGENDA_RAPPEL", cle: "agenda-rappel:LEAD:essai-2b", charge: JSON.stringify({ type: "LEAD", id: "essai-2b" }), demandeePar: "SYSTEME:agenda", statut: "ECHEC_DEFINITIF", tentatives: 2, termineLe: new Date(), derniereErreur: "ApiGoogleNonActivee: Google : API Google Calendar non activée dans le projet Google Cloud (accessNotConfigured) : à activer. Réponse de Google : Google Calendar API has not been used in project 1" },
    });
    const autre = await prisma.tache.create({
      data: { type: "AGENDA_RAPPEL", cle: "agenda-rappel:LEAD:essai-2b-autre", charge: "{}", demandeePar: "SYSTEME:agenda", statut: "ECHEC_DEFINITIF", tentatives: 8, termineLe: new Date(), derniereErreur: "Error: Google Agenda n'a pas posé l'événement." },
    });
    const etatAvant = await google.etatConnexionGoogle();
    assert.equal(etatAvant.agendaApiActivee, false, "une tâche en échec pour cette raison suffit à dire que l'API manque");

    const premiere = await migration.migrationAgendaRappelsEnAttente15.executer(prisma);
    assert.equal(premiere.remisesEnAttente, 1);
    const remise = await prisma.tache.findUniqueOrThrow({ where: { id: tombee.id } });
    assert.equal(remise.statut, "EN_ATTENTE");
    assert.equal(remise.tentatives, 2, "les essais ne sont pas comptés");
    assert.ok(remise.prochainEssaiLe && remise.prochainEssaiLe.getTime() > Date.now() + 5 * 3_600_000, "nouvel essai dans 6 h");
    assert.match(remise.derniereErreur ?? "", /^\[en attente\] Google : API Google Calendar non activée/);
    assert.equal((await prisma.tache.findUniqueOrThrow({ where: { id: autre.id } })).statut, "ECHEC_DEFINITIF", "un autre échec n'est pas touché");

    const seconde = await migration.migrationAgendaRappelsEnAttente15.executer(prisma);
    assert.equal(seconde.remisesEnAttente, 0, "rejouée : rien à refaire");
    assert.equal((await google.etatConnexionGoogle()).agendaApiActivee, false);
  });
});
