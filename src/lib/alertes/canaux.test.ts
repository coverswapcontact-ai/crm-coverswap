import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

// Le push web lit ses abonnements en base : une base d'essai, jamais celle du poste.
preparerBaseEssai();

/**
 * Le défaut du 20/09/2026 : un canal non configuré disparaissait du compte
 * rendu. La réponse du webhook disait « mail : ok » et rien d'autre, ce qui se
 * lisait comme « tout va bien » alors que le téléphone n'avait jamais sonné.
 * Ces essais figent la règle : une ligne par canal, toujours.
 */
let canaux: typeof import("./canaux");
let recues: { titre: string | null; corps: string; priorite: string | null; actions: string | null }[] = [];
let serveur: Server;

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      let corps = "";
      requete.on("data", (m) => (corps += m));
      requete.on("end", () => {
        if (requete.url?.includes("refuse")) {
          reponse.writeHead(403);
          reponse.end("topic interdit");
          return;
        }
        recues.push({
          titre: (requete.headers.title as string) ?? null,
          corps,
          priorite: (requete.headers.priority as string) ?? null,
          actions: (requete.headers.actions as string) ?? null,
        });
        reponse.writeHead(200);
        reponse.end("{}");
      });
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  process.env.NTFY_SERVEUR = `http://127.0.0.1:${port}`;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.RESEND_API_KEY;
  delete process.env.NTFY_TOPIC;
  canaux = await import("./canaux");
});
after(async () => {
  await new Promise<void>((r) => serveur.close(() => r()));
});

describe("état des canaux", () => {
  test("un canal absent nomme les variables à poser", () => {
    assert.deepEqual(canaux.variablesManquantes("telegram"), ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
    assert.equal(canaux.canalConfigure("ntfy"), false);
    assert.equal(canaux.pushDisponible(), false);
  });

  test("le mail seul ne compte pas comme notification poussée", () => {
    process.env.RESEND_API_KEY = "re_essai";
    assert.deepEqual(canaux.canauxConfigures(), ["mail"]);
    // C'est exactement l'état de la production le 20/09 : un canal actif, zéro push.
    assert.equal(canaux.pushDisponible(), false);
    process.env.NTFY_TOPIC = "essai-coverswap";
    assert.equal(canaux.pushDisponible(), true);
    delete process.env.NTFY_TOPIC;
  });
});

describe("compte rendu d'un envoi", () => {
  test("tous les canaux sont rendus, configurés ou non", async () => {
    delete process.env.RESEND_API_KEY;
    const resultats = await canaux.alerter({ titre: "Essai", texte: "corps" });
    assert.deepEqual(
      resultats.map((r) => r.canal),
      ["telegram", "ntfy", "pushweb", "mail"]
    );
    assert.equal(
      resultats.every((r) => !r.ok && !r.configure),
      true
    );
    // Le détail dit quoi poser, pas seulement « échec ».
    assert.match(resultats[1].detail ?? "", /NTFY_TOPIC absente/);
    assert.match(resultats[2].detail ?? "", /aucun appareil abonné/);
  });

  test("un canal qui marche est distingué d'un canal absent", async () => {
    process.env.NTFY_TOPIC = "essai-coverswap";
    recues = [];
    const resultats = await canaux.alerter({
      titre: "Nouveau lead Meta — Camille (Ablis)",
      texte: "Projet : Cuisine",
      telephone: "+33612345678",
      lien: "https://crm.coverswap.fr/prospects/abc",
      urgence: 5,
    });
    const ntfy = resultats.find((r) => r.canal === "ntfy")!;
    assert.deepEqual([ntfy.ok, ntfy.configure], [true, true]);
    const telegram = resultats.find((r) => r.canal === "telegram")!;
    assert.deepEqual([telegram.ok, telegram.configure], [false, false]);

    // Le message est bien parti, avec ses boutons et sa priorité.
    assert.equal(recues.length, 1);
    assert.equal(recues[0].titre, "Nouveau lead Meta - Camille (Ablis)");
    assert.equal(recues[0].priorite, "5");
    assert.match(recues[0].actions ?? "", /tel:\+33612345678/);
    delete process.env.NTFY_TOPIC;
  });

  test("un libellé de bouton accentué part en ASCII : ntfy refuse tout en-tête non ASCII (HTTP 400)", async () => {
    process.env.NTFY_TOPIC = "essai-coverswap";
    recues = [];
    await canaux.alerter({ titre: "Essai", texte: "corps", lien: "https://crm.coverswap.fr/publicite", libelleLien: "Ouvrir l'écran Publicité ; vite, svp" });
    assert.equal(recues[0].actions, "view, Ouvrir l'ecran Publicite vite svp, https://crm.coverswap.fr/publicite");
    delete process.env.NTFY_TOPIC;
  });

  test("un canal configuré mais refusé est un échec, pas une absence", async () => {
    process.env.NTFY_TOPIC = "refuse";
    const resultats = await canaux.alerter({ titre: "Essai", texte: "corps" });
    const ntfy = resultats.find((r) => r.canal === "ntfy")!;
    assert.deepEqual([ntfy.ok, ntfy.configure], [false, true]);
    assert.match(ntfy.detail ?? "", /HTTP 403/);
    delete process.env.NTFY_TOPIC;
  });
});
