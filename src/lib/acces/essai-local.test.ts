import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();

/**
 * Mission 22 (lot A0b) — la garde dure `CRM_ESSAI_LOCAL=1` : chaque entonnoir d'envoi sortant est appelé avec des
 * données factices, aucun transport n'est touché (les seams d'essai lèvent s'ils sont appelés, `fetch` aussi), et
 * le registre `envoisRefuses()` garde une ligne par canal. Les lectures (GET Google) passent toujours.
 */
const piege = (nom: string) => () => {
  throw new Error(`${nom} appelé : un envoi est parti en essai local`);
};
const fetchAvant = globalThis.fetch;
let garde: typeof import("./essai-local");
let canaux: typeof import("@/lib/alertes/canaux");
let pushweb: typeof import("@/lib/alertes/pushweb");
let mail: typeof import("@/lib/mail/envoi");
let sms: typeof import("@/lib/sms/fournisseurs");
let meta: typeof import("@/lib/meta/conversions");
let google: typeof import("@/lib/google/connexion");
let stripe: typeof import("@/lib/paiement/stripe");
let erreursGeneration: typeof import("@/lib/site/erreurs-generation");
let relais: typeof import("@/lib/alertes/relais-ntfy");
let vision: typeof import("@/lib/simulateur/moteur/vision");
let generation: typeof import("@/lib/simulations/generation");

before(async () => {
  process.env.CRM_ESSAI_LOCAL = "1";
  globalThis.fetch = piege("fetch") as unknown as typeof fetch;
  garde = await import("./essai-local");
  garde.oublierEnvoisRefuses();
  [canaux, pushweb, mail, sms, meta, google, stripe, erreursGeneration, relais, vision, generation] = await Promise.all([
    import("@/lib/alertes/canaux"),
    import("@/lib/alertes/pushweb"),
    import("@/lib/mail/envoi"),
    import("@/lib/sms/fournisseurs"),
    import("@/lib/meta/conversions"),
    import("@/lib/google/connexion"),
    import("@/lib/paiement/stripe"),
    import("@/lib/site/erreurs-generation"),
    import("@/lib/alertes/relais-ntfy"),
    import("@/lib/simulateur/moteur/vision"),
    import("@/lib/simulations/generation"),
  ]);
  // Les seams d'essai lèvent : la garde doit passer avant eux.
  mail.definirEnvoyeurMailEssai({ nom: "piège", envoyer: piege("envoyeur mail") });
  vision.definirVisionEssai(piege("vision"));
  generation.definirGenerateurEssai(piege("générateur"));
  generation.definirAppelAmbianceEssai(piege("appel ambiance"));
  // Des variables posées comme en production : la garde seule doit suffire.
  process.env.TELEGRAM_BOT_TOKEN = "jeton-factice";
  process.env.TELEGRAM_CHAT_ID = "1";
  process.env.NTFY_TOPIC = "sujet-factice";
  process.env.RESEND_API_KEY = "re_factice";
  process.env.EMAIL_FROM = "CRM <essai@exemple.test>";
  process.env.STRIPE_SECRET_KEY = "sk_test_factice";
  process.env.SMS_FOURNISSEUR = "brevo";
  process.env.BREVO_API_KEY = "brevo-factice";
  process.env.META_PIXEL_ID = "1";
  process.env.META_CONVERSIONS_TOKEN = "meta-factice";
  process.env.OPENAI_API_KEY = "sk-factice";
});

after(() => {
  globalThis.fetch = fetchAvant;
  process.env.CRM_ESSAI_LOCAL = "";
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "RESEND_API_KEY", "EMAIL_FROM", "STRIPE_SECRET_KEY", "SMS_FOURNISSEUR", "BREVO_API_KEY", "META_PIXEL_ID", "META_CONVERSIONS_TOKEN", "OPENAI_API_KEY"]) process.env[cle] = "";
  mail.oublierEnvoyeurMailEssai();
  vision.definirVisionEssai(null);
  generation.definirGenerateurEssai(null);
  generation.definirAppelAmbianceEssai(null);
  google.definirTransportGoogleEssai(null);
});

const canauxRefuses = () => [...new Set(garde.envoisRefuses().map((ligne) => ligne.canal))];

