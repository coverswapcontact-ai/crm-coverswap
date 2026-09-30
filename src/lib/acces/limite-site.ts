/**
 * Limite anti-abus du webhook du site, côté CRM (le rate-limit du site tourne
 * en mémoire sur des fonctions Vercel éphémères : il ne tient pas).
 *
 * Deux gardes, sans dépendance :
 *   - par adresse IP du visiteur (en-tête X-Visiteur-Ip posé par le site, ou
 *     l'adresse de l'appelant) : compteur en mémoire, fenêtre glissante ;
 *   - par contact (téléphone / e-mail) : compte en base, fenêtre d'une heure,
 *     calculé par l'appelant et jugé ici.
 */

export const LIMITE_PAR_IP = { max: 12, fenetreMs: 10 * 60 * 1000 };
export const LIMITE_PAR_CONTACT = { max: 6, fenetreMs: 60 * 60 * 1000 };

const compteursIp = new Map<string, number[]>();

/** Vrai si l'IP a dépassé sa limite ; enregistre l'appel sinon. */
export function ipDepasseLaLimite(ip: string, maintenant: number = Date.now(), max: number = LIMITE_PAR_IP.max): boolean {
  const debut = maintenant - LIMITE_PAR_IP.fenetreMs;
  const appels = (compteursIp.get(ip) ?? []).filter((t) => t > debut);
  if (appels.length >= max) {
    compteursIp.set(ip, appels);
    return true;
  }
  appels.push(maintenant);
  compteursIp.set(ip, appels);
  if (compteursIp.size > 5000) {
    for (const [cle, valeurs] of compteursIp) if (!valeurs.some((t) => t > debut)) compteursIp.delete(cle);
  }
  return false;
}

/** Vrai si un même contact a déjà envoyé trop de demandes dans la fenêtre. */
export function contactDepasseLaLimite(nombreRecent: number): boolean {
  return nombreRecent >= LIMITE_PAR_CONTACT.max;
}

/** Simulations par jour : par adresse IP et pour tout le site (budget OpenAI). */
export const LIMITE_SIMULATIONS = { parIp: 15, global: 150 };
const simulationsParIp = new Map<string, { jour: string; nombre: number }>();
let simulationsGlobales = { jour: "", nombre: 0 };

function jourDe(maintenant: number): string {
  return new Date(maintenant).toISOString().slice(0, 10);
}

/** Vrai si une nouvelle simulation est autorisée pour cette IP aujourd'hui ; la compte si oui. */
export function simulationAutorisee(ip: string, maintenant: number = Date.now()): { ok: boolean; raison?: "ip" | "global" } {
  const jour = jourDe(maintenant);
  if (simulationsGlobales.jour !== jour) {
    simulationsGlobales = { jour, nombre: 0 };
    simulationsParIp.clear();
  }
  if (simulationsGlobales.nombre >= LIMITE_SIMULATIONS.global) return { ok: false, raison: "global" };
  const entree = simulationsParIp.get(ip) ?? { jour, nombre: 0 };
  if (entree.nombre >= LIMITE_SIMULATIONS.parIp) return { ok: false, raison: "ip" };
  simulationsParIp.set(ip, { jour, nombre: entree.nombre + 1 });
  simulationsGlobales.nombre += 1;
  return { ok: true };
}

/** Rend une simulation comptée à tort : la génération a échoué pour une raison qui est de notre côté. */
export function rendreSimulation(ip: string, maintenant: number = Date.now()): void {
  if (simulationsGlobales.jour !== jourDe(maintenant)) return;
  const entree = simulationsParIp.get(ip);
  if (entree && entree.nombre > 0) simulationsParIp.set(ip, { ...entree, nombre: entree.nombre - 1 });
  if (simulationsGlobales.nombre > 0) simulationsGlobales.nombre -= 1;
}

/**
 * Mission 15 (partie 2) : analyses de photos par jour, par adresse et pour tout le site (un appel vision d'un
 * demi-centime chacune, et une photo écrite sur le volume en attendant la tâche). Ne compte que ce qui est
 * réellement mis en file : une photo refusée ou une analyse déjà prête ne consomme rien (`demanderAnalyseSite`).
 * Mission 15 (partie 5) : l'espace client compte de même, par dossier (`parEspace`), sous le même plafond global.
 */
export const LIMITE_ANALYSES = { parIp: 10, parEspace: 20, global: 400 };
const analysesParIp = new Map<string, { jour: string; nombre: number }>();
let analysesGlobales = { jour: "", nombre: 0 };

/** Une nouvelle analyse de photo est-elle autorisée pour cette clé (IP du site, dossier de l'espace) aujourd'hui ? La compte si oui. */
export function analyseAutorisee(ip: string, maintenant: number = Date.now(), max: number = LIMITE_ANALYSES.parIp): { ok: boolean; raison?: "ip" | "global" } {
  const jour = jourDe(maintenant);
  if (analysesGlobales.jour !== jour) {
    analysesGlobales = { jour, nombre: 0 };
    analysesParIp.clear();
  }
  if (analysesGlobales.nombre >= LIMITE_ANALYSES.global) return { ok: false, raison: "global" };
  const entree = analysesParIp.get(ip);
  const nombre = entree && entree.jour === jour ? entree.nombre : 0;
  if (nombre >= max) return { ok: false, raison: "ip" };
  analysesParIp.set(ip, { jour, nombre: nombre + 1 });
  analysesGlobales.nombre += 1;
  return { ok: true };
}

/** IP du visiteur : celle que le site transmet, sinon celle de l'appelant. */
export function ipDuVisiteur(entetes: { get(nom: string): string | null }): string {
  const transmise = entetes.get("x-visiteur-ip")?.trim();
  if (transmise && /^[0-9a-fA-F.:]{3,45}$/.test(transmise)) return transmise;
  return entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || entetes.get("x-real-ip") || "inconnue";
}

/** Adresse privée, locale ou interne à l'hébergeur (jamais celle d'un visiteur d'Internet). */
export function estIpInterne(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(v);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return v === "::1" || v === "::" || /^f[cd][0-9a-f]{2}:/.test(v) || /^fe[89ab][0-9a-f]:/.test(v);
}

/**
 * Mission 17 (relecture B, point 8) — l'IP du CLIENT d'une route appelée DIRECTEMENT par le navigateur (mesure du site :
 * /api/site/evenements). Même règle que `ipDuVisiteur` quand la chaîne X-Forwarded-For est honnête (« client, proxy
 * interne » → le client), mais lue par la DROITE : la première adresse publique en partant de la fin est celle qu'a
 * ajoutée le proxy de Railway (l'appelant réel de son point d'entrée) ; tout ce qui la précède a pu être écrit par le
 * navigateur lui-même (« 1.2.3.4, <IP réelle> » : l'IP réelle est retenue, la fausse ignorée). Sans adresse publique
 * (développement, réseau interne) : X-Real-IP, puis la première valeur. L'en-tête X-Visiteur-Ip (posé par le serveur
 * du site dans `ipDuVisiteur`) n'est PAS lu ici : un navigateur pourrait l'écrire.
 */
export function ipDuClient(entetes: { get(nom: string): string | null }): string {
  const chaine = (entetes.get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter((v) => /^[0-9a-fA-F.:]{3,45}$/.test(v));
  for (let i = chaine.length - 1; i >= 0; i--) if (!estIpInterne(chaine[i])) return chaine[i];
  const reelle = entetes.get("x-real-ip")?.trim();
  if (reelle && /^[0-9a-fA-F.:]{3,45}$/.test(reelle)) return reelle;
  return chaine[0] || "inconnue";
}
