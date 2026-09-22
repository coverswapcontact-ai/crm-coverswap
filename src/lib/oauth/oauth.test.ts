import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

/**
 * Mission 8 : le serveur OAuth 2.1 du CRM sur une copie de base — découverte,
 * enregistrement, PKCE, code à usage unique, rotation des jetons de
 * renouvellement, révocation. Aucun jeton n'est stocké en clair.
 */
preparerBaseEssai();
process.env.NEXT_PUBLIC_APP_URL = "https://crm.exemple.fr";

let prisma: typeof import("@/lib/prisma").default;
let oauth: typeof import("./serveur");
let limite: typeof import("./limite");

const RETOUR = "https://claude.ai/api/mcp/auth_callback";
const verifier = () => randomBytes(32).toString("base64url");
const challenge = (v: string) => createHash("sha256").update(v).digest("base64url");
const form = (champs: Record<string, string>) => new URLSearchParams(champs);

async function flux(client: { client_id: string }, options: { verifier?: string; state?: string } = {}) {
  const v = options.verifier ?? verifier();
  const demande = await oauth.demandeAutorisation({ client_id: client.client_id, redirect_uri: RETOUR, response_type: "code", code_challenge: challenge(v), code_challenge_method: "S256", state: options.state ?? "etat-1", scope: "crm", resource: "https://crm.exemple.fr/api/mcp" });
  const retour = new URL(await oauth.accorder(demande, "lucas@exemple.fr"));
  return { verifier: v, code: retour.searchParams.get("code")!, retour };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  oauth = await import("./serveur");
  limite = await import("./limite");
  await (await import("@/lib/base/preparation")).preparerBase();
});

after(async () => {
  await prisma.$disconnect();
});

describe("découverte", () => {
  test("les documents de découverte pointent vers le CRM, PKCE S256 seulement, portée « crm »", () => {
    const s = oauth.metadonneesServeur();
    assert.equal(s.issuer, "https://crm.exemple.fr");
    assert.equal(s.authorization_endpoint, "https://crm.exemple.fr/oauth/autoriser");
    assert.equal(s.token_endpoint, "https://crm.exemple.fr/api/oauth/token");
    assert.equal(s.registration_endpoint, "https://crm.exemple.fr/api/oauth/register");
    assert.deepEqual(s.code_challenge_methods_supported, ["S256"]);
    assert.equal(s.client_id_metadata_document_supported, true);
    const r = oauth.metadonneesRessource();
    assert.equal(r.resource, "https://crm.exemple.fr/api/mcp");
    assert.deepEqual(r.authorization_servers, ["https://crm.exemple.fr"]);
    assert.equal(oauth.adresseMetadonneesRessource(), "https://crm.exemple.fr/.well-known/oauth-protected-resource/api/mcp");
  });

  test("adresses de retour : https, ou http vers la machine locale ; jamais de fragment", () => {
    assert.equal(oauth.adresseRetourValide(RETOUR), true);
    assert.equal(oauth.adresseRetourValide("http://localhost:6274/oauth/callback"), true);
    assert.equal(oauth.adresseRetourValide("http://127.0.0.1:3333/cb"), true);
    assert.equal(oauth.adresseRetourValide("http://exemple.fr/cb"), false);
    assert.equal(oauth.adresseRetourValide("https://exemple.fr/cb#frag"), false);
    assert.equal(oauth.adresseRetourValide("pas une adresse"), false);
  });
});

