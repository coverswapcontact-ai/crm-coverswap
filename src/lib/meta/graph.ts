import { GRAPH, jetonPage } from "./config";
import { normaliserLeadMeta, type ChampMeta, type LeadMetaNormalise } from "./champs";

/**
 * Les appels à l'API Graph de Meta.
 *
 * Deux principes :
 *  - une erreur qui ne se réglera pas toute seule (permission manquante, lead
 *    inconnu) est distinguée d'une erreur passagère (réseau, 500, limite de
 *    débit) : la première ne doit pas être réessayée indéfiniment, la seconde si ;
 *  - la liste des champs demandés est dégressive : Meta refuse tout l'appel si
 *    un seul champ n'existe pas pour ce jeton. On demande d'abord la liste
 *    riche, puis on retombe sur le strict nécessaire.
 */
export class ErreurGraph extends Error {
  constructor(
    message: string,
    readonly statut: number | null,
    readonly code: number | null,
    readonly sousCode: number | null,
    /** Réessayer plus tard a une chance d'aboutir. */
    readonly passagere: boolean
  ) {
    super(message);
    this.name = "ErreurGraph";
  }
}

/** Codes Meta d'un jeton refusé ou d'une permission absente (190 : session invalide ; 10, 200 : permission ; 102, 3). */
export const CODES_DROITS: readonly number[] = [10, 200, 190, 102, 3];

/** Permission absente ou jeton refusé : c'est à Lucas d'agir côté Meta, pas au serveur de réessayer. */
export function estProblemeDeDroits(erreur: unknown): boolean {
  if (!(erreur instanceof ErreurGraph)) return false;
  return CODES_DROITS.includes(erreur.code ?? -1) || erreur.statut === 401 || erreur.statut === 403;
}

type ReponseErreur = { error?: { message?: string; code?: number; error_subcode?: number; type?: string } };

