import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-m25-modeles-"));
process.env.TACHES_DESACTIVEES = "1";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3001";
process.env.NEXTAUTH_SECRET = "secret-des-essais-de-la-messagerie";

/**
 * Mission 25 (lot 3) — Paramètres → SMS côté serveur : les 41 messages et leurs variantes, un texte modifié que le
 * moteur prépare ensuite, ce qui est refusé, le retour au texte validé, les modes (Validation, Désactivé : rien n'est
 * préparé et le journal le dit), la route. Puis la migration qui retire la présentation des SMS de l'écran SMS sans
 * toucher un texte réécrit par Lucas. Clients fictifs (plage 06 39 98).
 */

let prisma: typeof import("@/lib/prisma").default;
let modeles: typeof import("./modeles");
let analyse: typeof import("./analyse");
let suivis: typeof import("./suivis");
let horaires: typeof import("./horaires");

let horloge: Date;
let numero = 30;
async function nouveauLead(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Fiction", telephone: `06399800${numero++}`, ville: "Pérols", source: "META_ADS", typeProjet: "CUISINE" } });
  const suivi = (await suivis.suiviPour({ leadId: lead.id }))!;
  await analyse.analyserSuivi(suivi.id, horloge);
  return { lead, suiviId: suivi.id, messages: await prisma.messagePrepare.findMany({ where: { suiviId: suivi.id } }) };
}

before(async () => {
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "ANTHROPIC_API_KEY"]) process.env[cle] = "";
  await (await import("@/lib/base/preparation")).preparerBase();
  modeles = await import("./modeles");
  analyse = await import("./analyse");
  suivis = await import("./suivis");
  horaires = await import("./horaires");
  (await import("./alertes")).definirAlertesEssai(() => undefined);
  suivis.oublierLancement();
  await (await import("@/lib/parametres/service")).enregistrerParametre({ cle: "MESSAGERIE_LANCEMENT", valeur: new Date(Date.now() - 60_000).toISOString(), valableDu: new Date("2026-01-01"), source: "essai" });
  let jour = horaires.momentParis(new Date(Date.now() + 86_400_000)).jour;
  while (![2, 3].includes(horaires.semaineDuJour(jour)) || horaires.estFerie(jour)) jour = horaires.jourSuivant(jour);
  horloge = horaires.instantParis(jour, 10 * 60);
});

after(async () => {
  (await import("./alertes")).definirAlertesEssai(null);
  await prisma.$disconnect();
});

