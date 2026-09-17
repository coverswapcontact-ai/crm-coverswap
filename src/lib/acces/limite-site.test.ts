import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITE_PAR_CONTACT, LIMITE_PAR_IP, contactDepasseLaLimite, ipDepasseLaLimite, ipDuVisiteur } from "./limite-site";

test("limite par IP : refuse au-delà du plafond dans la fenêtre, puis libère", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < LIMITE_PAR_IP.max; i += 1) assert.equal(ipDepasseLaLimite("203.0.113.7", t0 + i), false);
  assert.equal(ipDepasseLaLimite("203.0.113.7", t0 + LIMITE_PAR_IP.max), true);
  assert.equal(ipDepasseLaLimite("203.0.113.8", t0), false, "une autre adresse n'est pas concernée");
  assert.equal(ipDepasseLaLimite("203.0.113.7", t0 + LIMITE_PAR_IP.fenetreMs + 1), false, "la fenêtre glisse");
});

test("limite par contact : jugée sur le nombre de demandes récentes", () => {
  assert.equal(contactDepasseLaLimite(LIMITE_PAR_CONTACT.max - 1), false);
  assert.equal(contactDepasseLaLimite(LIMITE_PAR_CONTACT.max), true);
});

test("IP du visiteur : celle transmise par le site, sinon l'appelant, jamais une valeur forgée", () => {
  const entetes = (valeurs: Record<string, string>) => ({ get: (nom: string) => valeurs[nom.toLowerCase()] ?? null });
  assert.equal(ipDuVisiteur(entetes({ "x-visiteur-ip": "198.51.100.4", "x-forwarded-for": "76.76.21.21" })), "198.51.100.4");
  assert.equal(ipDuVisiteur(entetes({ "x-forwarded-for": "76.76.21.21, 10.0.0.1" })), "76.76.21.21");
  assert.equal(ipDuVisiteur(entetes({ "x-visiteur-ip": "<script>", "x-real-ip": "2001:db8::1" })), "2001:db8::1");
  assert.equal(ipDuVisiteur(entetes({})), "inconnue");
});
