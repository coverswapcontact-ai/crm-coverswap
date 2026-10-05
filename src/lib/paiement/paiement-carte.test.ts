import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { preparerBaseEssai } from "@/test/base-essai";

preparerBaseEssai();
process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "coverswap-paiement-carte-"));

/**
 * Mission 18 (B10, écart 10) : le paiement par carte. « Payer par carte » (espace, `POST …/paiement-carte`) ouvre une
 * session Stripe Checkout pour ce que le CRM calcule (acompte du devis signé, ou reste des factures), bouton masqué sans
 * les deux variables ; le webhook signé (`POST /api/webhook/stripe`) enregistre l'encaissement une seule fois et fait
 * avancer le dossier par le point d'entrée (PAIEMENT_RECU) ; l'acompte reçu sur une variante la retient, les autres
 * passent « non retenu » (aussi au passage « Signé » de l'écran et par la correction de cohérence) ; « Mes documents »
 * dit « Réglée » d'après les encaissements. Chaque cas se lit des deux côtés (`etatDesDeuxCotes`). Stripe est SIMULÉ
 * (fetch intercepté) : rien ne part hors du poste. Valeurs de clés factices, noms fictifs.
 */

let prisma: typeof import("@/lib/prisma").default;
let avecActeur: typeof import("@/lib/journal/contexte").avecActeur;
let liens: typeof import("@/lib/espace/liens");
let service: typeof import("@/lib/espace/service");
let compte: typeof import("@/lib/espace/compte");
let documents: typeof import("@/lib/dossiers/documents");
let dossiers: typeof import("@/lib/dossiers/dossiers");
let transitions: typeof import("@/lib/dossiers/transitions");
let synchro: typeof import("@/lib/dossiers/synchro");
let encaissements: typeof import("@/lib/encaissements/service");
let coherence: typeof import("@/lib/coherence/controle");
let stripe: typeof import("./stripe");
let routeEspace: typeof import("@/app/api/espace/[jeton]/[[...action]]/route");
let routeWebhook: typeof import("@/app/api/webhook/stripe/route");
let etatDesDeuxCotes: typeof import("@/test/etat-dossier").etatDesDeuxCotes;
let aujourdhui: string;

const LUCAS = { acteur: "HUMAIN:lucas@coverswap.fr" };
const ORIGINE = { ip: null, navigateur: null };
const SECRET_WEBHOOK = "whsec_essai_factice";
const appelsReseau: string[] = [];
const appelsStripe: { url: string; corps: URLSearchParams; entetes: Record<string, string> }[] = [];
const fetchOriginal = globalThis.fetch;

const ligne = (designation: string, quantite: number, prixUnitaire: number) => ({ type: "PRESTATION" as const, designation, sousDesignation: undefined, quantite, unite: "ml" as const, prixUnitaire });
const generation = (type: "DEVIS" | "FACTURE", lignes: ReturnType<typeof ligne>[], extra: Record<string, unknown> = {}) =>
  documents.schemaGeneration.parse({ type, objet: "Recouvrement cuisine", lignes, noteMl: true, acomptePct: type === "DEVIS" ? 30 : null, remplaceDocumentId: null, ...extra });