describe("Mission 25 (lot 3) — les textes et les modes de la liste", () => {
  test("41 messages, leurs variantes, le mode validé ; rien n'est en base tant que Lucas n'a rien touché", async () => {
    const liste = await modeles.listerMessagesDeLaListe();
    assert.equal(liste.length, 41);
    const p3 = liste.find((m) => m.code === "P3")!;
    assert.ok(p3.textes.length >= 2 && p3.textes.slice(1).every((t) => t.cle.startsWith("P3.")), p3.textes.map((t) => t.cle).join(", "));
    assert.ok(p3.textes.every((t) => t.texte === t.depart && !t.modifie));
    assert.equal(liste.find((m) => m.code === "A1")!.mode, "AUTO");
    assert.equal(liste.find((m) => m.code === "Q1")!.nature, "RAPIDE");
    assert.equal(await prisma.modeleSms.count({ where: { code: { in: liste.map((m) => m.code) } } }), 0);
  });

  test("un texte modifié est préparé tel quel ; une erreur est refusée ; « Revenir au texte validé » vide la ligne", async () => {
    const texte = "{bonjour} Lucas de CoverSwap, merci pour votre message ! Je vous appelle {quand_rappel}. Vous pouvez m'envoyer 2 ou 3 photos de votre {piece} ici.";
    const aJour = await modeles.modifierTexteDeLaListe("A1", texte);
    assert.equal(aJour.textes[0].texte, texte);
    assert.equal(aJour.textes[0].modifie, true);
    const { messages } = await nouveauLead("Agathe");
    const a1 = messages.find((m) => m.code === "A1")!;
    assert.match(a1.texte, /^Bonjour Agathe, Lucas de CoverSwap, merci pour votre message ! Je vous appelle .+\. Vous pouvez m'envoyer 2 ou 3 photos de votre cuisine ici\.$/);

    await assert.rejects(modeles.modifierTexteDeLaListe("A1", "{bonjour} votre devis de {montant}."), /\{montant\}/);
    await assert.rejects(modeles.modifierTexteDeLaListe("S2", "{bonjour} votre simulation est prête !"), /\{lien\} manque/);
    await assert.rejects(modeles.modifierTexteDeLaListe("Z9", "Bonjour"), /inconnu/);

    const remis = await modeles.modifierTexteDeLaListe("A1", null);
    assert.equal(remis.textes[0].modifie, false);
    assert.equal(remis.textes[0].texte, remis.textes[0].depart);
    assert.equal((await prisma.modeleSms.findUniqueOrThrow({ where: { code: "A1" } })).texte, "", "la ligne reste, vide : le texte validé s'applique");
  });

  test("une variante a sa propre ligne (« P3.proche ») ; le texte de départ renvoyé tel quel ne crée pas de modification", async () => {
    const p3 = (await modeles.listerMessagesDeLaListe()).find((m) => m.code === "P3")!;
    const variante = p3.textes.find((t) => t.variante !== "defaut") ?? p3.textes[0];
    const aJour = await modeles.modifierTexteDeLaListe(variante.cle, variante.depart);
    assert.equal(aJour.textes.find((t) => t.cle === variante.cle)!.modifie, false);
  });

  test("Validation : A1 attend l'accord ; Désactivé : rien n'est préparé, le journal le dit ; une réponse rapide n'a pas de mode", async () => {
    assert.equal((await modeles.modifierModeDeLaListe("A1", "VALIDATION")).mode, "VALIDATION");
    const valide = await nouveauLead("Bérénice");
    assert.equal(valide.messages.find((m) => m.code === "A1")?.mode, "VALIDATION");

    assert.equal((await modeles.modifierModeDeLaListe("A1", "DESACTIVE")).mode, "DESACTIVE");
    const coupe = await nouveauLead("Capucine");
    assert.equal(coupe.messages.filter((m) => m.code === "A1").length, 0);
    const journal = await prisma.ligneJournalSuivi.findMany({ where: { suiviId: coupe.suiviId } });
    assert.ok(journal.some((l) => /non préparé : désactivé dans Paramètres → SMS/.test(l.texte)), journal.map((l) => l.texte).join(" | "));

    await assert.rejects(modeles.modifierModeDeLaListe("Q1", "DESACTIVE"), /réponse rapide/);
    const remis = await modeles.modifierModeDeLaListe("A1", "AUTO");
    assert.equal(remis.mode, "AUTO");
    assert.equal((await prisma.modeleSms.findUniqueOrThrow({ where: { code: "A1" } })).mode, null, "le mode de la liste : rien de réglé");
  });

  test("la route : GET la liste, PATCH un texte puis un mode, refus lisible", async () => {
    const { GET, PATCH } = await import("@/app/api/messagerie/modeles/route");
    const { NextRequest } = await import("next/server");
    const liste = (await (await GET()).json()) as { messages: { code: string }[] };
    assert.equal(liste.messages.length, 41);
    const corps = (donnees: unknown) => new NextRequest("http://localhost:3001/api/messagerie/modeles", { method: "PATCH", body: JSON.stringify(donnees), headers: { "content-type": "application/json" } });
    const texte = await PATCH(corps({ cle: "E2", texte: "Bien reçu, merci ! Je reviens vers vous {quand_reponse}." }));
    assert.equal(texte.status, 200);
    assert.equal(((await texte.json()) as { message: { textes: { texte: string }[] } }).message.textes[0].texte, "Bien reçu, merci ! Je reviens vers vous {quand_reponse}.");
    const mode = await PATCH(corps({ code: "D2", mode: "DESACTIVE" }));
    assert.equal(((await mode.json()) as { message: { mode: string } }).message.mode, "DESACTIVE");
    const refus = await PATCH(corps({ cle: "E2", texte: "{bonjour} {inconnue}" }));
    assert.equal(refus.status, 400);
    assert.match(((await refus.json()) as { error: string }).error, /\{inconnue\}/);
    await modeles.modifierModeDeLaListe("D2", null);
    await modeles.modifierTexteDeLaListe("E2", null);
  });
});

describe("Mission 25 (lot 3) — migration « sms-sans-presentation-25 »", () => {
  test("l'ancien texte mot pour mot devient le nouveau ; un texte de Lucas est gardé ; les accusés ne bougent pas ; rejouable", async () => {
    const { ANCIENS_TEXTES_25, retirerLaPresentation } = await import("@/lib/base/migrations/mission-25-lot-3");
    const { definitionSms } = await import("@/lib/sms/catalogue");
    for (const [code, ancien] of Object.entries(ANCIENS_TEXTES_25)) await prisma.modeleSms.update({ where: { code }, data: { texte: ancien } });
    await prisma.modeleSms.update({ where: { code: "A_RAPPELER" }, data: { texte: "Merci ! Je vous rappelle {quand}. Lucas, CoverSwap" } });
    const accuse = (await prisma.modeleSms.findUniqueOrThrow({ where: { code: "ACCUSE_RECEPTION" } })).texte;

    assert.deepEqual(await retirerLaPresentation(prisma), { reecrits: 13, gardes: 1 });
    for (const code of Object.keys(ANCIENS_TEXTES_25).filter((c) => c !== "A_RAPPELER")) {
      const texte = (await prisma.modeleSms.findUniqueOrThrow({ where: { code } })).texte;
      assert.equal(texte, definitionSms(code)!.defaut, code);
      assert.ok(!/Lucas de CoverSwap/.test(texte), code);
    }
    assert.equal((await prisma.modeleSms.findUniqueOrThrow({ where: { code: "A_RAPPELER" } })).texte, "Merci ! Je vous rappelle {quand}. Lucas, CoverSwap");
    assert.equal((await prisma.modeleSms.findUniqueOrThrow({ where: { code: "ACCUSE_RECEPTION" } })).texte, accuse);
    assert.match(accuse, /Lucas de CoverSwap/, "premier contact : il se présente");
    assert.deepEqual(await retirerLaPresentation(prisma), { reecrits: 0, gardes: 1 });
    assert.ok(await prisma.migrationDonnees.findUnique({ where: { nom: "sms-sans-presentation-25" } }), "passée au démarrage");
  });

  test("« messagerie-reglages-25 » : Manuel et active posés au démarrage, jamais réécrits", async () => {
    const { lireParametre } = await import("@/lib/parametres/service");
    const { poserReglagesMessagerie } = await import("@/lib/base/migrations/mission-25-lot-3");
    assert.equal(await lireParametre("MESSAGERIE_MODE_ENVOI", new Date()), "MANUEL");
    assert.ok(["ACTIVE", "EN_PAUSE"].includes(String(await lireParametre("MESSAGERIE_PAUSE", new Date()))));
    assert.deepEqual(await poserReglagesMessagerie(prisma), { poses: 0 });
  });
});
