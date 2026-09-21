import prisma from "@/lib/prisma";
import { alerter } from "@/lib/alertes/canaux";
import { coutEstime } from "@/lib/simulations/generation";

/**
 * Le compteur de crédit du simulateur : ce que coûtent les générations
 * d'images (site et CRM), ce qu'il reste.
 *
 * L'API d'OpenAI ne donne pas le solde d'un compte à une clé de projet. Le CRM
 * compte donc lui-même : chaque génération enregistre ses jetons et son coût
 * (`GenerationImage`). Le solde s'estime à partir du dernier solde relevé par
 * Lucas (paramètre daté « Crédit OpenAI »), moins ce qui a été consommé depuis.
 * Avec une clé d'administration (OPENAI_ADMIN_KEY, facultative), le coût réel
 * du mois est lu chez OpenAI en plus.
 */

export const SEUIL_ALERTE_DOLLARS = 2;

export type Consommation = {
  mois: { total: number; site: number; crm: number; generations: number; echecs: number };
  solde: { releve: number; releveLe: string; consommeDepuis: number; estime: number; simulationsRestantes: number } | null;
  reelOpenAI: { mois: number; lu: string } | null;
  /** La dernière génération a été refusée faute de crédit (ou clé refusée), sans réussite depuis. */
  creditEpuise: { le: string } | null;
};

function debutDuMois(maintenant: Date): Date {
  const [annee, mois] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(maintenant).split("-").map(Number);
  // Minuit à Paris le 1er du mois : 22 h ou 23 h UTC la veille selon l'heure d'été.
  const utc = new Date(Date.UTC(annee, mois - 1, 1, 0, 0, 0));
  const decalage = new Date(utc.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getTime() - new Date(utc.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(utc.getTime() - decalage);
}

let reelEnCache: { mois: number; lu: string; expire: number } | null = null;

async function coutReelDuMois(depuis: Date): Promise<{ mois: number; lu: string } | null> {
  const cle = process.env.OPENAI_ADMIN_KEY?.trim();
  if (!cle) return null;
  if (reelEnCache && reelEnCache.expire > Date.now()) return { mois: reelEnCache.mois, lu: reelEnCache.lu };
  try {
    const reponse = await fetch(`https://api.openai.com/v1/organization/costs?start_time=${Math.floor(depuis.getTime() / 1000)}&limit=31`, { headers: { Authorization: `Bearer ${cle}` }, signal: AbortSignal.timeout(6000) });
    if (!reponse.ok) return null;
    const donnees = (await reponse.json()) as { data?: { results?: { amount?: { value?: number } }[] }[] };
    const total = (donnees.data ?? []).flatMap((b) => b.results ?? []).reduce((s, r) => s + (Number(r.amount?.value) || 0), 0);
    reelEnCache = { mois: Math.round(total * 100) / 100, lu: new Date().toISOString(), expire: Date.now() + 3_600_000 };
    return { mois: reelEnCache.mois, lu: reelEnCache.lu };
  } catch {
    return null;
  }
}

export async function consommation(maintenant: Date = new Date()): Promise<Consommation> {
  const debut = debutDuMois(maintenant);
  const [lignes, releve, dernierEchec, derniereReussite] = await Promise.all([
    prisma.generationImage.findMany({ where: { createdAt: { gte: debut } }, select: { origine: true, statut: true, coutDollars: true } }),
    prisma.parametre.findFirst({ where: { cle: "SIMULATEUR_CREDIT_OPENAI", valableDu: { lte: maintenant } }, orderBy: [{ valableDu: "desc" }, { createdAt: "desc" }], select: { valeur: true, valableDu: true } }),
    prisma.generationImage.findFirst({ where: { statut: "ECHEC", erreur: { startsWith: "service-indisponible" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.generationImage.findFirst({ where: { statut: "REUSSI" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const somme = (filtre: (l: (typeof lignes)[number]) => boolean) => Math.round(lignes.filter(filtre).reduce((s, l) => s + (l.coutDollars ?? 0), 0) * 100) / 100;
  let solde: Consommation["solde"] = null;
  if (releve) {
    const valeur = Number(JSON.parse(releve.valeur));
    const depuis = await prisma.generationImage.aggregate({ where: { createdAt: { gte: releve.valableDu } }, _sum: { coutDollars: true } });
    const consommeDepuis = Math.round((depuis._sum.coutDollars ?? 0) * 100) / 100;
    const estime = Math.round((valeur - consommeDepuis) * 100) / 100;
    solde = { releve: valeur, releveLe: releve.valableDu.toISOString(), consommeDepuis, estime, simulationsRestantes: Math.max(0, Math.floor(estime / coutEstime(2))) };
  }
  return {
    mois: { total: somme(() => true), site: somme((l) => l.origine === "SITE"), crm: somme((l) => l.origine === "CRM"), generations: lignes.filter((l) => l.statut === "REUSSI").length, echecs: lignes.filter((l) => l.statut === "ECHEC").length },
    solde,
    reelOpenAI: await coutReelDuMois(debut),
    creditEpuise: dernierEchec && (!derniereReussite || derniereReussite.createdAt < dernierEchec.createdAt) ? { le: dernierEchec.createdAt.toISOString() } : null,
  };
}

let derniereAlerteSolde = 0;

/** Travail périodique : prévient une fois par jour quand le solde estimé passe sous le seuil. */
export async function surveillerCredit(maintenant: Date = new Date()): Promise<{ alerte: boolean }> {
  const etat = await consommation(maintenant);
  if (!etat.solde || etat.solde.estime >= SEUIL_ALERTE_DOLLARS) return { alerte: false };
  if (maintenant.getTime() - derniereAlerteSolde < 24 * 3_600_000) return { alerte: false };
  derniereAlerteSolde = maintenant.getTime();
  await alerter(
    {
      titre: "Crédit OpenAI presque épuisé",
      texte: `Solde estimé : ${etat.solde.estime.toFixed(2).replace(".", ",")} $ (relevé ${etat.solde.releve} $ le ${new Date(etat.solde.releveLe).toLocaleDateString("fr-FR")}, ${etat.solde.consommeDepuis.toFixed(2).replace(".", ",")} $ consommés depuis). À recharger sur platform.openai.com, puis noter le nouveau solde dans Paramètres.`,
      lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/simulateur`,
      libelleLien: "Ouvrir le simulateur",
      urgence: 4,
      etiquette: "credit-openai",
    },
    { origine: "simulateur", canaux: ["telegram", "ntfy", "pushweb"] }
  ).catch(() => undefined);
  return { alerte: true };
}
