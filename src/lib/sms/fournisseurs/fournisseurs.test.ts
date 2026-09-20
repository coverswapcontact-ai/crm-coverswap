import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";

/**
 * Les fournisseurs réels ne sont pas joignables depuis les essais (pas de
 * compte, pas de crédit) : un faux serveur applique les règles documentées
 * d'OVH (signature « $1$ » + SHA-1, en-têtes X-Ovh-*) et de Brevo (clé d'API),
 * et répond avec les formes de réponse de leurs API.
 */
let serveur: Server;
let base: string;
const recus: { methode: string; chemin: string; corps: string; entetes: Record<string, string | string[] | undefined> }[] = [];

const SECRET = "secret-application";
const CONSOMMATEUR = "cle-consommateur";

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      let corps = "";
      requete.on("data", (m) => (corps += m));
      requete.on("end", () => {
        const chemin = requete.url ?? "";
        recus.push({ methode: requete.method ?? "", chemin, corps, entetes: requete.headers });
        const json = (statut: number, valeur: unknown) => {
          reponse.writeHead(statut, { "Content-Type": "application/json" });
          reponse.end(JSON.stringify(valeur));
        };
        if (chemin === "/1.0/auth/time") return json(200, Math.floor(Date.now() / 1000) + 42);

        if (chemin.startsWith("/1.0/")) {
          // Vérification de la signature, comme le fait OVH.
          const temps = String(requete.headers["x-ovh-timestamp"]);
          const attendue = `$1$${createHash("sha1").update([SECRET, CONSOMMATEUR, requete.method, `${base.replace(/\/1\.0$/, "")}${chemin}`, corps, temps].join("+")).digest("hex")}`;
          if (requete.headers["x-ovh-signature"] !== attendue) return json(403, { message: "Invalid signature" });
          if (requete.method === "POST" && chemin.endsWith("/jobs")) {
            const demande = JSON.parse(corps) as { receivers: string[] };
            if (demande.receivers[0] === "+33600000000") return json(200, { ids: [], invalidReceivers: demande.receivers, validReceivers: [], totalCreditsRemoved: 0 });
            return json(200, { ids: [987654], invalidReceivers: [], validReceivers: demande.receivers, totalCreditsRemoved: 2 });
          }
          if (chemin.includes("/incoming?")) return json(200, [11, 12]);
          if (chemin.endsWith("/incoming/11")) return json(200, { id: 11, sender: "+33612345678", message: "Second message", creationDatetime: "2026-09-21T10:05:00+02:00" });
          if (chemin.endsWith("/incoming/12")) return json(200, { id: 12, sender: "+33612345678", message: "Premier message", creationDatetime: "2026-09-21T10:01:00+02:00" });
          if (chemin.endsWith("/outgoing/987654")) return json(200, { id: 987654, deliveryReceipt: 1, deliveredAt: "2026-09-21T10:00:05+02:00", ptt: 1 });
          if (chemin.endsWith("/outgoing/555")) return json(200, { id: 555, deliveryReceipt: 16, ptt: 16 });
          return json(404, { message: "Not found" });
        }

        if (chemin === "/v3/transactionalSMS/send") {
          if (requete.headers["api-key"] !== "cle-brevo") return json(401, { code: "unauthorized", message: "Key not found" });
          return json(201, { messageId: 1511882900100020, smsCount: 1, usedCredits: 4.5 });
        }
        json(404, {});
      });
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  base = `http://127.0.0.1:${port}/1.0`;
  Object.assign(process.env, {
    OVH_API_URL: base,
    OVH_APPLICATION_KEY: "cle-application",
    OVH_APPLICATION_SECRET: SECRET,
    OVH_CONSUMER_KEY: CONSOMMATEUR,
    OVH_SMS_SERVICE: "sms-ab12345-1",
    OVH_SMS_NUMERO: "0937000001",
    BREVO_API_URL: `http://127.0.0.1:${port}/v3`,
  });
});
after(async () => {
  await new Promise<void>((r) => serveur.close(() => r()));
});

