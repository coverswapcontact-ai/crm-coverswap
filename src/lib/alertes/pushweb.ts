import webpush from "web-push";
import type { ResultatCanal } from "./configuration";
import { decrireErreur } from "./reseau";

/**
 * Notifications poussées du navigateur (application installée sur le téléphone).
 *
 * Troisième canal poussé, à côté de ntfy et de Telegram — jamais à leur place :
 * iOS peut retarder un push web pour économiser la batterie. Les trois partent
 * toujours ensemble.
 *
 * Clés VAPID : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si elles sont posées, sinon
 * une paire générée une fois et gardée en base (CleInterne, hors journal).
 * Un abonnement que le navigateur a révoqué (HTTP 404 ou 410) est archivé.
 */
export type ChargePush = { titre: string; texte: string; lien?: string; etiquette?: string; badge?: number };

const memoire = globalThis as unknown as { __pushWebAbonnes?: number; __vapid?: { publique: string; privee: string } };

/** Nombre d'appareils abonnés, tel que connu du processus (mis à jour à chaque envoi et à chaque abonnement). */
export function appareilsAbonnesConnus(): number {
  return memoire.__pushWebAbonnes ?? 0;
}

async function base() {
  return (await import("@/lib/prisma")).default;
}

export async function clesVapid(): Promise<{ publique: string; privee: string }> {
  if (memoire.__vapid) return memoire.__vapid;
  const publiqueEnv = process.env.VAPID_PUBLIC_KEY?.trim();
  const priveeEnv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publiqueEnv && priveeEnv) return (memoire.__vapid = { publique: publiqueEnv, privee: priveeEnv });

  const prisma = await base();
  const lire = async () => {
    const lignes = await prisma.cleInterne.findMany({ where: { nom: { in: ["vapid-publique", "vapid-privee"] } } });
    const publique = lignes.find((l) => l.nom === "vapid-publique")?.valeur;
    const privee = lignes.find((l) => l.nom === "vapid-privee")?.valeur;
    return publique && privee ? { publique, privee } : null;
  };
  const connues = await lire();
  if (connues) return (memoire.__vapid = connues);
  const paire = webpush.generateVAPIDKeys();
  try {
    await prisma.$transaction([
      prisma.cleInterne.create({ data: { nom: "vapid-publique", valeur: paire.publicKey } }),
      prisma.cleInterne.create({ data: { nom: "vapid-privee", valeur: paire.privateKey } }),
    ]);
    return (memoire.__vapid = { publique: paire.publicKey, privee: paire.privateKey });
  } catch {
    // Deux requêtes ont généré en même temps : la première écrite fait foi.
    const gagnantes = await lire();
    if (gagnantes) return (memoire.__vapid = gagnantes);
    throw new Error("Clés VAPID illisibles.");
  }
}

export type Abonnement = { endpoint: string; p256dh: string; auth: string; application?: string; utilisateur?: string | null; appareil?: string | null };

export async function enregistrerAbonnement(abonnement: Abonnement): Promise<void> {
  const prisma = await base();
  const donnees = {
    p256dh: abonnement.p256dh,
    auth: abonnement.auth,
    application: abonnement.application === "messages" ? "messages" : "crm",
    utilisateur: abonnement.utilisateur ?? null,
    appareil: abonnement.appareil?.slice(0, 200) ?? null,
    echecs: 0,
    archiveLe: null,
    archiveMotif: null,
  };
  await prisma.abonnementPush.upsert({ where: { endpoint: abonnement.endpoint }, create: { endpoint: abonnement.endpoint, ...donnees }, update: donnees });
  memoire.__pushWebAbonnes = await prisma.abonnementPush.count();
}

export async function retirerAbonnement(endpoint: string): Promise<void> {
  const prisma = await base();
  await prisma.abonnementPush.updateMany({ where: { endpoint, archiveLe: null }, data: { archiveLe: new Date(), archiveMotif: "Désabonné depuis l'appareil" } });
  memoire.__pushWebAbonnes = await prisma.abonnementPush.count();
}

/** À appeler au démarrage : le nombre d'abonnés sert à l'état des canaux (sonde de santé comprise). */
export async function compterAbonnes(): Promise<number> {
  const prisma = await base();
  return (memoire.__pushWebAbonnes = await prisma.abonnementPush.count());
}

/**
 * Envoie à tous les appareils abonnés. `application` privilégie une icône :
 * un SMS reçu sonne sur « Messages » si elle est installée, sinon sur le CRM.
 */
export async function envoyerPushWeb(charge: ChargePush, options: { application?: "crm" | "messages" } = {}): Promise<ResultatCanal> {
  const prisma = await base();
  let abonnes;
  try {
    abonnes = await prisma.abonnementPush.findMany();
  } catch (erreur) {
    return { canal: "pushweb", ok: false, configure: false, detail: `abonnements illisibles : ${decrireErreur(erreur)}` };
  }
  memoire.__pushWebAbonnes = abonnes.length;
  if (abonnes.length === 0) return { canal: "pushweb", ok: false, configure: false, detail: "non configuré — aucun appareil abonné (installer l'application puis activer les notifications)" };

  const preferes = options.application ? abonnes.filter((a) => a.application === options.application) : [];
  const cibles = preferes.length > 0 ? preferes : abonnes;
  const cles = await clesVapid();
  let badge = charge.badge;
  if (badge === undefined) {
    try {
      badge = (await prisma.conversationSms.aggregate({ _sum: { nonLus: true } }))._sum.nonLus ?? 0;
    } catch {
      badge = undefined;
    }
  }
  // Dans « Messages », une conversation s'ouvre dans la messagerie seule, pas dans le CRM complet.
  const lienPour = (application: string) => (application === "messages" && charge.lien ? charge.lien.replace(/\/sms(\?|$)/, "/messagerie$1") : charge.lien);
  const sujet = process.env.VAPID_SUJET?.trim() || "mailto:contact@coverswap.fr";
  let reussis = 0;
  const echecs: string[] = [];
  await Promise.all(
    cibles.map(async (abonne) => {
      try {
        await webpush.sendNotification({ endpoint: abonne.endpoint, keys: { p256dh: abonne.p256dh, auth: abonne.auth } }, JSON.stringify({ ...charge, lien: lienPour(abonne.application), badge }), {
          vapidDetails: { subject: sujet, publicKey: cles.publique, privateKey: cles.privee },
          TTL: 60 * 60 * 12,
          urgency: "high",
          timeout: 10_000,
        });
        reussis++;
        await prisma.abonnementPush.update({ where: { id: abonne.id }, data: { dernierEnvoiLe: new Date(), echecs: 0 } });
      } catch (erreur) {
        const statut = (erreur as { statusCode?: number }).statusCode;
        if (statut === 404 || statut === 410) {
          await prisma.abonnementPush.update({ where: { id: abonne.id }, data: { archiveLe: new Date(), archiveMotif: `Abonnement révoqué par le navigateur (HTTP ${statut})` } });
          echecs.push(`appareil désabonné (HTTP ${statut})`);
        } else {
          await prisma.abonnementPush.update({ where: { id: abonne.id }, data: { echecs: { increment: 1 } } }).catch(() => undefined);
          echecs.push(statut ? `HTTP ${statut}` : decrireErreur(erreur).slice(0, 160));
        }
      }
    })
  );
  if (reussis > 0) return { canal: "pushweb", ok: true, configure: true, detail: `${reussis} appareil(s)${echecs.length ? ` ; ${echecs.length} en échec` : ""}` };
  return { canal: "pushweb", ok: false, configure: true, detail: echecs.join(" ; ").slice(0, 400) || "aucun appareil joint" };
}
