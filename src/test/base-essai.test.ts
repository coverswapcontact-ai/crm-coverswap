import assert from "node:assert/strict";
import { test } from "node:test";
import { CANAUX_SORTANTS, couperCanauxSortants } from "./base-essai";

test("les canaux sortants sont posés à vide, même remplis par .env : Prisma ne peut plus les reprendre", () => {
  const env = { NTFY_TOPIC: "sujet-du-test" } as unknown as NodeJS.ProcessEnv;
  couperCanauxSortants(env);
  for (const cle of CANAUX_SORTANTS) assert.ok(cle in env, cle);
  assert.equal(env.NTFY_TOPIC, "");
  assert.equal(env.TELEGRAM_BOT_TOKEN, "");
  assert.equal(env.RESEND_API_KEY, "");
  assert.equal(env.OVH_APPLICATION_KEY, "");
});
