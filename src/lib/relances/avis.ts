import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import { lireParametre } from "@/lib/parametres/service";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { lecteurDuStop } from "@/lib/sms/conversations";
import { proposerSms } from "@/lib/sms/proposition";

/**
 * Mission 18 (A4) — la demande d'avis après chantier, devenue un type de relance (elle était une séquence de mails,
 * jamais activée, retirée du code). Le chantier est fini (dossier « Facturé » ou « Encaissé ») et le client n'a pas
 * encore donné son avis dans son espace : DELAI_RELANCE_AVIS jours (7 par défaut) après la fin du chantier, le CRM
 * propose le SMS DEMANDE_AVIS avec le lien de son espace (rubrique « Après le chantier »), à copier. Une seule relance
 * par projet, et plus rien au-delà de 60 jours (on ne demande pas un avis sur un chantier oublié).
 *
 * La fin du chantier : le mail « Projet terminé » parti (`notif:PROJET_TERMINE:<dossier>`, l'invitation à laisser un
 * avis, qui reste l'automatisme existant avec son interrupteur), sinon le passage en « Facturé » ou « Encaissé » depuis
 * une étape en cours (ni retour en arrière, ni reprise d'un dossier déjà fini). Rien n'est envoyé ni écrit : la copie
 * du SMS (`noterSmsCopie`, `relance: { type: "AVIS", rang }`) compte la relance. Un numéro en STOP n'a pas de relance
 * (ce n'est qu'un SMS).
 */

export const DELAI_RELANCE_AVIS_DEFAUT_JOURS = 7;
export const RELANCES_AVIS_MAX = 1;
/** Au-delà, plus de demande d'avis (la règle de l'ancienne séquence : 60 jours). */
export const FENETRE_AVIS_JOURS = 60;
const JOUR_MS = 86_400_000;
const ETAPES_FIN = ["FACTURE", "ENCAISSE"];

/** Le délai en vigueur : le paramètre daté DELAI_RELANCE_AVIS, sinon 7 jours. */
export async function lireDelaiRelanceAvis(maintenant: Date = new Date()): Promise<{ jours: number; parametre: boolean }> {
  const valeur = await lireParametre("DELAI_RELANCE_AVIS", maintenant);
  return valeur === null ? { jours: DELAI_RELANCE_AVIS_DEFAUT_JOURS, parametre: false } : { jours: Number(valeur), parametre: true };
}

export type RelanceAvis = {
  dossierId: string;
  espaceId: string;
  clientNom: string;
  /** La fin du chantier : le mail « Projet terminé » parti, sinon le passage en Facturé ou Encaissé. */
  termineLe: string;
  /** Le jour où la demande est devenue proposable (fin du chantier + DELAI_RELANCE_AVIS). */
  proposableLe: string;
  joursDepuisFin: number;
  /** Le mail « Projet terminé » (invitation à laisser un avis) est parti. */
  mailParti: boolean;
  relancesFaites: number;
  rang: number;
  telephone: string | null;
  /** Le SMS à copier, avec le lien de son espace et la relance à compter. */
  sms: PropositionSms | null;
};

/** Une relance d'avis dans la trace d'un SMS copié (`metadata.relance.type === "AVIS"`). */
export function estTraceAvis(metadata: string): boolean {
  try {
    return (JSON.parse(metadata) as { relance?: { type?: unknown } }).relance?.type === "AVIS";
  } catch {
    return false;
  }
}

type Passage = { de?: string | null; vers?: string; nature?: string };

/** Le passage en fin de chantier lu dans un CHANGEMENT_ETAPE : depuis une étape en cours, ni retour ni reprise. */
function passageEnFin(metadata: string): boolean {
  try {
    const m = JSON.parse(metadata) as Passage;
    return Boolean(m.vers && ETAPES_FIN.includes(m.vers) && m.de && !ETAPES_FIN.includes(m.de) && m.nature !== "RETOUR" && m.nature !== "REPRISE");
  } catch {
    return false;
  }
}

