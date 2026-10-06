import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { GET, cheminDeRetour } from "./route";

/**
 * Mission 22 (lot A0b) — la route qui pose le cookie de l'aperçu : `v=v2` pose `crm-interface=v2` pour 7 jours et
 * redirige vers `retour` ; `v=v1` (ou autre chose) efface le cookie ; un retour qui n'est pas un chemin du CRM
 * ramène sur `/taches`.
 */
describe("GET /api/interface", () => {
  test("v=v2 : cookie posé 7 jours, sameSite lax, chemin /, puis redirection 303 vers retour", async () => {
    const reponse = await GET(new NextRequest("http://localhost:3001/api/interface?v=v2&retour=%2Fdossiers%3Fdossier%3Dabc"));
    assert.equal(reponse.status, 303);
    assert.equal(reponse.headers.get("location"), "http://localhost:3001/dossiers?dossier=abc");
    const cookie = reponse.cookies.get("crm-interface");
    assert.equal(cookie?.value, "v2");
    assert.equal(cookie?.maxAge, 604_800);
    assert.equal(cookie?.path, "/");
    assert.equal(String(cookie?.sameSite).toLowerCase(), "lax");
  });

  test("v=v1 : le cookie est effacé (durée 0), retour sur le chemin demandé", async () => {
    const reponse = await GET(new NextRequest("http://localhost:3001/api/interface?v=v1&retour=%2Fleads"));
    assert.equal(reponse.status, 303);
    assert.equal(reponse.headers.get("location"), "http://localhost:3001/leads");
    const cookie = reponse.cookies.get("crm-interface");
    assert.equal(cookie?.value, "");
    assert.equal(cookie?.maxAge, 0);
  });

  test("sans v, ou avec une valeur inconnue : comme v1", async () => {
    const reponse = await GET(new NextRequest("http://localhost:3001/api/interface?v=v9"));
    assert.equal(reponse.cookies.get("crm-interface")?.maxAge, 0);
    assert.equal(reponse.headers.get("location"), "http://localhost:3001/taches");
  });

  test("retour : chemin relatif seulement, sinon /taches (jamais une adresse extérieure)", () => {
    assert.equal(cheminDeRetour("/finances?annee=2026"), "/finances?annee=2026");
    assert.equal(cheminDeRetour(undefined), "/taches");
    assert.equal(cheminDeRetour(""), "/taches");
    assert.equal(cheminDeRetour("https://exemple.test/"), "/taches");
    assert.equal(cheminDeRetour("//exemple.test/"), "/taches");
    assert.equal(cheminDeRetour("/\\exemple.test"), "/taches");
    assert.equal(cheminDeRetour("taches"), "/taches");
  });
});
