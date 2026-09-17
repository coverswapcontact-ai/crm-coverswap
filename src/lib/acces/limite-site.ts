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

/** IP du visiteur : celle que le site transmet, sinon celle de l'appelant. */
export function ipDuVisiteur(entetes: { get(nom: string): string | null }): string {
  const transmise = entetes.get("x-visiteur-ip")?.trim();
  if (transmise && /^[0-9a-fA-F.:]{3,45}$/.test(transmise)) return transmise;
  return entetes.get("x-forwarded-for")?.split(",")[0]?.trim() || entetes.get("x-real-ip") || "inconnue";
}
