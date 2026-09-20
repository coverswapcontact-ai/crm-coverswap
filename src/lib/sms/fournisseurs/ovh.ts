import { createHash } from "node:crypto";
import { EchecDefinitifSms, type AccuseEnvoi, type DemandeEnvoi, type EtatDistant, type FournisseurSms, type SmsEntrant } from "./types";

/**
 * OVHcloud SMS — numéro « Time2Chat » (numéro en 09 réservé par l'ARCEP aux
 * échanges professionnels) : le client répond au même numéro, et la réponse se
 * relève par l'API. C'est la voie conforme pour du SMS bidirectionnel en France
 * depuis que les 06/07 sont interdits aux plateformes.
 *
 *   POST /sms/{service}/virtualNumbers/{numero}/jobs       envoi
 *   GET  /sms/{service}/virtualNumbers/{numero}/incoming   relève des réponses
 *   GET  /sms/{service}/virtualNumbers/{numero}/outgoing/{id}  état de remise
 *
 * Variables : OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET, OVH_CONSUMER_KEY,
 * OVH_SMS_SERVICE (sms-xx00000-1), OVH_SMS_NUMERO (le numéro Time2Chat).
 * OVH_API_URL ne sert qu'aux essais (simulateur local).
 */
const VARIABLES = ["OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY", "OVH_SMS_SERVICE", "OVH_SMS_NUMERO"] as const;

export function variablesOvhManquantes(env: NodeJS.ProcessEnv = process.env): string[] {
  return VARIABLES.filter((nom) => !env[nom]?.trim());
}

type Reglages = { base: string; cleApplication: string; secretApplication: string; cleConsommateur: string; service: string; numero: string };

function reglages(): Reglages {
  const manquantes = variablesOvhManquantes();
  if (manquantes.length > 0) throw new EchecDefinitifSms(`OVH non configuré : ${manquantes.join(", ")} absente(s).`);
  return {
    base: (process.env.OVH_API_URL || "https://eu.api.ovh.com/1.0").replace(/\/$/, ""),
    cleApplication: process.env.OVH_APPLICATION_KEY!.trim(),
    secretApplication: process.env.OVH_APPLICATION_SECRET!.trim(),
    cleConsommateur: process.env.OVH_CONSUMER_KEY!.trim(),
    service: process.env.OVH_SMS_SERVICE!.trim(),
    numero: process.env.OVH_SMS_NUMERO!.trim(),
  };
}

// L'horloge d'OVH fait foi pour la signature : l'écart avec la nôtre se mesure une fois.
let decalageHorloge: number | null = null;

async function horodatage(base: string): Promise<number> {
  if (decalageHorloge === null) {
    try {
      const reponse = await fetch(`${base}/auth/time`, { signal: AbortSignal.timeout(8000) });
      decalageHorloge = Number(await reponse.text()) - Math.floor(Date.now() / 1000);
      if (!Number.isFinite(decalageHorloge)) decalageHorloge = 0;
    } catch {
      decalageHorloge = 0;
    }
  }
  return Math.floor(Date.now() / 1000) + decalageHorloge;
}

/** Signature d'un appel OVH : "$1$" + SHA1(secret+clé consommateur+méthode+URL+corps+horodatage). Exportée pour l'essai. */
export function signerAppelOvh(secret: string, cleConsommateur: string, methode: string, url: string, corps: string, temps: number): string {
  return `$1$${createHash("sha1").update([secret, cleConsommateur, methode, url, corps, temps].join("+")).digest("hex")}`;
}

