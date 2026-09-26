import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";

/**
 * Renvoi des conversions, vérifié contre un simulateur fidèle de l'API Conversions :
 * un serveur local qui reçoit ce que Meta recevrait, et dont on relit la charge
 * exacte. Ce que Meta exige est vérifié champ par champ.
 */
let serveur: Server;
let recues: { corps: Record<string, unknown>; chemin: string }[] = [];
let conversions: typeof import("./conversions");

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      let corps = "";
      requete.on("data", (morceau) => (corps += morceau));
      requete.on("end", () => {
        const lu = JSON.parse(corps) as Record<string, unknown>;
        recues.push({ chemin: requete.url ?? "", corps: lu });
        // Un jeton mort : la réponse exacte de Meta (HTTP 400, code 190, sous-code 467), telle que vue en production le 26/09/2026.
        if (lu.access_token === "jeton-mort") {
          reponse.writeHead(400, { "Content-Type": "application/json" });
          reponse.end(JSON.stringify({ error: { message: "Error validating access token: The session is invalid because the user logged out.", type: "OAuthException", code: 190, error_subcode: 467, fbtrace_id: "essai" } }));
          return;
        }
        reponse.writeHead(200, { "Content-Type": "application/json" });
        reponse.end(JSON.stringify({ events_received: 1, messages: [], fbtrace_id: "essai" }));
      });
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  process.env.META_GRAPH_URL = `http://127.0.0.1:${port}`;
  process.env.META_PIXEL_ID = "1234567890";
  process.env.META_CONVERSIONS_TOKEN = "jeton-essai";
  conversions = await import("./conversions");
});
after(() => new Promise<void>((r) => serveur.close(() => r())));

describe("conversions envoyées à Meta", () => {
  test("un devis signé part avec le lead d'origine, les données hachées et son montant", async () => {
    recues = [];
    const survenuLe = new Date("2026-09-20T09:30:00Z");
    const resultat = await conversions.envoyerConversion({
      etape: "SIGNE",
      leadgenId: "123456789012345",
      email: "Camille.Martin@Example.COM",
      telephone: "06 12 34 56 78",
      prenom: "Camille",
      nom: "Martin",
      ville: "Pérols",
      codePostal: "34470",
      valeur: 2480.5,
      evenementId: "dossier-abc-SIGNE",
      survenuLe,
    });

    assert.equal(resultat.ok, true);
    assert.equal(resultat.recus, 1);
    assert.equal(recues.length, 1);
    assert.match(recues[0].chemin, /^\/v[\d.]+\/1234567890\/events$/);

    const charge = recues[0].corps as { data: Record<string, unknown>[]; access_token: string };
    assert.equal(charge.access_token, "jeton-essai");
    const evenement = charge.data[0] as Record<string, unknown>;
    assert.equal(evenement.event_name, "Converted Lead");
    assert.equal(evenement.action_source, "system_generated");
    assert.equal(evenement.event_id, "dossier-abc-SIGNE");
    assert.equal(evenement.event_time, Math.floor(survenuLe.getTime() / 1000));
    assert.deepEqual(evenement.custom_data, { lead_event_source: "CoverSwap CRM", event_source: "crm", value: 2480.5, currency: "EUR" });

    const utilisateur = evenement.user_data as Record<string, unknown>;
    // lead_id : nombre, jamais haché — c'est le rattachement au lead d'origine.
    assert.equal(utilisateur.lead_id, 123456789012345);
    // Le reste est haché après la normalisation imposée par Meta.
    assert.deepEqual(utilisateur.em, [sha256("camille.martin@example.com")]);
    assert.deepEqual(utilisateur.ph, [sha256("33612345678")]);
    assert.deepEqual(utilisateur.fn, [sha256("camille")]);
    assert.deepEqual(utilisateur.ln, [sha256("martin")]);
    assert.deepEqual(utilisateur.ct, [sha256("perols")]);
    assert.deepEqual(utilisateur.zp, [sha256("34470")]);
    assert.deepEqual(utilisateur.country, [sha256("fr")]);
    // Aucune donnée personnelle en clair dans la charge.
    const texte = JSON.stringify(charge);
    for (const clair of ["Camille", "Martin", "@example", "0612345678", "612345678", "Pérols"]) {
      assert.equal(texte.includes(clair), false, `« ${clair} » ne doit pas partir en clair`);
    }
  });

  test("sans leadgen_id, on retombe sur l'e-mail et le téléphone hachés", async () => {
    recues = [];
    const resultat = await conversions.envoyerConversion({ etape: "DEVIS_ENVOYE", email: "jean@example.com", telephone: "+33499887766", evenementId: "dossier-def-DEVIS_ENVOYE" });
    assert.equal(resultat.trace.rattachement, "contact");
    const utilisateur = (recues[0].corps as { data: Record<string, unknown>[] }).data[0].user_data as Record<string, unknown>;
    assert.equal(utilisateur.lead_id, undefined);
    assert.deepEqual(utilisateur.em, [sha256("jean@example.com")]);
  });

  test("un lead perdu repart aussi : c'est le signal négatif", async () => {
    recues = [];
    await conversions.envoyerConversion({ etape: "PERDU", leadgenId: "123456789012345", evenementId: "dossier-ghi-PERDU" });
    const evenement = (recues[0].corps as { data: Record<string, unknown>[] }).data[0];
    assert.equal(evenement.event_name, "Disqualified Lead");
    // Pas de montant sur un lead perdu.
    assert.equal((evenement.custom_data as Record<string, unknown>).value, undefined);
  });

  test("mission 13 : un jeton refusé (code 190) est dit en clair, nommé comme tel, et ne se réessaie pas", async () => {
    recues = [];
    process.env.META_CONVERSIONS_TOKEN = "jeton-mort";
    try {
      const resultat = await conversions.envoyerConversion({ etape: "SIGNE", leadgenId: "123456789012345", valeur: 500, evenementId: "dossier-mno-SIGNE" });
      assert.deepEqual([resultat.ok, resultat.jetonRefuse, resultat.codeMeta], [false, true, 190]);
      assert.match(resultat.detail ?? "", /^Jeton Meta refusé par Meta \(code 190\/467 : Error validating access token: The session is invalid because the user logged out\.\)\. À renouveler sur Railway/);
      assert.equal(recues.length, 1, "un seul appel : pas de réessai");
    } finally {
      process.env.META_CONVERSIONS_TOKEN = "jeton-essai";
    }
  });

  test("le code d'essai accompagne l'événement quand il est posé", async () => {
    recues = [];
    process.env.META_TEST_EVENT_CODE = "TEST12345";
    await conversions.envoyerConversion({ etape: "ENCAISSE", leadgenId: "123456789012345", valeur: 3100, evenementId: "dossier-jkl-ENCAISSE" });
    assert.equal((recues[0].corps as { test_event_code?: string }).test_event_code, "TEST12345");
    assert.equal((recues[0].corps as { data: Record<string, unknown>[] }).data[0].event_name, "Purchase");
    delete process.env.META_TEST_EVENT_CODE;
  });
});