describe("enregistrement des clients", () => {
  test("un client public s'enregistre sans secret ; un client confidentiel reçoit un secret gardé haché", async () => {
    const pub = await oauth.enregistrerClient({ client_name: "Claude", redirect_uris: [RETOUR], token_endpoint_auth_method: "none" });
    assert.match(pub.client_id, /^cs_/);
    assert.equal("client_secret" in pub, false);
    assert.equal(pub.token_endpoint_auth_method, "none");
    const conf = (await oauth.enregistrerClient({ client_name: "Outil", redirect_uris: ["http://localhost:8080/cb"], token_endpoint_auth_method: "client_secret_post" })) as { client_id: string; client_secret?: string };
    assert.ok(conf.client_secret && conf.client_secret.length >= 32);
    const ligne = await prisma.clientOAuth.findUniqueOrThrow({ where: { id: conf.client_id } });
    assert.notEqual(ligne.secretHash, conf.client_secret);
    assert.equal(ligne.secretHash, createHash("sha256").update(conf.client_secret!).digest("hex"));
  });

  test("adresses de retour refusées, méthode inconnue refusée", async () => {
    await assert.rejects(oauth.enregistrerClient({ redirect_uris: ["http://exemple.fr/cb"] }), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_redirect_uri");
    await assert.rejects(oauth.enregistrerClient({ redirect_uris: [] }), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_redirect_uri");
    await assert.rejects(oauth.enregistrerClient({ redirect_uris: [RETOUR], token_endpoint_auth_method: "private_key_jwt" }), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_client_metadata");
  });

  test("un document d'identité (client_id = adresse https) est lu, vérifié et gardé", async () => {
    const ancien = globalThis.fetch;
    const adresse = "https://claude.ai/.well-known/oauth-client-metadata.json";
    globalThis.fetch = (async (entree: string | URL | Request) => {
      const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
      if (url === adresse) return new Response(JSON.stringify({ client_id: adresse, client_name: "Claude (document)", redirect_uris: [RETOUR] }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ client_id: "autre" }), { status: 200 });
    }) as typeof fetch;
    try {
      const client = await oauth.chargerClient(adresse);
      assert.deepEqual([client.nom, client.origine, client.redirectUris], ["Claude (document)", "CIMD", [RETOUR]]);
      await assert.rejects(oauth.chargerClient("https://exemple.fr/mauvais.json"), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_client");
      // Gardé : sans réseau, le client connu sert encore.
      globalThis.fetch = (async () => {
        throw new Error("hors ligne");
      }) as typeof fetch;
      assert.equal((await oauth.chargerClient(adresse)).nom, "Claude (document)");
    } finally {
      globalThis.fetch = ancien;
    }
  });
});

describe("autorisation et jetons", () => {
  let client: { client_id: string };

  before(async () => {
    client = await oauth.enregistrerClient({ client_name: "Claude", redirect_uris: [RETOUR] });
  });

  test("la demande est vérifiée champ par champ", async () => {
    const v = verifier();
    const base = { client_id: client.client_id, redirect_uri: RETOUR, response_type: "code", code_challenge: challenge(v), code_challenge_method: "S256" };
    const d = await oauth.demandeAutorisation(base);
    assert.equal(d.client.nom, "Claude");
    assert.equal(d.scope, "crm");
    const attendre = (params: Record<string, string>, code: string) => assert.rejects(oauth.demandeAutorisation(params), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === code, code);
    await attendre({ ...base, redirect_uri: "https://ailleurs.fr/cb" }, "invalid_request");
    await attendre({ ...base, response_type: "token" }, "unsupported_response_type");
    await attendre({ ...base, code_challenge: "court" }, "invalid_request");
    await attendre({ ...base, code_challenge_method: "plain" }, "invalid_request");
    await attendre({ ...base, scope: "admin" }, "invalid_scope");
    await attendre({ ...base, resource: "https://autre.fr/mcp" }, "invalid_target");
    await attendre({ ...base, client_id: "cs_inconnu" }, "invalid_client");
    assert.match(oauth.refuser(d), /error=access_denied/);
  });

  test("code → jetons (PKCE), stockés hachés ; un code ne s'échange qu'une fois et sa réutilisation révoque ce qu'il a produit", async () => {
    const f = await flux(client, { state: "abc" });
    assert.equal(f.retour.searchParams.get("state"), "abc");
    assert.equal(f.retour.searchParams.get("iss"), "https://crm.exemple.fr");
    assert.equal(f.retour.origin + f.retour.pathname, RETOUR);
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: verifier(), redirect_uri: RETOUR }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_grant");
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier, redirect_uri: "https://ailleurs.fr/cb" }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_grant");
    const jetons = await oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier, redirect_uri: RETOUR }), new Headers());
    assert.equal(jetons.token_type, "Bearer");
    assert.equal(jetons.expires_in, 12 * 3600);
    assert.ok(jetons.access_token.length >= 40 && jetons.refresh_token.length >= 40);
    assert.equal(await prisma.jetonOAuth.count({ where: { jetonHash: { in: [jetons.access_token, jetons.refresh_token] } } }), 0, "jamais en clair");
    const verifie = await oauth.verifierJetonAcces(jetons.access_token);
    assert.equal(verifie?.utilisateur, "lucas@exemple.fr");
    assert.equal(verifie?.clientId, client.client_id);
    assert.equal(await oauth.verifierJetonAcces(jetons.access_token, new Date(Date.now() + 13 * 3_600_000)), null, "expiré après 12 h");
    assert.equal(await oauth.verifierJetonAcces("n'importe quoi de long pour passer la taille"), null);
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_grant");
    assert.equal(await oauth.verifierJetonAcces(jetons.access_token), null, "révoqué après réutilisation du code");
  });

  test("un code expiré est refusé", async () => {
    const f = await flux(client);
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier }), new Headers(), new Date(Date.now() + 11 * 60_000)), (e: unknown) => e instanceof oauth.ErreurOAuth && /expiré/.test(e.message));
  });

  test("renouvellement : rotation, l'ancien jeton d'accès tombe, réutiliser l'ancien renouvellement révoque toute la famille", async () => {
    const f = await flux(client);
    const j1 = await oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier }), new Headers());
    const j2 = await oauth.echangerJeton(form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: j1.refresh_token }), new Headers());
    assert.notEqual(j2.access_token, j1.access_token);
    assert.equal(await oauth.verifierJetonAcces(j1.access_token), null, "ancien accès révoqué");
    assert.ok(await oauth.verifierJetonAcces(j2.access_token));
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: j1.refresh_token }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && /déjà utilisé/.test(e.message));
    assert.equal(await oauth.verifierJetonAcces(j2.access_token), null, "toute la famille révoquée");
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: j2.refresh_token }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_grant");
  });

  test("client confidentiel : secret exigé (formulaire ou Basic)", async () => {
    const conf = (await oauth.enregistrerClient({ client_name: "Outil", redirect_uris: [RETOUR], token_endpoint_auth_method: "client_secret_basic" })) as { client_id: string; client_secret: string };
    const f = await flux(conf);
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: conf.client_id, code: f.code, code_verifier: f.verifier }), new Headers()), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_client");
    const basic = new Headers({ Authorization: `Basic ${Buffer.from(`${conf.client_id}:${conf.client_secret}`).toString("base64")}` });
    const jetons = await oauth.echangerJeton(form({ grant_type: "authorization_code", code: f.code, code_verifier: f.verifier }), basic);
    assert.ok(await oauth.verifierJetonAcces(jetons.access_token));
  });

  test("révocation depuis Paramètres : par jeton, par client ; l'écran ne montre jamais un jeton", async () => {
    const f = await flux(client);
    const j = await oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f.code, code_verifier: f.verifier }), new Headers());
    const v = (await oauth.verifierJetonAcces(j.access_token))!;
    await oauth.noterClientMcp(v.id, "Claude");
    const vue = await oauth.listerAcces();
    const texte = JSON.stringify(vue);
    assert.ok(!texte.includes(j.access_token) && !texte.includes(j.refresh_token));
    const c = vue.clients.find((x) => x.id === client.client_id)!;
    assert.ok(c.connexions.some((x) => x.id === v.id && x.active && x.clientNom === "Claude"));
    await oauth.revoquerJeton(v.id, "essai");
    assert.equal(await oauth.verifierJetonAcces(j.access_token), null);
    await assert.rejects(oauth.echangerJeton(form({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: j.refresh_token }), new Headers()));

    const f2 = await flux(client);
    const j2 = await oauth.echangerJeton(form({ grant_type: "authorization_code", client_id: client.client_id, code: f2.code, code_verifier: f2.verifier }), new Headers());
    await oauth.revoquerClient(client.client_id, "essai");
    assert.equal(await oauth.verifierJetonAcces(j2.access_token), null);
    await assert.rejects(oauth.chargerClient(client.client_id), (e: unknown) => e instanceof oauth.ErreurOAuth && e.code === "invalid_client");
    const apres = await oauth.listerAcces();
    assert.equal(apres.clients.find((x) => x.id === client.client_id)!.connexions.filter((x) => x.active).length, 0);
    assert.ok(apres.clients.find((x) => x.id === client.client_id)!.revoqueLe);
  });

  test("limite de fréquence : au-delà du maximum dans la fenêtre, refus", () => {
    limite.remettreAZero();
    for (let i = 0; i < 3; i++) assert.equal(limite.autoriserAppel("ip", 3, 60_000, 1000), true);
    assert.equal(limite.autoriserAppel("ip", 3, 60_000, 1000), false);
    assert.equal(limite.autoriserAppel("ip", 3, 60_000, 70_000), true, "fenêtre passée");
  });
});
