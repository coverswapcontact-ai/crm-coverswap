import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Avant le 21/09/2026, une demande du site (simulateur, devis, contact) ne
 * déclenchait qu'un mail : le téléphone ne sonnait que pour Meta. Ces essais
 * figent le push des demandes du site, avec le bon lien (dossier ou fiche).
 */
let notification: typeof import("./notification");
let recues: { titre: string | null; corps: string; priorite: string | null; actions: string | null }[] = [];
let serveur: Server;

before(async () => {
  const port = await new Promise<number>((resoudre) => {
    serveur = createServer((requete, reponse) => {
      let corps = "";
      requete.on("data", (m) => (corps += m));
      requete.on("end", () => {
        recues.push({ titre: (requete.headers.title as string) ?? null, corps, priorite: (requete.headers.priority as string) ?? null, actions: (requete.headers.actions as string) ?? null });
        reponse.writeHead(200);
        reponse.end("{}");
      });
    });
    serveur.listen(0, "127.0.0.1", () => resoudre((serveur.address() as { port: number }).port));
  });
  await import("@/lib/prisma");
  // Après l'import de Prisma, qui recharge .env (voir la mémoire « Prisma recharge .env »).
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "RESEND_API_KEY"]) delete process.env[cle];
  process.env.NTFY_SERVEUR = `http://127.0.0.1:${port}`;
  process.env.NTFY_TOPIC = "essai-demandes-du-site";
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.coverswap.fr";
  notification = await import("./notification");
});
after(async () => {
  await new Promise<void>((r) => serveur.close(() => r()));
  await (await import("@/lib/prisma")).default.$disconnect();
});

const demande = { leadId: "lead123456789", prenom: "Marie", nom: "Durand", telephone: "+33612345678", ville: "Lattes", typeProjet: "CUISINE", nouveau: true, photos: 0 };

describe("push des demandes du site", () => {
  test("simulation : le téléphone sonne, et le lien mène au dossier qu'elle vient d'ouvrir", async () => {
    recues = [];
    const resultats = await notification.notifierDemandeDuSite({ ...demande, source: "SITE_SIMULATEUR", simulations: 2, dossierId: "dossier123", priorite: { classe: "PRIORITAIRE", motif: "propriétaire, Hérault" } });
    assert.ok(resultats.find((r) => r.canal === "ntfy")?.ok);
    assert.equal(recues.length, 1);
    assert.match(recues[0].titre ?? "", /PRIORITAIRE/);
    assert.match(recues[0].titre ?? "", /Simulation sur le site/);
    assert.match(recues[0].corps, /2 simulation\(s\) — dossier ouvert, photos rangées/);
    assert.match(recues[0].actions ?? "", /\/dossiers\?dossier=dossier123/);
    assert.match(recues[0].actions ?? "", /tel:\+33612345678/);
    assert.equal(recues[0].priorite, "5");
  });

  test("demande de devis sans simulation : lien vers la fiche du lead, dans la section Leads", async () => {
    recues = [];
    await notification.notifierDemandeDuSite({ ...demande, source: "SITE_DEVIS", simulations: 0, message: "Je voudrais refaire ma cuisine" });
    assert.match(recues[0].titre ?? "", /Demande de devis/);
    assert.match(recues[0].actions ?? "", /\/leads\?lead=lead123456789/);
    assert.match(recues[0].corps, /Je voudrais refaire ma cuisine/);
  });
});