let numero = 40_000_000;
async function client(prenom: string) {
  const lead = await prisma.lead.create({ data: { prenom, nom: "Essai", telephone: `+3366${++numero}`, email: `${prenom.toLowerCase()}.carte@example.test`, ville: "Lattes", codePostal: "34970", source: "META_ADS" } });
  const ouvert = await liens.ouvrirEspaceDuContact(lead.id);
  return { leadId: lead.id, dossierId: ouvert.dossierId, espaceId: ouvert.espace.id, permanent: ouvert.permanent, jeton: liens.jetonEspace(ouvert.permanent) };
}
const devis = (dossierId: string, lignes: ReturnType<typeof ligne>[], extra: Record<string, unknown> = {}) => avecActeur(LUCAS, async () => (await documents.genererDocument(dossierId, generation("DEVIS", lignes, extra))).document);
const espaceDe = (id: string) => prisma.espaceClient.findUniqueOrThrow({ where: { id } });
const statutDe = async (id: string) => (await prisma.document.findUniqueOrThrow({ where: { id } })).statut;
const mailsPaiement = (encaissementId: string) => prisma.envoiMail.count({ where: { cle: `notif:PAIEMENT_RECU:${encaissementId}` } });
const dernierPassage = (dossierId: string) => prisma.dossierEvenement.findFirstOrThrow({ where: { dossierId, type: "CHANGEMENT_ETAPE" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });

function stripeOuvert(ouvert: boolean) {
  process.env.STRIPE_SECRET_KEY = ouvert ? "sk_test_essai_factice" : "";
  process.env.STRIPE_WEBHOOK_SECRET = ouvert ? SECRET_WEBHOOK : "";
}

let ip = 20;
/** `projet` : le code du projet visé (le site le passe toujours ; un projet terminé ne s'ouvre que par lui). */
async function payerParCarte(jeton: string, options: { apercu?: string; corps?: unknown; projet?: string } = {}) {
  const parametres = new URLSearchParams({ ...(options.apercu ? { apercu: options.apercu } : {}), ...(options.projet ? { projet: options.projet } : {}) }).toString();
  const adresse = `http://localhost/api/espace/${jeton}/paiement-carte${parametres ? `?${parametres}` : ""}`;
  const requete = new NextRequest(adresse, { method: "POST", body: JSON.stringify(options.corps ?? {}), headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` } });
  const reponse = await routeEspace.POST(requete, { params: Promise.resolve({ jeton, action: ["paiement-carte"] }) });
  return { status: reponse.status, corps: (await reponse.json()) as { url?: string; error?: string; raison?: string } };
}

/** Un événement Stripe « session réglée », tel que Stripe l'enverrait. */
function evenementStripe(session: { id: string; centimes: number; dossierId: string; documentId?: string | null; nature?: "ACOMPTE" | "SOLDE"; type?: string; paye?: boolean }) {
  return {
    id: `evt_${session.id}`,
    object: "event",
    type: session.type ?? "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: session.id,
        object: "checkout.session",
        amount_total: session.centimes,
        currency: "eur",
        payment_status: session.paye === false ? "unpaid" : "paid",
        payment_intent: `pi_${session.id}`,
        client_reference_id: session.dossierId,
        metadata: { dossierId: session.dossierId, documentId: session.documentId ?? "", nature: session.nature ?? "ACOMPTE", espaceId: "essai" },
      },
    },
  };
}

async function webhook(charge: unknown, options: { secret?: string; t?: number; sansSignature?: boolean } = {}) {
  const brut = JSON.stringify(charge);
  const t = options.t ?? Math.floor(Date.now() / 1000);
  const entetes: Record<string, string> = { "content-type": "application/json" };
  if (!options.sansSignature) entetes["stripe-signature"] = stripe.signerCommeStripe(brut, options.secret ?? SECRET_WEBHOOK, t);
  const reponse = await routeWebhook.POST(new NextRequest("http://localhost/api/webhook/stripe", { method: "POST", body: brut, headers: entetes }));
  return { status: reponse.status, corps: (await reponse.json()) as { statut?: string; raison?: string; encaissementId?: string } };
}

before(async () => {
  globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (url.startsWith("https://api.stripe.com/")) {
      const corps = new URLSearchParams(String(init?.body ?? ""));
      appelsStripe.push({ url, corps, entetes: Object.fromEntries(new Headers(init?.headers).entries()) });
      const id = `cs_test_${appelsStripe.length}`;
      return new Response(JSON.stringify({ id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url) && !url.startsWith("data:")) {
      appelsReseau.push(url);
      throw new Error(`réseau coupé pendant les essais : ${url}`);
    }
    return fetchOriginal(entree, init);
  }) as typeof fetch;
  prisma = (await import("@/lib/prisma")).default;
  for (const cle of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "NTFY_TOPIC", "NTFY_TOKEN", "RESEND_API_KEY", "META_PIXEL_ID", "META_ACCESS_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ESPACE_CLIENT_SECRET"]) process.env[cle] = ""; // vide, pas supprimée : Prisma reprendrait la valeur de .env
  stripeOuvert(false);
  process.env.NEXTAUTH_SECRET = "secret-de-session-pour-les-essais";
  process.env.SITE_URL = "https://coverswap.fr";
  avecActeur = (await import("@/lib/journal/contexte")).avecActeur;
  liens = await import("@/lib/espace/liens");
  service = await import("@/lib/espace/service");
  compte = await import("@/lib/espace/compte");
  documents = await import("@/lib/dossiers/documents");
  dossiers = await import("@/lib/dossiers/dossiers");
  transitions = await import("@/lib/dossiers/transitions");
  synchro = await import("@/lib/dossiers/synchro");
  encaissements = await import("@/lib/encaissements/service");
  coherence = await import("@/lib/coherence/controle");
  stripe = await import("./stripe");
  routeEspace = await import("@/app/api/espace/[jeton]/[[...action]]/route");
  routeWebhook = await import("@/app/api/webhook/stripe/route");
  etatDesDeuxCotes = (await import("@/test/etat-dossier")).etatDesDeuxCotes;
  aujourdhui = (await import("@/lib/dossiers/dates")).jourParis(new Date());
  await (await import("@/lib/base/preparation")).preparerBase();
});
after(async () => {
  globalThis.fetch = fetchOriginal;
  stripeOuvert(false);
  assert.deepEqual(appelsReseau, [], "aucun appel réseau hors du poste");
  await prisma.$disconnect();
});

describe("Stripe : signature, lecture de l'événement, corps de la session (fonctions pures)", () => {
  test("signature valide, invalide, trop ancienne, secret ou en-tête absents ; plusieurs v1 dont une bonne", () => {
    const corps = '{"id":"evt_1"}';
    const t = 1_800_000_000;
    const bonne = stripe.signerCommeStripe(corps, "whsec_a", t);
    assert.deepEqual(stripe.verifierSignatureStripe(corps, bonne, "whsec_a", t + 10), { ok: true });
    assert.deepEqual(stripe.verifierSignatureStripe(corps, bonne, "whsec_b", t), { ok: false, raison: "invalide" });
    assert.deepEqual(stripe.verifierSignatureStripe(`${corps} `, bonne, "whsec_a", t), { ok: false, raison: "invalide" }, "le corps brut, à l'octet près");
    assert.deepEqual(stripe.verifierSignatureStripe(corps, bonne, "whsec_a", t + 301), { ok: false, raison: "trop-ancienne" });
    assert.deepEqual(stripe.verifierSignatureStripe(corps, bonne, undefined, t), { ok: false, raison: "secret-absent" });
    assert.deepEqual(stripe.verifierSignatureStripe(corps, null, "whsec_a", t), { ok: false, raison: "entete-absente" });
    assert.deepEqual(stripe.verifierSignatureStripe(corps, "v1=abc", "whsec_a", t), { ok: false, raison: "format" });
    const v1 = bonne.split("v1=")[1];
    assert.deepEqual(stripe.verifierSignatureStripe(corps, `t=${t},v1=${"0".repeat(64)},v1=${v1}`, "whsec_a", t), { ok: true }, "secret en rotation : une des signatures suffit");
  });

  test("seules les sessions réglées en euros se lisent ; le reste est ignoré avec sa raison", () => {
    const paye = stripe.lireSessionPayee(evenementStripe({ id: "cs_1", centimes: 12_345, dossierId: "d1", documentId: "doc1" }));
    assert.ok("session" in paye);
    assert.deepEqual([paye.session.centimes, paye.session.dossierId, paye.session.documentId, paye.session.nature, paye.session.paiementId], [12_345, "d1", "doc1", "ACOMPTE", "pi_cs_1"]);
    assert.ok("ignore" in stripe.lireSessionPayee(evenementStripe({ id: "cs_2", centimes: 100, dossierId: "d1", paye: false })), "pas encore réglée : attendue par async_payment_succeeded");
    assert.ok("session" in stripe.lireSessionPayee(evenementStripe({ id: "cs_2", centimes: 100, dossierId: "d1", type: "checkout.session.async_payment_succeeded" })));
    assert.ok("ignore" in stripe.lireSessionPayee({ type: "payment_intent.succeeded", data: { object: {} } }));
    assert.ok("ignore" in stripe.lireSessionPayee({ ...evenementStripe({ id: "cs_3", centimes: 100, dossierId: "d1" }), data: { object: { ...evenementStripe({ id: "cs_3", centimes: 100, dossierId: "d1" }).data.object, currency: "usd" } } }));
  });

  test("la session : montant du serveur, retour sur l'onglet Paiement, aucun moyen imposé (Klarna, Alma activables sans code)", () => {
    const corps = stripe.corpsSession({ centimes: 45_000, libelle: "Acompte – devis 2026-001", nature: "ACOMPTE", dossierId: "d1", espaceId: "e1", documentId: "doc1", retour: "https://coverswap.fr/e/x#paiement", cleIdempotence: "k", maintenant: new Date("2026-10-05T10:00:00Z") });
    assert.equal(corps.get("line_items[0][price_data][unit_amount]"), "45000");
    assert.equal(corps.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(corps.get("success_url"), "https://coverswap.fr/e/x#paiement");
    assert.equal(corps.get("metadata[documentId]"), "doc1");
    assert.equal(corps.get("expires_at"), String(Math.floor(new Date("2026-10-05T11:00:00Z").getTime() / 1000)));
    assert.equal([...corps.keys()].some((cle) => cle.startsWith("payment_method_types")), false);
  });
});

describe("« Payer par carte » puis le webhook : acompte du devis signé (mission 18, B10)", () => {
  let c: Awaited<ReturnType<typeof client>>;
  let devisId: string;
  let acompteCentimes: number;
  let sessionId: string;

  test("bouton masqué sans les deux variables ; rien à régler avant l'accord ; ouvert après : montant calculé par le serveur, aperçu refusé", async () => {
    c = await client("Carla");
    const d = await devis(c.dossierId, [ligne("Revêtement adhésif — façades", 10, 150)]);
    devisId = d.id;
    stripeOuvert(true);
    assert.equal((await payerParCarte(c.jeton)).corps.raison, "rien-a-regler", "pas d'accord : l'onglet Paiement n'est pas ouvert");

    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: d.id, nom: "Carla Essai", accepte: true }, ORIGINE);
    const signe = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([signe.etape, signe.etapeEspace, signe.statutLead], ["SIGNE", "ACOMPTE", "SIGNE"]);

    process.env.STRIPE_WEBHOOK_SECRET = "";
    assert.equal((await service.etatEspace(await espaceDe(c.espaceId))).paiementCarte, false, "la clé seule ne suffit pas : des paiements seraient pris sans être enregistrés");
    const ferme = await payerParCarte(c.jeton);
    assert.deepEqual([ferme.status, ferme.corps.raison], [409, "carte-fermee"]);
    stripeOuvert(true);
    const etat = await service.etatEspace(await espaceDe(c.espaceId));
    assert.equal(etat.paiementCarte, true);
    acompteCentimes = Math.round(etat.paiement!.acompte!.montant * 100);
    assert.equal(acompteCentimes, 45_000);

    const marque = new URL(liens.lienApercu(c.permanent)).searchParams.get("apercu")!;
    assert.equal((await payerParCarte(c.jeton, { apercu: marque })).status, 403, "aperçu : la vue du client, rien ne s'ouvre");
    assert.equal(appelsStripe.length, 0);

    const ouvert = await payerParCarte(c.jeton, { corps: { montant: 1, centimes: 100 } });
    assert.equal(ouvert.status, 200, ouvert.corps.error);
    assert.match(ouvert.corps.url ?? "", /^https:\/\/checkout\.stripe\.com\//);
    const appel = appelsStripe.at(-1)!;
    assert.equal(appel.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(appel.corps.get("line_items[0][price_data][unit_amount]"), String(acompteCentimes), "le montant vient du CRM, pas du navigateur");
    assert.equal(appel.corps.get("line_items[0][price_data][product_data][name]"), `Acompte – devis ${d.numero}`);
    assert.deepEqual([appel.corps.get("metadata[dossierId]"), appel.corps.get("metadata[documentId]"), appel.corps.get("metadata[nature]")], [c.dossierId, d.id, "ACOMPTE"]);
    assert.match(appel.corps.get("success_url") ?? "", /^https:\/\/coverswap\.fr\/e\/.+#paiement$/);
    assert.match(appel.entetes["idempotency-key"] ?? "", new RegExp(`^paiement-carte:${c.dossierId}:ACOMPTE:45000:0:\\d+$`));
    assert.match(appel.entetes.authorization ?? "", /^Bearer sk_test_/);
    sessionId = `cs_test_${appelsStripe.length}`;

    // Ouvrir la page de paiement ne change rien au dossier.
    const apres = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([apres.etape, apres.etapeEspace, apres.main, apres.prochaineAction], [signe.etape, signe.etapeEspace, signe.main, signe.prochaineAction]);
  });

  test("webhook : non signé, mal signé, trop ancien ou sans secret → refusé, rien d'écrit", async () => {
    const charge = evenementStripe({ id: sessionId, centimes: acompteCentimes, dossierId: c.dossierId, documentId: devisId });
    assert.equal((await webhook(charge, { sansSignature: true })).status, 401);
    assert.equal((await webhook(charge, { secret: "whsec_autre" })).status, 401);
    assert.equal((await webhook(charge, { t: Math.floor(Date.now() / 1000) - 600 })).status, 401);
    process.env.STRIPE_WEBHOOK_SECRET = "";
    assert.equal((await webhook(charge)).status, 503);
    stripeOuvert(true);
    assert.equal(await prisma.encaissement.count({ where: { dossierId: c.dossierId } }), 0);
  });

  test("webhook signé : encaissement par carte imputé sur le devis, espace « chantier », un mail « paiement reçu » ; rejoué → 200 sans effet", async () => {
    const charge = evenementStripe({ id: sessionId, centimes: acompteCentimes, dossierId: c.dossierId, documentId: devisId });
    const recu = await webhook(charge);
    assert.deepEqual([recu.status, recu.corps.statut], [200, "ENREGISTRE"]);
    const encaissement = await prisma.encaissement.findFirstOrThrow({ where: { dossierId: c.dossierId }, include: { affectations: { include: { numeroDocument: true } } } });
    assert.deepEqual([encaissement.montant, encaissement.moyen, encaissement.origine, encaissement.cleReprise, encaissement.reference], [450, "CARTE", "STRIPE", `stripe:${sessionId}`, `pi_${sessionId}`]);
    assert.equal(encaissement.affectations[0].numeroDocument.documentId, devisId);
    assert.equal(await mailsPaiement(encaissement.id), 1, "le mail « paiement reçu » de l'automatisme existant, programmé (file locale)");

    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.etapeEspace, etat.statutLead], ["SIGNE", "CHANTIER", "SIGNE"]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.deepEqual(etat.relances.proposables, []);
    assert.equal(etat.taches.some((t) => t.type === "ENCAISSER" && /acompte/i.test(t.titre)), false, "« Encaisser l'acompte » se ferme");
    const point = (await service.etatEspace(await espaceDe(c.espaceId))).paiement!;
    assert.deepEqual([point.acompte?.statut, point.acompte?.moyen], ["PAYE", "CARTE"]);

    const rejoue = await webhook(charge);
    assert.deepEqual([rejoue.status, rejoue.corps.statut], [200, "DEJA"]);
    assert.equal(await prisma.encaissement.count({ where: { dossierId: c.dossierId } }), 1);
    assert.equal(await mailsPaiement(encaissement.id), 1);
    assert.equal((await payerParCarte(c.jeton)).corps.raison, "rien-a-regler", "l'acompte est réglé, le chantier n'est pas facturé");
  });

  test("session payée plus tard (moyen différé) : ignorée tant qu'elle n'est pas réglée, enregistrée à async_payment_succeeded", async () => {
    const d = await client("Diane");
    const dv = await devis(d.dossierId, [ligne("Façades", 8, 150)]);
    await service.accepterDevis(await espaceDe(d.espaceId), { documentId: dv.id, nom: "Diane Essai", accepte: true }, ORIGINE);
    const enAttente = await webhook(evenementStripe({ id: "cs_differe", centimes: 36_000, dossierId: d.dossierId, documentId: dv.id, paye: false }));
    assert.deepEqual([enAttente.status, enAttente.corps.statut], [200, "IGNORE"]);
    assert.equal(await prisma.encaissement.count({ where: { dossierId: d.dossierId } }), 0);
    const regle = await webhook(evenementStripe({ id: "cs_differe", centimes: 36_000, dossierId: d.dossierId, documentId: dv.id, type: "checkout.session.async_payment_succeeded" }));
    assert.deepEqual([regle.status, regle.corps.statut], [200, "ENREGISTRE"]);
    assert.equal((await etatDesDeuxCotes(d.dossierId, { taches: false })).etapeEspace, "CHANTIER");
  });
});

describe("l'acompte retient la variante qu'il règle (suivreAcompteDossier, mission 18 B10)", () => {
  test("acompte sur la variante B d'un devis envoyé : Signé, B accepté, A « non retenu », « fixer la date du chantier », main relue ; annulé → retour, A et B de nouveau au choix", async () => {
    const c = await client("Bastien");
    const a = await devis(c.dossierId, [ligne("Façades", 10, 150)], { libelleVariante: "façades seules" });
    const b = await devis(c.dossierId, [ligne("Façades", 10, 150), ligne("Plan de travail", 4, 150)], { libelleVariante: "façades + plan", notifier: false });
    const avant = await etatDesDeuxCotes(c.dossierId);
    assert.equal(avant.etape, "DEVIS_ENVOYE");

    // Par le webhook (le même chemin que la saisie) : imputé sur B, le devis de la session.
    const recu = await webhook(evenementStripe({ id: "cs_variante_b", centimes: 10_000, dossierId: c.dossierId, documentId: b.id }));
    assert.equal(recu.corps.statut, "ENREGISTRE");
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["NON_RETENU", "ACCEPTE"]);
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.equal(etat.etape, "SIGNE");
    assert.equal(etat.statutLead, "SIGNE", "dans la transaction du paiement");
    assert.equal(etat.prochaineAction, synchro.PROCHAINE_ACTION_ACOMPTE_RECU);
    assert.equal(etat.main, etat.mainCalculee);
    assert.equal(etat.etapeEspace, "ACOMPTE", "100 € reçus sur un acompte de 630 € : il reste à régler");
    assert.deepEqual(etat.relances.proposables, [], "plus de relance de devis");
    assert.deepEqual(etat.relances.devis, []);
    assert.equal(etat.taches.some((t) => t.type === "ENVOYER_DEVIS"), false);
    const passage = await dernierPassage(c.dossierId);
    assert.equal(passage.contenu, `Devis envoyé → Signé : acompte encaissé ; non retenu : ${a.numero} (façades seules)`);
    const vue = await service.etatEspace(await prisma.espaceClient.findUniqueOrThrow({ where: { id: c.espaceId } }));
    assert.deepEqual([vue.devis?.id, vue.devisProposes.map((d) => d.id)], [b.id, [b.id]], "le client ne voit plus que la variante réglée");

    // Le paiement annulé (erreur de saisie) : plus aucun paiement, plus d'accord → retour en « Devis envoyé », les deux au choix.
    const encaissement = await prisma.encaissement.findFirstOrThrow({ where: { dossierId: c.dossierId } });
    await avecActeur(LUCAS, () => encaissements.annulerEncaissement(encaissement.id, { motif: "DOUBLON" }));
    assert.equal((await etatDesDeuxCotes(c.dossierId, { taches: false })).etape, "DEVIS_ENVOYE");
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["ENVOYE", "GENERE"]);
  });

  test("une prochaine action posée à la main est gardée : la tâche « fixer la date du chantier » est rangée à côté", async () => {
    const c = await client("Gaspard");
    const d = await devis(c.dossierId, [ligne("Façades", 6, 150)]);
    await avecActeur(LUCAS, () => dossiers.modifierDossier(c.dossierId, { prochaineAction: "Passer chez lui jeudi" }));
    await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 270, moyen: "VIREMENT", recuLe: aujourdhui, reference: null } }));
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.prochaineAction, etat.actionManuelle], ["SIGNE", "Passer chez lui jeudi", "Passer chez lui jeudi"]);
    assert.equal(await statutDe(d.id), "ACCEPTE");
    const tache = etat.taches.find((t) => t.cle === `MANUELLE:synchro:${c.dossierId}:acompte-recu`);
    assert.ok(tache, "la tâche rangée à la place");
    assert.match(tache.titre, /^Appeler le client : fixer la date du chantier \(acompte reçu\)/);
    assert.equal(etat.main, etat.mainCalculee);
  });

  test("passage « Signé » à l'écran sur la variante B : A « non retenu » (comme le bon pour accord de l'espace)", async () => {
    const c = await client("Elise");
    const a = await devis(c.dossierId, [ligne("Façades", 5, 150)], { libelleVariante: "simple" });
    const b = await devis(c.dossierId, [ligne("Façades", 5, 150), ligne("Crédence", 2, 150)], { libelleVariante: "avec crédence", notifier: false });
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "SIGNE", devisAccepteId: b.id, confirmations: { BON_POUR_ACCORD: true }, sansAcompte: { motif: "ACOMPTE_A_VENIR" } }));
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["NON_RETENU", "ACCEPTE"]);
    assert.match((await dernierPassage(c.dossierId)).contenu, new RegExp(`non retenu : ${a.numero} \\(simple\\)`));
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.etapeEspace, etat.statutLead], ["SIGNE", "ACOMPTE", "SIGNE"]);
  });

  test("correction de cohérence « paiement avant signature » : signe sur le devis réglé, l'autre « non retenu »", async () => {
    const c = await client("Hugo");
    const a = await devis(c.dossierId, [ligne("Façades", 7, 150)], { libelleVariante: "A" });
    const b = await devis(c.dossierId, [ligne("Façades", 7, 150), ligne("Plan", 3, 150)], { libelleVariante: "B", notifier: false });
    const ligneB = await prisma.numeroDocument.findUniqueOrThrow({ where: { documentId: b.id } });
    // Un paiement écrit sans suivre l'étape (l'état d'avant la mission 7) : le contrôle le voit.
    await avecActeur(LUCAS, () => prisma.$transaction((tx) => encaissements.enregistrerEncaissementDansTransaction(tx, { dossierId: c.dossierId, numeroDocumentId: ligneB.id, paiement: { montant: 200, moyen: "CHEQUE", recuLe: aujourdhui, reference: "123" } })));
    const incoherence = (await coherence.controlerCoherence()).incoherences.find((i) => i.dossierId === c.dossierId && i.code === "PAIEMENT_AVANT_SIGNATURE");
    assert.ok(incoherence);
    await avecActeur(LUCAS, () => coherence.corrigerIncoherence(incoherence.cle));
    assert.deepEqual([await statutDe(a.id), await statutDe(b.id)], ["NON_RETENU", "ACCEPTE"]);
    const etat = await etatDesDeuxCotes(c.dossierId, { taches: false });
    assert.deepEqual([etat.etape, etat.statutLead], ["SIGNE", "SIGNE"]);
    assert.equal(etat.main, etat.mainCalculee);
  });
});

describe("le solde par carte, et « Mes documents » d'après les encaissements (écart 10)", () => {
  test("statut d'une facture : annulée, réglée, reste, à régler ; repli sur l'étape pour une facture reprise sans registre", () => {
    assert.equal(compte.statutFacture("ANNULEE", { resteCentimes: 0, regleCentimes: 0 }, "ENCAISSE"), "Annulée", "avant : « Réglée » sur un dossier encaissé");
    assert.equal(compte.statutFacture("GENERE", { resteCentimes: 0, regleCentimes: 120_000 }, "FACTURE"), "Réglée", "réglée même si l'étape n'a pas suivi");
    assert.equal(compte.statutFacture("GENERE", { resteCentimes: 30_000, regleCentimes: 90_000 }, "FACTURE"), "Reste 300,00 €");
    assert.equal(compte.statutFacture("GENERE", { resteCentimes: 120_000, regleCentimes: 0 }, "ENCAISSE"), "À régler", "plus d'après l'étape");
    assert.equal(compte.statutFacture("GENERE", undefined, "ENCAISSE"), "Réglée");
    assert.equal(compte.statutFacture("GENERE", undefined, "FACTURE"), "À régler");
  });

  test("chantier facturé : « Payer par carte » ouvre le reste de la facture ; payé, le dossier passe « Encaissé » et la facture « Réglée »", async () => {
    const c = await client("Ines");
    const d = await devis(c.dossierId, [ligne("Façades", 10, 150)]);
    await service.accepterDevis(await espaceDe(c.espaceId), { documentId: d.id, nom: "Ines Essai", accepte: true }, ORIGINE);
    await avecActeur(LUCAS, () => encaissements.enregistrerEncaissement({ dossierId: c.dossierId, paiement: { montant: 450, moyen: "VIREMENT", recuLe: aujourdhui, reference: null } }));
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "PLANIFIE", dateChantier: aujourdhui }));
    await avecActeur(LUCAS, () => transitions.changerEtape(c.dossierId, { vers: "CHANTIER" }));
    const { document: facture } = await avecActeur(LUCAS, () => documents.genererDocument(c.dossierId, generation("FACTURE", [ligne("Façades", 10, 150)])));
    const mesDocuments = async () => (await compte.documentsDuClient(c.permanent)).find((x) => x.id === facture.id)?.statut;
    assert.equal(await mesDocuments(), "Reste 1 050,00 €", "l'acompte reçu est imputé sur la facture");

    const ouvert = await payerParCarte(c.jeton);
    assert.equal(ouvert.status, 200, ouvert.corps.error);
    const appel = appelsStripe.at(-1)!;
    assert.deepEqual([appel.corps.get("metadata[nature]"), appel.corps.get("line_items[0][price_data][unit_amount]"), appel.corps.get("metadata[documentId]")], ["SOLDE", "105000", facture.id]);
    assert.equal(appel.corps.get("line_items[0][price_data][product_data][name]"), `Solde – facture ${facture.numero}`);

    const recu = await webhook(evenementStripe({ id: "cs_solde", centimes: 105_000, dossierId: c.dossierId, documentId: facture.id, nature: "SOLDE" }));
    assert.equal(recu.corps.statut, "ENREGISTRE");
    const etat = await etatDesDeuxCotes(c.dossierId);
    assert.deepEqual([etat.etape, etat.etapeEspace, etat.statutLead], ["ENCAISSE", "TERMINE", "TERMINE"]);
    assert.equal(etat.main, etat.mainCalculee);
    assert.equal(etat.taches.some((t) => t.type === "ENCAISSER"), false);
    assert.equal(await mesDocuments(), "Réglée");
    const code = (await espaceDe(c.espaceId)).code;
    assert.equal((await payerParCarte(c.jeton, { projet: code })).corps.raison, "rien-a-regler", "projet terminé, tout est réglé");
  });
});
