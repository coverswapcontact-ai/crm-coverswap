import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { envoyerParRelais, relaisNtfyDisponible } from "./relais-ntfy";

/**
 * La passerelle du site vérifie une signature HMAC du corps horodaté. Ce faux
 * site applique la même règle que coverswap/src/app/api/relais/ntfy/route.ts :
 * si les deux divergent, l'essai de bout en bout en production le dira, mais
 * celui-ci fige le contrat côté CRM.
 */
const SECRET_DU_SITE = "secret-partage-essai";
let serveur: Server;
let recues: { corps: string }[] = [];

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      let corps = "";
      requete.on("data", (m) => (corps += m));
      requete.on("end", () => {
        const horodatage = String(requete.headers["x-relais-horodatage"] ?? "");
        const signatures = String(requete.headers["x-relais-signature"] ?? "").split(",");
        const attendue = createHmac("sha256", SECRET_DU_SITE).update(`${horodatage}.${corps}`, "utf8").digest("hex");
        if (!signatures.includes(attendue) || Math.abs(Date.now() - Number(horodatage)) > 300_000) {
          reponse.writeHead(401, { "Content-Type": "application/json" });
          reponse.end(JSON.stringify({ erreur: "Non autorisé." }));
          return;
        }
        recues.push({ corps });
        reponse.writeHead(200, { "Content-Type": "application/json" });
        reponse.end(JSON.stringify({ ok: true, status: 200 }));
      });
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  process.env.NTFY_RELAIS_URL = `http://127.0.0.1:${port}`;
});
after(async () => {
  await new Promise<void>((r) => serveur.close(() => r()));
});

const DEMANDE = { sujet: "essai-coverswap", titre: "Nouveau lead Meta - Camille", priorite: "4", tags: "bell", actions: "view, Appeler, tel:+33612345678", texte: "Projet : Cuisine · Pérols" };

describe("passerelle ntfy par le site", () => {
  test("disponible seulement pour ntfy.sh, avec un secret partagé, et tant qu'on ne la coupe pas", () => {
    assert.equal(relaisNtfyDisponible({ SIMULATE_TOKEN_SECRET: "x" } as NodeJS.ProcessEnv), true);
    assert.equal(relaisNtfyDisponible({ WEBHOOK_SECRET: "x" } as NodeJS.ProcessEnv), true);
    assert.equal(relaisNtfyDisponible({} as NodeJS.ProcessEnv), false, "sans secret partagé, pas de signature possible");
    assert.equal(relaisNtfyDisponible({ SIMULATE_TOKEN_SECRET: "x", NTFY_RELAIS: "0" } as NodeJS.ProcessEnv), false);
    assert.equal(relaisNtfyDisponible({ SIMULATE_TOKEN_SECRET: "x", NTFY_SERVEUR: "https://ntfy.exemple.fr" } as NodeJS.ProcessEnv), false);
  });

  test("le site accepte l'envoi signé du secret qu'il partage, même si le CRM en connaît d'autres", async () => {
    process.env.SIMULATE_TOKEN_SECRET = "un-autre-secret";
    process.env.WEBHOOK_SECRET = SECRET_DU_SITE;
    recues = [];
    await envoyerParRelais(DEMANDE);
    assert.equal(recues.length, 1);
    assert.deepEqual(JSON.parse(recues[0].corps), DEMANDE);
  });

  test("sans secret commun, le refus du site remonte en clair", async () => {
    process.env.SIMULATE_TOKEN_SECRET = "inconnu-du-site";
    process.env.WEBHOOK_SECRET = "inconnu-aussi";
    delete process.env.WEBHOOK_SECRET_PRECEDENT;
    await assert.rejects(envoyerParRelais(DEMANDE), /passerelle : HTTP 401/);
  });
});
