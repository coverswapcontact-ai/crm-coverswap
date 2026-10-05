import { createHmac, timingSafeEqual } from "node:crypto";
import { ErreurMetier } from "@/lib/commun/erreurs";

/**
 * Mission 18 (B10) — Stripe, sans dépendance npm : l'API REST appelée par `fetch` (formulaire encodé), et la signature
 * des webhooks vérifiée ici (fonction pure, testée).
 *
 * Deux variables, posées par Lucas sur Railway (jamais dans le code) :
 * - STRIPE_SECRET_KEY : la clé secrète du compte (crée les sessions de paiement) ;
 * - STRIPE_WEBHOOK_SECRET : le secret de signature du webhook `…/api/webhook/stripe`.
 * Les deux sont exigées (`stripeActif`) : avec la clé seule, des paiements seraient pris sans jamais être enregistrés.
 *
 * Paiement en plusieurs fois (Klarna, Alma) : la session ne fixe aucun moyen de paiement (`payment_method_types` absent),
 * Stripe Checkout propose ceux activés dans le tableau de bord. Le commerçant reçoit le montant entier, le webhook est
 * le même (un moyen différé arrive par `checkout.session.async_payment_succeeded`) : rien à changer dans le code.
 */

export const API_STRIPE = "https://api.stripe.com/v1";

/** Le bouton « Payer par carte » de l'espace n'apparaît que si les deux variables sont posées. */
export function stripeActif(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim());
}

export type NaturePaiementCarte = "ACOMPTE" | "SOLDE";

export type DemandeSession = {
  centimes: number;
  /** Ce que le client lit sur la page de paiement : « Acompte – devis 2026-012 ». */
  libelle: string;
  nature: NaturePaiementCarte;
  dossierId: string;
  espaceId: string;
  /** Devis (acompte) ou facture (solde) réglé, s'il est connu. */
  documentId: string | null;
  /** Retour après paiement ou abandon : le lien de son espace, onglet Paiement. */
  retour: string;
  /** Deux clics rapprochés (même dossier, même montant, même état des paiements) rendent la même session. */
  cleIdempotence: string;
  maintenant?: Date;
};

/** Durée de vie d'une session de paiement (Stripe exige au moins 30 minutes). */
export const DUREE_SESSION_MS = 60 * 60_000;

/** Le corps de la création d'une session Checkout (formulaire encodé à la manière de Stripe). Pure. */
export function corpsSession(demande: DemandeSession): URLSearchParams {
  const maintenant = demande.maintenant ?? new Date();
  const metadata = { dossierId: demande.dossierId, espaceId: demande.espaceId, nature: demande.nature, documentId: demande.documentId ?? "" };
  const corps = new URLSearchParams({
    mode: "payment",
    locale: "fr",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(demande.centimes),
    "line_items[0][price_data][product_data][name]": demande.libelle,
    success_url: demande.retour,
    cancel_url: demande.retour,
    client_reference_id: demande.dossierId,
    expires_at: String(Math.floor((maintenant.getTime() + DUREE_SESSION_MS) / 1000)),
  });
  for (const [cle, valeur] of Object.entries(metadata)) {
    corps.set(`metadata[${cle}]`, valeur);
    corps.set(`payment_intent_data[metadata][${cle}]`, valeur);
  }
  return corps;
}

