import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES_ECHEC, classerErreurOpenAI } from "./erreurs-generation";
import { rendreSimulation, simulationAutorisee } from "../acces/limite-site";

describe("échecs de génération du simulateur", () => {
  test("un crédit épuisé est une panne de notre côté, jamais un défaut de la photo", () => {
    const quota = '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}';
    assert.equal(classerErreurOpenAI(429, quota), "service-indisponible");
    const plafond = '{"error":{"message":"Billing hard limit has been reached","type":"invalid_request_error","code":"billing_hard_limit_reached"}}';
    assert.equal(classerErreurOpenAI(400, plafond), "service-indisponible");
    assert.equal(classerErreurOpenAI(401, '{"error":{"code":"invalid_api_key"}}'), "service-indisponible");
    assert.match(MESSAGES_ECHEC["service-indisponible"], /ni votre photo/);
    assert.match(MESSAGES_ECHEC["service-indisponible"], /coordonnées/);
  });

  test("les autres refus gardent leur vraie cause", () => {
    assert.equal(classerErreurOpenAI(429, '{"error":{"code":"rate_limit_exceeded"}}'), "surcharge");
    assert.equal(classerErreurOpenAI(400, '{"error":{"code":"moderation_blocked","message":"safety system"}}'), "photo-refusee");
    assert.equal(classerErreurOpenAI(400, '{"error":{"message":"Invalid value"}}'), "erreur");
    assert.equal(classerErreurOpenAI(503, ""), "surcharge");
    for (const message of Object.values(MESSAGES_ECHEC)) assert.match(message, /coordonnées/);
  });

  test("une simulation échouée de notre fait est rendue au visiteur", () => {
    const ip = "203.0.113.77";
    const t = Date.UTC(2026, 8, 18, 10);
    for (let i = 0; i < 15; i++) assert.equal(simulationAutorisee(ip, t).ok, true);
    assert.equal(simulationAutorisee(ip, t).ok, false);
    rendreSimulation(ip, t);
    assert.equal(simulationAutorisee(ip, t).ok, true);
  });
});
