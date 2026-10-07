import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { COOKIE_INTERFACE, DUREE_COOKIE_S, interfaceCourante, interfaceDemandee } from "./choix";

/**
 * Mission 22 (lot A0b) — le drapeau `CRM_INTERFACE` : la v1 tant qu'il n'est pas posé, la v2 quand il vaut `v2`,
 * et en `apercu` seulement la session qui porte le cookie. Toute autre valeur garde la v1.
 */
const drapeauAvant = process.env.CRM_INTERFACE ?? "";
after(() => {
  process.env.CRM_INTERFACE = drapeauAvant;
});

describe("interfaceDemandee (pure)", () => {
  test("absent ou v1 : la v1, quel que soit le cookie", () => {
    assert.equal(interfaceDemandee({ env: undefined, cookie: undefined }), "v1");
    assert.equal(interfaceDemandee({ env: "", cookie: "v2" }), "v1");
    assert.equal(interfaceDemandee({ env: "v1", cookie: "v2" }), "v1");
  });

  test("v2 : la v2 pour tout le monde ; seule la session qui porte le cookie v1 revient à la v1 (pour comparer)", () => {
    assert.equal(interfaceDemandee({ env: "v2", cookie: undefined }), "v2");
    assert.equal(interfaceDemandee({ env: "v2", cookie: "v2" }), "v2");
    assert.equal(interfaceDemandee({ env: "v2", cookie: "autre" }), "v2");
    assert.equal(interfaceDemandee({ env: "v2", cookie: "v1" }), "v1");
    assert.equal(interfaceDemandee({ env: " V2 ", cookie: null }), "v2");
  });

  test("apercu : la v2 seulement pour la session qui porte le cookie v2", () => {
    assert.equal(interfaceDemandee({ env: "apercu", cookie: "v2" }), "v2");
    assert.equal(interfaceDemandee({ env: "apercu", cookie: "v1" }), "v1");
    assert.equal(interfaceDemandee({ env: "apercu", cookie: undefined }), "v1");
    assert.equal(interfaceDemandee({ env: "apercu", cookie: "autre" }), "v1");
  });

  test("toute autre valeur vaut v1 (une faute de frappe sur le serveur ne bascule rien)", () => {
    assert.equal(interfaceDemandee({ env: "v3", cookie: "v2" }), "v1");
    assert.equal(interfaceDemandee({ env: "oui", cookie: "v2" }), "v1");
  });

  test("le cookie a un nom et une durée fixes (7 jours)", () => {
    assert.equal(COOKIE_INTERFACE, "crm-interface");
    assert.equal(DUREE_COOKIE_S, 604_800);
  });
});

describe("interfaceCourante (hors requête : le drapeau seul décide)", () => {
  test("sans drapeau : v1 ; avec v2 : v2 ; avec apercu et sans cookie : v1", async () => {
    process.env.CRM_INTERFACE = "";
    assert.equal(await interfaceCourante(), "v1");
    process.env.CRM_INTERFACE = "v2";
    assert.equal(await interfaceCourante(), "v2");
    process.env.CRM_INTERFACE = "apercu";
    assert.equal(await interfaceCourante(), "v1");
  });
});