describe("OVH — numéro Time2Chat", () => {
  test("l'envoi est signé comme OVH l'exige, avec l'horloge d'OVH", async () => {
    const { fournisseurOvh } = await import("./ovh");
    const accuse = await fournisseurOvh.envoyer({ numero: "+33612345678", texte: "Bonjour, Lucas de CoverSwap.", reference: "cmsmsessai0001" });
    assert.deepEqual(accuse, { identifiant: "987654", credits: 2 });
    const envoi = recus.find((r) => r.methode === "POST" && r.chemin.endsWith("/jobs"))!;
    assert.equal(envoi.chemin, "/1.0/sms/sms-ab12345-1/virtualNumbers/0937000001/jobs");
    assert.deepEqual(JSON.parse(envoi.corps).receivers, ["+33612345678"]);
    // L'horodatage suit l'horloge d'OVH (+42 s dans ce faux serveur), pas la nôtre.
    assert.ok(Math.abs(Number(envoi.entetes["x-ovh-timestamp"]) - (Math.floor(Date.now() / 1000) + 42)) <= 2);
  });

  test("un destinataire refusé par OVH est un échec définitif, pas un réessai", async () => {
    const { fournisseurOvh } = await import("./ovh");
    const { EchecDefinitifSms } = await import("./types");
    await assert.rejects(fournisseurOvh.envoyer({ numero: "+33600000000", texte: "x", reference: "r" }), EchecDefinitifSms);
  });

  test("la relève rend les réponses dans l'ordre où elles ont été écrites", async () => {
    const { fournisseurOvh } = await import("./ovh");
    const entrants = await fournisseurOvh.releverEntrants!(new Date("2026-09-21T00:00:00Z"));
    assert.deepEqual(
      entrants.map((e) => [e.identifiant, e.texte]),
      [
        ["12", "Premier message"],
        ["11", "Second message"],
      ]
    );
    assert.match(recus.find((r) => r.chemin.includes("/incoming?"))!.chemin, /creationDatetime\.from=2026-09-21T00%3A00%3A00\.000Z/);
  });

  test("remise : délivré, non remis, ou pas encore dans l'historique", async () => {
    const { fournisseurOvh } = await import("./ovh");
    assert.equal((await fournisseurOvh.etat!("987654"))?.statut, "DELIVRE");
    assert.equal((await fournisseurOvh.etat!("555"))?.statut, "ECHEC");
    assert.equal(await fournisseurOvh.etat!("404404"), null);
  });
});

describe("Brevo — envoi seul", () => {
  test("envoi accepté ; clé refusée = échec définitif", async () => {
    const { fournisseurBrevo } = await import("./brevo");
    const { EchecDefinitifSms } = await import("./types");
    process.env.BREVO_API_KEY = "cle-brevo";
    assert.deepEqual(await fournisseurBrevo.envoyer({ numero: "+33612345678", texte: "Bonjour", reference: "r1" }), { identifiant: "1511882900100020", segments: 1, credits: 4.5 });
    const envoi = recus.find((r) => r.chemin === "/v3/transactionalSMS/send")!;
    assert.deepEqual([JSON.parse(envoi.corps).recipient, JSON.parse(envoi.corps).sender], ["33612345678", "CoverSwap"]);
    assert.equal(fournisseurBrevo.bidirectionnel, false, "en France, on ne répond pas à un SMS Brevo");

    process.env.BREVO_API_KEY = "mauvaise";
    await assert.rejects(fournisseurBrevo.envoyer({ numero: "+33612345678", texte: "Bonjour", reference: "r2" }), EchecDefinitifSms);
  });
});

describe("choix du fournisseur", () => {
  test("OVH complet l'emporte (seul à recevoir), puis Brevo, sinon rien — jamais le simulateur tout seul", async () => {
    const { fournisseurSms, etatFournisseur } = await import("./index");
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    const ovh = { OVH_APPLICATION_KEY: "a", OVH_APPLICATION_SECRET: "b", OVH_CONSUMER_KEY: "c", OVH_SMS_SERVICE: "d", OVH_SMS_NUMERO: "e" };
    assert.equal(fournisseurSms(env({ ...ovh, BREVO_API_KEY: "k" }))?.nom, "ovh");
    assert.equal(fournisseurSms(env({ BREVO_API_KEY: "k" }))?.nom, "brevo");
    assert.equal(fournisseurSms(env({})), null);
    assert.equal(fournisseurSms(env({ SMS_FOURNISSEUR: "simulateur" }))?.nom, "simulateur");
    const etat = etatFournisseur(env({ BREVO_API_KEY: "k" }));
    assert.equal(etat.bidirectionnel, false);
    assert.match(etat.remarque ?? "", /ne reçoit pas/);
    assert.deepEqual(etatFournisseur(env({})).aPoser, Object.keys(ovh));
  });
});
