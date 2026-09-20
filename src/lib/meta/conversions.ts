import { createHash } from "node:crypto";
import { GRAPH, jetonConversions, pixelId } from "./config";
import { normaliserTelephone } from "@/lib/clients/normalisation";

/**
 * Renvoi des conversions vers Meta (API Conversions, intégration CRM).
 *
 * Le but : que l'algorithme optimise sur les gens qui SIGNENT, pas sur ceux qui
 * remplissent un formulaire. Chaque étape franchie par un dossier issu d'un lead
 * Meta repart vers Meta, rattachée au lead d'origine par `user_data.lead_id` —
 * le seul champ de `user_data` qui ne se hache pas. À défaut d'identifiant, on
 * retombe sur l'e-mail et le téléphone hachés (repli, moins précis).
 *
 * Les données personnelles sont hachées en SHA-256 selon la normalisation
 * imposée par Meta : minuscules, sans ponctuation ni espaces, téléphone au
 * format international sans le « + ».
 */

/** Étapes du CRM renvoyées à Meta. Les noms se retrouvent tels quels dans le Gestionnaire d'événements. */
export const ETAPES_CONVERSION = {
  DEVIS_ENVOYE: { evenement: "Marketing Qualified Lead", positif: true, libelle: "Devis envoyé" },
  SIGNE: { evenement: "Converted Lead", positif: true, libelle: "Devis signé" },
  ENCAISSE: { evenement: "Purchase", positif: true, libelle: "Encaissé" },
  PERDU: { evenement: "Disqualified Lead", positif: false, libelle: "Perdu" },
} as const;
export type EtapeConversion = keyof typeof ETAPES_CONVERSION;

export type DemandeConversion = {
  etape: EtapeConversion;
  /** Identifiant Meta du lead d'origine : le rattachement le plus fiable. */
  leadgenId?: string | null;
  email?: string | null;
  telephone?: string | null;
  prenom?: string | null;
  nom?: string | null;
  ville?: string | null;
  codePostal?: string | null;
  /** Montant en euros (devis signé, encaissement réel). */
  valeur?: number | null;
  /** Clé de déduplication : la même étape du même dossier ne compte qu'une fois. */
  evenementId: string;
  /** Horodatage de l'événement métier ; par défaut, maintenant. */
  survenuLe?: Date;
};

export type ResultatConversion = {
  ok: boolean;
  /** Le renvoi n'a pas été tenté : rien n'est configuré. */
  inactif?: boolean;
  recus?: number;
  detail?: string;
  /** Ce qui a été envoyé, sans donnée personnelle en clair : gardé dans la tâche. */
  trace: { evenement: string; evenementId: string; rattachement: "lead_id" | "contact" | "aucun"; valeur?: number; test: boolean };
};

const hacher = (valeur: string): string => createHash("sha256").update(valeur, "utf8").digest("hex");

/** Normalisation Meta avant hachage : minuscules, espaces et ponctuation retirés. */
export function normaliserPourHachage(champ: "em" | "ph" | "fn" | "ln" | "ct" | "zp", valeur: string): string | null {
  const brut = valeur.trim().toLowerCase();
  if (!brut) return null;
  switch (champ) {
    case "em":
      return /.+@.+\..+/.test(brut) ? brut : null;
    case "ph": {
      const international = normaliserTelephone(valeur);
      const chiffres = (international ?? brut).replace(/\D/g, "").replace(/^0+/, "");
      return chiffres.length >= 10 ? chiffres : null;
    }
    case "fn":
    case "ln":
    case "ct":
      return (
        brut
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z]/g, "") || null
      );
    case "zp":
      return brut.replace(/[^a-z0-9]/g, "") || null;
  }
}

function donneesUtilisateur(demande: DemandeConversion): { user_data: Record<string, unknown>; rattachement: "lead_id" | "contact" | "aucun" } {
  const user_data: Record<string, unknown> = {};
  // lead_id : jamais haché, c'est un identifiant Meta.
  if (demande.leadgenId && /^\d{6,}$/.test(demande.leadgenId)) user_data.lead_id = Number(demande.leadgenId);
  const ajouter = (cle: "em" | "ph" | "fn" | "ln" | "ct" | "zp", valeur: string | null | undefined) => {
    if (!valeur) return;
    const normalise = normaliserPourHachage(cle, valeur);
    if (normalise) user_data[cle] = [hacher(normalise)];
  };
  ajouter("em", demande.email);
  ajouter("ph", demande.telephone);
  ajouter("fn", demande.prenom);
  ajouter("ln", demande.nom);
  ajouter("ct", demande.ville);
  ajouter("zp", demande.codePostal);
  if (Object.keys(user_data).length > 0) user_data.country = [hacher("fr")];
  const rattachement = user_data.lead_id ? "lead_id" : user_data.em || user_data.ph ? "contact" : "aucun";
  return { user_data, rattachement };
}

/**
 * Envoie un événement de conversion. Lève en cas d'échec passager (la tâche
 * réessaiera) ; rend `inactif` quand rien n'est configuré, sans rien casser.
 */
export async function envoyerConversion(demande: DemandeConversion): Promise<ResultatConversion> {
  const etape = ETAPES_CONVERSION[demande.etape];
  const { user_data, rattachement } = donneesUtilisateur(demande);
  const test = process.env.META_TEST_EVENT_CODE;
  const trace = { evenement: etape.evenement, evenementId: demande.evenementId, rattachement, valeur: demande.valeur ?? undefined, test: Boolean(test) };

  const pixel = pixelId();
  const token = jetonConversions();
  if (!pixel || !token) return { ok: false, inactif: true, detail: "META_PIXEL_ID ou jeton de conversions absent.", trace };
  if (rattachement === "aucun") return { ok: false, inactif: true, detail: "Aucun identifiant à rattacher (ni lead_id, ni e-mail, ni téléphone).", trace };

  const evenement: Record<string, unknown> = {
    event_name: etape.evenement,
    event_time: Math.floor((demande.survenuLe ?? new Date()).getTime() / 1000),
    action_source: "system_generated",
    event_id: demande.evenementId,
    user_data,
    custom_data: {
      lead_event_source: "CoverSwap CRM",
      event_source: "crm",
      ...(typeof demande.valeur === "number" && demande.valeur > 0 ? { value: Math.round(demande.valeur * 100) / 100, currency: "EUR" } : {}),
    },
  };

  const rep = await fetch(`${GRAPH}/${pixel}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [evenement], access_token: token, ...(test ? { test_event_code: test } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  const texte = await rep.text();
  if (!rep.ok) {
    const message = `Conversion refusée (HTTP ${rep.status}) : ${texte.slice(0, 300)}`;
    // 4xx hors 429 : la charge est en cause, réessayer ne changera rien.
    if (rep.status >= 400 && rep.status < 500 && rep.status !== 429) return { ok: false, detail: message, trace };
    throw new Error(message);
  }
  let recus: number | undefined;
  try {
    recus = (JSON.parse(texte) as { events_received?: number }).events_received;
  } catch {
    /* réponse non JSON : l'appel a réussi malgré tout */
  }
  console.log(`[meta-capi] ${etape.evenement} (${rattachement}) envoyé — reçus : ${recus ?? "?"}${test ? " [test]" : ""}`);
  return { ok: true, recus, trace };
}
