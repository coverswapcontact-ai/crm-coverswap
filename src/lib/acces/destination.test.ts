import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACCUEIL, destinationApresConnexion } from "./destination";

const ORIGINE = "https://crm.coverswap.fr";
const apres = (callbackUrl: string | null) => destinationApresConnexion(callbackUrl === null ? "" : `?${new URLSearchParams({ callbackUrl })}`, ORIGINE);

describe("retour après la connexion", () => {
  test("la page demandée, paramètres compris ; l'accueil sinon", () => {
    assert.equal(apres(null), ACCUEIL);
    assert.equal(apres("/dossiers?dossier=abc"), "/dossiers?dossier=abc");
    assert.equal(apres("/api/google/connexion"), "/api/google/connexion", "lien direct vers le consentement Google");
    assert.equal(apres("https://crm.coverswap.fr/clients/42"), "/clients/42", "adresse absolue posée par NextAuth");
  });

  test("jamais hors du CRM ni vers la page de connexion elle-même", () => {
    for (const piege of ["https://exemple.test/vol", "//exemple.test/vol", "/\\exemple.test", "javascript:alert(1)", "/auth/signin?callbackUrl=/x"]) {
      assert.equal(apres(piege), ACCUEIL, piege);
    }
  });
});
