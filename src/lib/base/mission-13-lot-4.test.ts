import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 13 (26/09/2026), lot 4 — raccourcis d'action : les rubriques du
 * panneau qu'un lien peut ouvrir, les notifications de l'espace qui y mènent,
 * les messages de l'espace client dans la boîte « À traiter » de Mail.
 */

let prisma: typeof import("@/lib/prisma").default;
let constants: typeof import("@/lib/dossiers/constants");
let alertes: typeof import("@/lib/espace/alertes");
let messages: typeof import("@/lib/espace/messages");
let vues: typeof import("@/lib/mail/vues");

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.coverswap.fr";
  constants = await import("@/lib/dossiers/constants");
  alertes = await import("@/lib/espace/alertes");
  messages = await import("@/lib/espace/messages");
  vues = await import("@/lib/mail/vues");
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  await prisma.$disconnect();
});

describe("rubriques du panneau", () => {
  test("une adresse ?rubrique= n'est lue que pour une rubrique connue ; le lien d'une notification la porte", () => {
    assert.deepEqual([...constants.RUBRIQUES_DOSSIER], ["photos", "messages", "devis", "encaisser", "historique", "etape"]);
    assert.equal(constants.estRubriqueDossier("messages"), true);
    assert.equal(constants.estRubriqueDossier("archives"), false);
    assert.equal(constants.estRubriqueDossier(null), false);
    assert.equal(alertes.lienDossier("abc"), "https://crm.coverswap.fr/dossiers?dossier=abc");
    assert.equal(alertes.lienDossier("abc", "messages"), "https://crm.coverswap.fr/dossiers?dossier=abc&rubrique=messages");
    assert.equal(alertes.lienDossier("abc", null), "https://crm.coverswap.fr/dossiers?dossier=abc");
  });
});

describe("Mail : une seule boîte « à traiter »", () => {
  test("un message écrit par le client dans son espace apparaît dans « À traiter », lu il en sort ; la recherche le filtre", async () => {
    const dossier = await prisma.dossier.create({ data: { clientNom: "Nadia Message", clientAdresse: "1 rue", clientCp: "34000", clientVille: "Montpellier", clientTelephone: "0600000030", objet: "Cuisine", source: "ENTRANT", etape: "SIMULATION" } });
    const id = await messages.enregistrerMessageClient({ dossierId: dossier.id, source: "MESSAGE", texte: "Bonjour, pouvez-vous passer mardi ?" });
    assert.ok(id);
    let liste = await vues.listerVue("A_TRAITER");
    const trouve = liste.messagesEspace.find((m) => m.id === id);
    assert.ok(trouve, "le message est dans la boîte");
    assert.deepEqual([trouve.clientNom, trouve.auteur, trouve.source, trouve.luLe], ["Nadia Message", "CLIENT", "MESSAGE", null]);
    assert.equal((await vues.listerVue("A_TRAITER", { recherche: "mardi" })).messagesEspace.length, 1);
    assert.equal((await vues.listerVue("A_TRAITER", { recherche: "zzz-introuvable" })).messagesEspace.length, 0);
    assert.equal((await vues.listerVue("CLIENTS")).messagesEspace.length, 0, "seule la vue « À traiter » les porte");
    assert.equal(await messages.compterMessagesNonLus(), 1);
    await messages.marquerMessagesLus(dossier.id);
    liste = await vues.listerVue("A_TRAITER");
    assert.equal(liste.messagesEspace.some((m) => m.id === id), false, "lu : il sort de la boîte");
    assert.equal(await messages.compterMessagesNonLus(), 0);
  });
});