/**
 * Les demandes d'avis proposables aujourd'hui (une par projet), de la fin de chantier la plus ancienne à la plus
 * récente. `sms: false` ne prépare pas le SMS (détecteur des tâches, comptes du jour) : `proposerSms` lit l'espace.
 */
export async function relancesAvisProposables(maintenant: Date = new Date(), filtre: { dossierId?: string; sms?: boolean } = {}): Promise<RelanceAvis[]> {
  const delai = (await lireDelaiRelanceAvis(maintenant)).jours;
  const espaces = await prisma.espaceClient.findMany({
    where: { revoqueLe: null, archiveLe: null, avisLe: null, dossier: { archiveLe: null, etape: { in: ETAPES_FIN }, ...(filtre.dossierId ? { id: filtre.dossierId } : {}) } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      permanent: { select: { revoqueLe: true } },
      dossier: { select: { id: true, clientNom: true, clientTelephone: true, lead: { select: { telephone: true } } } },
    },
  });
  const candidats = espaces.filter((e) => !e.permanent?.revoqueLe);
  if (candidats.length === 0) return [];

  const dossierIds = candidats.map((e) => e.dossier.id);
  const [mails, passages, traces, estEnStop] = await Promise.all([
    prisma.envoiMail.findMany({ where: { cle: { in: dossierIds.map((id) => `notif:PROJET_TERMINE:${id}`) }, statut: "ENVOYE" }, select: { dossierId: true, envoyeLe: true, createdAt: true } }),
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, type: "CHANGEMENT_ETAPE" }, orderBy: { createdAt: "desc" }, select: { dossierId: true, metadata: true, createdAt: true, survenuLe: true } }),
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, type: "SMS_COPIE", metadata: { contains: '"type":"AVIS"' } }, select: { dossierId: true, metadata: true } }),
    lecteurDuStop(candidats.flatMap((e) => [e.dossier.lead?.telephone, e.dossier.clientTelephone])),
  ]);

  const resultat: RelanceAvis[] = [];
  for (const espace of candidats) {
    const d = espace.dossier;
    if (estEnStop([d.lead?.telephone, d.clientTelephone])) continue;
    const faites = traces.filter((t) => t.dossierId === d.id && estTraceAvis(t.metadata)).length;
    if (faites >= RELANCES_AVIS_MAX) continue;
    const mail = mails.find((m) => m.dossierId === d.id);
    const passage = passages.find((p) => p.dossierId === d.id && passageEnFin(p.metadata));
    const fin = mail ? (mail.envoyeLe ?? mail.createdAt) : passage ? (passage.survenuLe ?? passage.createdAt) : null;
    if (!fin) continue;
    const age = maintenant.getTime() - fin.getTime();
    if (age < delai * JOUR_MS || age > FENETRE_AVIS_JOURS * JOUR_MS) continue;

    const rang = faites + 1;
    const sms =
      filtre.sms === false
        ? null
        : await proposerSms({ action: "RELANCE_AVIS", dossierId: d.id, relance: { type: "AVIS", rang } }, maintenant).catch((erreur: unknown) => {
            console.error(`[relances] SMS de demande d'avis impossible à préparer pour le dossier ${d.id} :`, erreur);
            return null;
          });
    resultat.push({
      dossierId: d.id,
      espaceId: espace.id,
      clientNom: d.clientNom,
      termineLe: fin.toISOString(),
      proposableLe: new Date(fin.getTime() + delai * JOUR_MS).toISOString(),
      joursDepuisFin: Math.floor(age / JOUR_MS),
      mailParti: Boolean(mail),
      relancesFaites: faites,
      rang,
      telephone: normaliserTelephone(d.lead?.telephone ?? null) ?? normaliserTelephone(d.clientTelephone ?? null),
      sms,
    });
  }
  return resultat.sort((a, b) => a.termineLe.localeCompare(b.termineLe));
}