describe("CRM_ESSAI_LOCAL=1 : aucun envoi sortant", () => {
  test("essaiLocal() lit la variable paresseusement ; refuserEnvoi journalise et range dans le registre (50 lignes au plus)", () => {
    assert.equal(garde.essaiLocal(), true);
    const avertissements: string[] = [];
    const warnAvant = console.warn;
    console.warn = (message: unknown) => avertissements.push(String(message));
    try {
      const resultat = garde.refuserEnvoi("essai", "un résumé");
      assert.deepEqual(resultat, { essaiLocal: true, detail: "essai local : rien n'est parti" });
    } finally {
      console.warn = warnAvant;
    }
    assert.deepEqual(avertissements, ["[essai local] essai : rien n'est parti — un résumé"]);
    for (let n = 0; n < 60; n++) garde.refuserEnvoi("bruit", String(n));
    assert.equal(garde.envoisRefuses().length, 50);
    garde.oublierEnvoisRefuses();
    assert.equal(garde.envoisRefuses().length, 0);
    process.env.CRM_ESSAI_LOCAL = "0";
    assert.equal(garde.essaiLocal(), false);
    process.env.CRM_ESSAI_LOCAL = "1";
  });

  test("alerter() : une ligne « ok » par canal, sans toucher Telegram, ntfy, le push ni Resend", async () => {
    const resultats = await canaux.alerter({ titre: "Alerte factice", texte: "rien" });
    assert.deepEqual(
      resultats.map((r) => [r.canal, r.ok, r.detail]),
      canaux.CANAUX.map((canal) => [canal, true, "essai local : rien n'est parti"])
    );
  });

  test("envoyerPushWeb() : refusé avant même de lire les abonnements", async () => {
    const resultat = await pushweb.envoyerPushWeb({ titre: "Push factice", texte: "rien" });
    assert.equal(resultat.ok, true);
    assert.equal(resultat.detail, "essai local : rien n'est parti");
  });

  test("envoyeurMail() : l'envoyeur « essai local » rend un identifiant factice, le seam piégé n'est jamais appelé", async () => {
    const envoyeur = await mail.envoyeurMail();
    assert.equal(envoyeur?.nom, "essai local");
    const envoi = await envoyeur!.envoyer({ a: "client@exemple.test", objet: "Devis", texte: "Bonjour" });
    assert.match(envoi.identifiant ?? "", /^essai-local-/);
    assert.equal((await mail.envoyeurMail({ exigerGmail: true }))?.nom, "essai local");
  });

  test("fournisseurSms() : le simulateur, même avec SMS_FOURNISSEUR=brevo et une clé posée", async () => {
    const fournisseur = sms.fournisseurSms();
    assert.equal(fournisseur?.nom, "simulateur");
    const accuse = await fournisseur!.envoyer({ numero: "+33600000000", texte: "SMS factice", reference: "essai" });
    assert.ok(accuse.identifiant);
    assert.match(sms.etatFournisseur().remarque ?? "", /aucun SMS réel/);
  });

  test("envoyerConversion() : inactif, rien vers Meta", async () => {
    const resultat = await meta.envoyerConversion({ etape: "SIGNE", evenementId: "evt-essai", email: "client@exemple.test" } as Parameters<typeof meta.envoyerConversion>[0]);
    assert.equal(resultat.ok, false);
    assert.equal(resultat.inactif, true);
    assert.equal(resultat.detail, "essai local : rien n'est parti");
  });

  test("appelGoogle() : une écriture (POST) est refusée avec une réponse factice ; une lecture (GET) passe par le transport", async () => {
    const reponse = await google.appelGoogle("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { portee: google.PORTEES_GOOGLE.GMAIL_ENVOYER, method: "POST", body: "{}" });
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { id: "essai-local", threadId: null, labels: [] });
    // La lecture n'est pas gardée : elle atteint le transport (ici un faux Google), après la recherche d'un jeton —
    // sans connexion Google en base, c'est l'attente « Google : … » habituelle, pas un refus de la garde.
    google.definirTransportGoogleEssai(async () => new Response("{}", { status: 200 }));
    await assert.rejects(google.appelGoogle("https://gmail.googleapis.com/gmail/v1/users/me/labels", { portee: google.PORTEES_GOOGLE.GMAIL_ENVOYER }), /Google/);
    assert.ok(!canauxRefuses().includes("google-lecture"));
  });

  test("creerSessionCheckout() : pas de session Stripe, retour sur la page du client", async () => {
    const session = await stripe.creerSessionCheckout({ dossierId: "d1", centimes: 1000, libelle: "Acompte", retour: "https://exemple.test/retour", cleIdempotence: "k1" } as Parameters<typeof stripe.creerSessionCheckout>[0]);
    assert.deepEqual(session, { id: "cs_essai_local", url: "https://exemple.test/retour" });
  });

  test("alerterPanneSimulateur() : rien vers Resend", async () => {
    erreursGeneration.reinitialiserAlerte();
    assert.equal(await erreursGeneration.alerterPanneSimulateur(402, "crédit"), false);
  });

  test("envoyerParRelais() : rien vers la passerelle du site", async () => {
    assert.deepEqual(await relais.envoyerParRelais({ sujet: "s", titre: "Relais factice", priorite: "4", tags: "bell", actions: "", texte: "rien" }), { status: 200 });
  });

  test("appelerVision() et le générateur d'images : aucun appel payant, un échec explicite", async () => {
    const analyse = await vision.appelerVision("analyse", { systeme: "", texte: "", images: [], jetonsSortieMax: 10, schema: { nom: "x", json: {} } } as Parameters<typeof vision.appelerVision>[1], () => null);
    assert.equal(analyse.ok, false);
    assert.match(analyse.ok ? "" : analyse.message, /essai local/);
    const rendu = await generation.generateurEnVigueur()({ origine: "CRM" } as Parameters<ReturnType<typeof generation.generateurEnVigueur>>[0]);
    assert.equal(rendu.ok, false);
    assert.match(rendu.ok ? "" : rendu.message, /essai local/);
    const ambiance = await generation.genererAmbiance({ prompt: "x", format: "1024x1024" } as Parameters<typeof generation.genererAmbiance>[0], { appel: piege("appel fourni") as unknown as import("@/lib/simulations/generation").AppelAmbiance });
    assert.equal(ambiance.ok, false);
  });

  test("le registre porte une ligne par canal gardé (10 canaux au moins)", () => {
    const attendus = ["alertes", "pushweb", "mail", "sms", "meta", "google", "stripe", "resend", "relais-ntfy", "openai-vision", "openai-images"];
    for (const canal of attendus) assert.ok(canauxRefuses().includes(canal), canal);
    assert.ok(attendus.length >= 8);
  });
});