/** Crée une session Stripe Checkout et rend son adresse. Lève une ErreurMetier (502) si Stripe refuse ou ne répond pas. */
export async function creerSessionCheckout(demande: DemandeSession): Promise<{ id: string; url: string }> {
  const cle = process.env.STRIPE_SECRET_KEY?.trim();
  if (!cle) throw new ErreurMetier("Le paiement par carte n'est pas ouvert : réglez par virement, ou appelez CoverSwap.", 409);
  let reponse: Response;
  try {
    reponse = await fetch(`${API_STRIPE}/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": demande.cleIdempotence },
      body: corpsSession(demande).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (erreur) {
    console.error("[stripe] création de la session impossible :", erreur);
    throw new ErreurMetier("Le paiement par carte ne répond pas : réessayez dans un instant, ou réglez par virement.", 502);
  }
  const corps = (await reponse.json().catch(() => null)) as { id?: unknown; url?: unknown; error?: { message?: unknown } } | null;
  if (!reponse.ok || typeof corps?.id !== "string" || typeof corps.url !== "string") {
    console.error(`[stripe] session refusée (${reponse.status}) :`, typeof corps?.error?.message === "string" ? corps.error.message : "réponse illisible");
    throw new ErreurMetier("Le paiement par carte n'a pas pu s'ouvrir : réessayez dans un instant, ou réglez par virement.", 502);
  }
  return { id: corps.id, url: corps.url };
}

/* ── Webhook : signature ─────────────────────────────────────────── */

export type VerdictStripe = { ok: true } | { ok: false; raison: "secret-absent" | "entete-absente" | "format" | "invalide" | "trop-ancienne" };

/** Écart toléré entre l'horodatage signé et l'horloge du serveur (la valeur conseillée par Stripe). */
export const TOLERANCE_SIGNATURE_S = 300;

/**
 * Signature d'un appel du webhook Stripe : en-tête « Stripe-Signature: t=<secondes>,v1=<hexadécimal>[,v1=…] », HMAC-SHA256
 * du texte « <t>.<corps BRUT> » avec le secret du webhook ; horodatage à 300 s au plus (un vieil appel rejoué est
 * refusé). Comparaison à temps constant. Sans secret, tout est refusé. Pure.
 */
export function verifierSignatureStripe(corpsBrut: string, entete: string | null, secret: string | undefined, maintenantSecondes: number): VerdictStripe {
  if (!secret) return { ok: false, raison: "secret-absent" };
  if (!entete) return { ok: false, raison: "entete-absente" };
  const morceaux = entete.split(",").map((m) => m.trim().split("="));
  const t = morceaux.find(([cle]) => cle === "t")?.[1];
  const signatures = morceaux.filter(([cle, valeur]) => cle === "v1" && valeur).map(([, valeur]) => valeur.toLowerCase());
  if (!t || !/^\d{1,12}$/.test(t) || signatures.length === 0) return { ok: false, raison: "format" };
  const attendue = Buffer.from(createHmac("sha256", secret).update(`${t}.${corpsBrut}`, "utf8").digest("hex"), "hex");
  const valide = signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/.test(signature)) return false;
    const recue = Buffer.from(signature, "hex");
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  });
  if (!valide) return { ok: false, raison: "invalide" };
  return Math.abs(maintenantSecondes - Number(t)) > TOLERANCE_SIGNATURE_S ? { ok: false, raison: "trop-ancienne" } : { ok: true };
}

/** L'en-tête tel que Stripe l'enverrait : sert aux essais. */
export function signerCommeStripe(corpsBrut: string, secret: string, tSecondes: number): string {
  return `t=${tSecondes},v1=${createHmac("sha256", secret).update(`${tSecondes}.${corpsBrut}`, "utf8").digest("hex")}`;
}

export const MESSAGES_REFUS_STRIPE: Record<Exclude<VerdictStripe, { ok: true }>["raison"], string> = {
  "secret-absent": "STRIPE_WEBHOOK_SECRET n'est pas configurée : le webhook refuse tout.",
  "entete-absente": "En-tête Stripe-Signature absente.",
  format: "En-tête Stripe-Signature mal formée.",
  invalide: "Signature invalide.",
  "trop-ancienne": "Signature trop ancienne (plus de 5 minutes) : appel rejoué refusé.",
};

/* ── Webhook : lecture de l'événement ────────────────────────────── */

/** Une session de paiement réglée, lue dans un événement Stripe. */
export type SessionPayee = {
  evenementId: string;
  sessionId: string;
  centimes: number;
  /** Le paiement (pi_…), pour la référence de l'encaissement. */
  paiementId: string | null;
  /** Date de l'événement (secondes Unix). */
  creeLe: number;
  dossierId: string | null;
  documentId: string | null;
  nature: NaturePaiementCarte | null;
};

/**
 * Les événements qui disent qu'une session est payée : `checkout.session.completed` réglé tout de suite
 * (`payment_status: "paid"`), et `checkout.session.async_payment_succeeded` (moyen différé, réglé ensuite). Tout le
 * reste rend une raison d'ignorer (acquitté sans rien écrire). Pure.
 */
export function lireSessionPayee(charge: unknown): { session: SessionPayee } | { ignore: string } {
  const evenement = charge as { id?: unknown; type?: unknown; created?: unknown; data?: { object?: Record<string, unknown> } } | null;
  const type = typeof evenement?.type === "string" ? evenement.type : "";
  if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") return { ignore: `événement ${type || "inconnu"} : rien à enregistrer` };
  const objet = evenement?.data?.object;
  if (!objet || objet.object !== "checkout.session" || typeof objet.id !== "string") return { ignore: "pas une session de paiement" };
  if (objet.payment_status !== "paid") return { ignore: `session ${objet.id} pas encore réglée (${String(objet.payment_status)}) : attendue par async_payment_succeeded` };
  if (String(objet.currency ?? "").toLowerCase() !== "eur") return { ignore: `session ${objet.id} en ${String(objet.currency)} : seul l'euro s'enregistre` };
  const centimes = typeof objet.amount_total === "number" ? Math.round(objet.amount_total) : 0;
  if (centimes <= 0) return { ignore: `session ${objet.id} sans montant` };
  const metadata = (objet.metadata && typeof objet.metadata === "object" ? objet.metadata : {}) as Record<string, unknown>;
  const texte = (valeur: unknown) => (typeof valeur === "string" && valeur.trim() ? valeur.trim() : null);
  const nature = metadata.nature === "ACOMPTE" || metadata.nature === "SOLDE" ? metadata.nature : null;
  const paiement = objet.payment_intent;
  return {
    session: {
      evenementId: texte(evenement?.id) ?? "",
      sessionId: objet.id,
      centimes,
      paiementId: texte(paiement) ?? (paiement && typeof paiement === "object" ? texte((paiement as { id?: unknown }).id) : null),
      creeLe: typeof evenement?.created === "number" ? evenement.created : Math.floor(Date.now() / 1000),
      dossierId: texte(metadata.dossierId) ?? texte(objet.client_reference_id),
      documentId: texte(metadata.documentId),
      nature,
    },
  };
}