async function appeler<T>(chemin: string, parametres: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${chemin}`);
  for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur);
  let rep: Response;
  try {
    rep = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (erreur) {
    throw new ErreurGraph(`Appel Graph injoignable : ${String(erreur).slice(0, 160)}`, null, null, null, true);
  }
  const texte = await rep.text();
  let corps: unknown;
  try {
    corps = JSON.parse(texte);
  } catch {
    corps = {};
  }
  if (!rep.ok) {
    const err = (corps as ReponseErreur).error ?? {};
    const code = err.code ?? null;
    // 4/17/32/613 : limites de débit ; 1/2 : pannes passagères de Meta.
    const passagere = rep.status >= 500 || [1, 2, 4, 17, 32, 613].includes(code ?? -1);
    throw new ErreurGraph(err.message ?? `HTTP ${rep.status} ${texte.slice(0, 200)}`, rep.status, code, err.error_subcode ?? null, passagere);
  }
  return corps as T;
}

const CHAMPS_LEAD_RICHES = "id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name,platform,is_organic,custom_disclaimer_responses";
const CHAMPS_LEAD_SURS = "id,created_time,field_data,form_id,ad_id";

export type LeadGraph = {
  normalise: LeadMetaNormalise;
  soumisLe: Date;
  formId: string | null;
  formNom: string | null;
  adId: string | null;
  adNom: string | null;
  adsetId: string | null;
  adsetNom: string | null;
  campagneId: string | null;
  campagneNom: string | null;
  plateforme: string | null;
  organique: boolean;
};

type CorpsLead = {
  id?: string;
  created_time?: string;
  field_data?: ChampMeta[];
  form_id?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
};

/**
 * Lit un lead dans l'API Graph. Demande `leads_retrieval` : sans la permission,
 * l'appel échoue avec un problème de droits (l'événement reste gardé et rejouable).
 */
export async function lireLeadMeta(leadgenId: string): Promise<LeadGraph> {
  const token = jetonPage();
  if (!token) throw new ErreurGraph("META_PAGE_ACCESS_TOKEN absente : impossible de lire le lead.", null, null, null, false);

  let corps: CorpsLead;
  try {
    corps = await appeler<CorpsLead>(leadgenId, { fields: CHAMPS_LEAD_RICHES, access_token: token });
  } catch (erreur) {
    // Un champ refusé fait échouer tout l'appel (code 100) : on retente avec le strict nécessaire.
    if (erreur instanceof ErreurGraph && erreur.code === 100 && !estProblemeDeDroits(erreur)) {
      console.warn(`[meta] champs étendus refusés pour ${leadgenId} (${erreur.message}) : lecture réduite.`);
      corps = await appeler<CorpsLead>(leadgenId, { fields: CHAMPS_LEAD_SURS, access_token: token });
    } else throw erreur;
  }

  const soumis = corps.created_time ? new Date(corps.created_time) : new Date();
  const lead: LeadGraph = {
    normalise: normaliserLeadMeta(corps.field_data ?? []),
    soumisLe: Number.isNaN(soumis.getTime()) ? new Date() : soumis,
    formId: corps.form_id ?? null,
    formNom: null,
    adId: corps.ad_id ?? null,
    adNom: corps.ad_name ?? null,
    adsetId: corps.adset_id ?? null,
    adsetNom: corps.adset_name ?? null,
    campagneId: corps.campaign_id ?? null,
    campagneNom: corps.campaign_name ?? null,
    plateforme: corps.platform ?? null,
    organique: corps.is_organic ?? false,
  };

  // Le nom du formulaire ne vient pas avec le lead : on le demande au formulaire.
  if (lead.formId) lead.formNom = await lireNomFormulaire(lead.formId);

  // Les noms lisibles ne sont pas toujours rendus avec le lead : on les demande à la publicité.
  if (lead.adId && (!lead.campagneNom || !lead.adsetNom || !lead.adNom)) {
    const publicite = await lirePublicite(lead.adId);
    if (publicite) {
      lead.adNom ??= publicite.adNom;
      lead.adsetId ??= publicite.adsetId;
      lead.adsetNom ??= publicite.adsetNom;
      lead.campagneId ??= publicite.campagneId;
      lead.campagneNom ??= publicite.campagneNom;
    }
  }
  return lead;
}

/** Nom du formulaire tel que Lucas l'a nommé dans Meta. Jamais bloquant. */
export async function lireNomFormulaire(formId: string): Promise<string | null> {
  const token = jetonPage();
  if (!token) return null;
  try {
    const corps = await appeler<{ name?: string }>(formId, { fields: "name", access_token: token });
    return corps.name ?? null;
  } catch (erreur) {
    console.warn(`[meta] nom du formulaire ${formId} indisponible : ${(erreur as Error).message}`);
    return null;
  }
}

type CorpsPublicite = { name?: string; adset?: { id?: string; name?: string }; campaign?: { id?: string; name?: string } };

/** Nom lisible de la publicité, de son ensemble et de sa campagne. Jamais bloquant. */
export async function lirePublicite(adId: string): Promise<{ adNom: string | null; adsetId: string | null; adsetNom: string | null; campagneId: string | null; campagneNom: string | null } | null> {
  const token = jetonPage();
  if (!token) return null;
  try {
    const corps = await appeler<CorpsPublicite>(adId, { fields: "name,adset{id,name},campaign{id,name}", access_token: token });
    return {
      adNom: corps.name ?? null,
      adsetId: corps.adset?.id ?? null,
      adsetNom: corps.adset?.name ?? null,
      campagneId: corps.campaign?.id ?? null,
      campagneNom: corps.campaign?.name ?? null,
    };
  } catch (erreur) {
    // Demande `ads_management` : son absence ne doit pas empêcher le lead d'arriver.
    console.warn(`[meta] noms de campagne indisponibles pour ${adId} : ${(erreur as Error).message}`);
    return null;
  }
}

export type EtatJeton = {
  valide: boolean;
  /** Expiration du jeton lui-même ; null = pas d'expiration (jeton de page longue durée). */
  expireLe: string | null;
  /** Expiration de l'accès aux données : au-delà, Meta refuse les lectures tant que personne ne reconnecte. */
  accesExpireLe: string | null;
  portees: string[];
  type: string | null;
  erreur?: string;
};

type CorpsDebug = {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
    type?: string;
    error?: { message?: string };
  };
};

/** État du jeton de page : validité, échéances, portées accordées. */
export async function lireEtatJeton(): Promise<EtatJeton | null> {
  const token = jetonPage();
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!token || !appId || !appSecret) return null;
  try {
    const corps = await appeler<CorpsDebug>("debug_token", { input_token: token, access_token: `${appId}|${appSecret}` });
    const d = corps.data ?? {};
    const date = (secondes?: number) => (secondes && secondes > 0 ? new Date(secondes * 1000).toISOString() : null);
    return {
      valide: Boolean(d.is_valid),
      expireLe: date(d.expires_at),
      accesExpireLe: date(d.data_access_expires_at),
      portees: d.scopes ?? [],
      type: d.type ?? null,
      erreur: d.error?.message,
    };
  } catch (erreur) {
    return { valide: false, expireLe: null, accesExpireLe: null, portees: [], type: null, erreur: (erreur as Error).message };
  }
}

/** Le webhook est-il bien abonné au champ « leadgen » pour la page ? */
export async function abonnementPage(): Promise<{ abonne: boolean; champs: string[]; erreur?: string } | null> {
  const token = jetonPage();
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) return null;
  try {
    const corps = await appeler<{ data?: { subscribed_fields?: string[] }[] }>(`${pageId}/subscribed_apps`, { access_token: token });
    const champs = (corps.data ?? []).flatMap((app) => app.subscribed_fields ?? []);
    return { abonne: champs.includes("leadgen"), champs };
  } catch (erreur) {
    return { abonne: false, champs: [], erreur: (erreur as Error).message };
  }
}
