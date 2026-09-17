import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { secretWebhookValide, secretsWebhook } from "./secret-webhook";

const initial = { actuel: process.env.WEBHOOK_SECRET, precedent: process.env.WEBHOOK_SECRET_PRECEDENT };

afterEach(() => {
  for (const [cle, valeur] of [
    ["WEBHOOK_SECRET", initial.actuel],
    ["WEBHOOK_SECRET_PRECEDENT", initial.precedent],
  ] as const) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
});

describe("secret des webhooks", () => {
  test("seul le secret configuré passe ; rien de configuré, rien ne passe", () => {
    process.env.WEBHOOK_SECRET = "secret-actuel-essai";
    delete process.env.WEBHOOK_SECRET_PRECEDENT;
    assert.equal(secretWebhookValide("secret-actuel-essai"), true);
    assert.equal(secretWebhookValide("secret-actuel-essai\n"), true, "un retour à la ligne collé dans la variable de l'expéditeur ne bloque pas");
    assert.equal(secretWebhookValide("secret-actuel"), false);
    assert.equal(secretWebhookValide(""), false);
    assert.equal(secretWebhookValide(null), false);
    delete process.env.WEBHOOK_SECRET;
    assert.equal(secretWebhookValide("secret-actuel-essai"), false);
    assert.equal(secretWebhookValide("", []), false);
  });

  test("rotation : l'ancien reste accepté tant que WEBHOOK_SECRET_PRECEDENT est posé, puis plus du tout", () => {
    process.env.WEBHOOK_SECRET = "nouveau-secret-essai";
    process.env.WEBHOOK_SECRET_PRECEDENT = "ancien-secret-essai";
    assert.deepEqual(secretsWebhook(), ["nouveau-secret-essai", "ancien-secret-essai"]);
    assert.equal(secretWebhookValide("nouveau-secret-essai"), true);
    assert.equal(secretWebhookValide("ancien-secret-essai"), true);
    delete process.env.WEBHOOK_SECRET_PRECEDENT;
    assert.equal(secretWebhookValide("ancien-secret-essai"), false);
  });

  test("repli (jeton de vérification Meta) seulement sans WEBHOOK_SECRET", () => {
    delete process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_SECRET_PRECEDENT;
    assert.deepEqual(secretsWebhook("jeton-meta-essai"), ["jeton-meta-essai"]);
    process.env.WEBHOOK_SECRET = "secret-actuel-essai";
    assert.deepEqual(secretsWebhook("jeton-meta-essai"), ["secret-actuel-essai"]);
  });
});