async function appeler<T>(methode: "GET" | "POST", chemin: string, corps?: unknown): Promise<T> {
  const r = reglages();
  const url = `${r.base}${chemin}`;
  const texte = corps === undefined ? "" : JSON.stringify(corps);
  const temps = await horodatage(r.base);
  const reponse = await fetch(url, {
    method: methode,
    headers: {
      "Content-Type": "application/json",
      "X-Ovh-Application": r.cleApplication,
      "X-Ovh-Consumer": r.cleConsommateur,
      "X-Ovh-Timestamp": String(temps),
      "X-Ovh-Signature": signerAppelOvh(r.secretApplication, r.cleConsommateur, methode, url, texte, temps),
    },
    body: corps === undefined ? undefined : texte,
    signal: AbortSignal.timeout(15_000),
  });
  const retour = await reponse.text();
  if (!reponse.ok) {
    const message = `OVH ${methode} ${chemin.replace(r.service, "<service>")} : HTTP ${reponse.status} ${retour.slice(0, 300)}`;
    // Clé refusée, droits insuffisants, service inconnu : réessayer ne changera rien.
    if ([400, 401, 403, 404].includes(reponse.status)) throw new EchecDefinitifSms(message);
    throw new Error(message);
  }
  return (retour ? JSON.parse(retour) : null) as T;
}

const racine = () => {
  const r = reglages();
  return `/sms/${encodeURIComponent(r.service)}/virtualNumbers/${encodeURIComponent(r.numero)}`;
};

type RapportEnvoi = { ids: number[]; invalidReceivers: string[]; validReceivers: string[]; totalCreditsRemoved: number };
type Sortant = { id: number; deliveredAt?: string | null; deliveryReceipt?: number | null; ptt?: number | null; sentAt?: string | null; numberOfSms?: number | null };
type Entrant = { id: number; sender: string; message: string; creationDatetime: string };

export const fournisseurOvh: FournisseurSms = {
  nom: "ovh",
  bidirectionnel: true,
  expediteur: () => process.env.OVH_SMS_NUMERO?.trim() || "numéro OVH non configuré",

  async envoyer(demande: DemandeEnvoi): Promise<AccuseEnvoi> {
    const rapport = await appeler<RapportEnvoi>("POST", `${racine()}/jobs`, {
      message: demande.texte,
      receivers: [demande.numero],
      charset: "UTF-8",
      coding: "7bit",
      priority: "high",
      tag: demande.reference.slice(0, 20),
    });
    if (rapport.invalidReceivers?.length || !rapport.ids?.length) throw new EchecDefinitifSms(`OVH refuse le destinataire ${demande.numero.slice(0, 6)}… (numéro invalide ou non joignable).`);
    return { identifiant: String(rapport.ids[0]), credits: rapport.totalCreditsRemoved };
  },

  async releverEntrants(depuis: Date): Promise<SmsEntrant[]> {
    const ids = await appeler<number[]>("GET", `${racine()}/incoming?creationDatetime.from=${encodeURIComponent(depuis.toISOString())}`);
    const messages: SmsEntrant[] = [];
    for (const id of ids ?? []) {
      const entrant = await appeler<Entrant>("GET", `${racine()}/incoming/${id}`);
      messages.push({ identifiant: String(entrant.id), numero: entrant.sender, texte: entrant.message ?? "", recuLe: new Date(entrant.creationDatetime) });
    }
    return messages.sort((a, b) => a.recuLe.getTime() - b.recuLe.getTime());
  },

  async etat(identifiant: string): Promise<EtatDistant | null> {
    let sortant: Sortant;
    try {
      sortant = await appeler<Sortant>("GET", `${racine()}/outgoing/${encodeURIComponent(identifiant)}`);
    } catch (erreur) {
      // Pas encore dans l'historique : l'envoi est toujours en file chez OVH.
      if (erreur instanceof EchecDefinitifSms && /HTTP 404/.test(erreur.message)) return null;
      throw erreur;
    }
    if (sortant.deliveredAt || sortant.deliveryReceipt === 1 || sortant.ptt === 1) return { statut: "DELIVRE", le: sortant.deliveredAt ? new Date(sortant.deliveredAt) : undefined };
    if (sortant.deliveryReceipt === 2 || sortant.deliveryReceipt === 16) return { statut: "ECHEC", detail: `non remis par l'opérateur (accusé ${sortant.deliveryReceipt}, état ${sortant.ptt ?? "?"})` };
    return { statut: "ENVOYE", le: sortant.sentAt ? new Date(sortant.sentAt) : undefined };
  },
};
