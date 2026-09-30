import prisma from "@/lib/prisma";
import { photosDuClient } from "@/lib/espace/service";
import { dossiersAvecSimulation } from "@/lib/espace/simulations-faites";
import { liensEnvoyes } from "@/lib/espace/suivi";
import { lireParametre } from "@/lib/parametres/service";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { lecteurDuStop } from "@/lib/sms/conversations";
import { proposerSms } from "@/lib/sms/proposition";

/**
 * Mission 14 (29/09/2026), partie 6 — la relance photos : un espace ouvert
 * depuis DELAI_RELANCE_PHOTOS jours (3 par défaut) sans aucune photo du client
 * ni aucune simulation fait proposer le SMS avec le lien de son espace, à
 * copier (LIEN_ESPACE_RAPPEL ; LIEN_ESPACE si aucun lien ne lui a jamais été
 * communiqué). Rien n'est envoyé ni écrit : la liste est calculée ; la copie
 * (`noterSmsCopie`, `relance: { type: "PHOTOS", rang }`) compte la relance,
 * deux au plus par projet.
 *
 * Une simulation compte d'où qu'elle vienne (`dossiersAvecSimulation`, la règle
 * partagée avec le libellé de l'écran Espaces) : celui qui en a fait une n'est
 * jamais relancé pour ses photos, ni dit « en attente de ses photos ». Un
 * numéro qui a répondu STOP n'a pas de relance photos (ce n'est qu'un SMS).
 */

export const DELAI_RELANCE_PHOTOS_DEFAUT_JOURS = 3;
export const RELANCES_PHOTOS_MAX = 2;
const JOUR_MS = 86_400_000;
const ETAPES_PHOTOS = ["QUALIFICATION", "SIMULATION"];

/** Le délai en vigueur : le paramètre daté DELAI_RELANCE_PHOTOS, sinon 3 jours. */
export async function lireDelaiRelancePhotos(maintenant: Date = new Date()): Promise<{ jours: number; parametre: boolean }> {
  const valeur = await lireParametre("DELAI_RELANCE_PHOTOS", maintenant);
  return valeur === null ? { jours: DELAI_RELANCE_PHOTOS_DEFAUT_JOURS, parametre: false } : { jours: Number(valeur), parametre: true };
}

export type RelancePhotos = {
  dossierId: string;
  espaceId: string;
  clientNom: string;
  /** Création de l'espace du projet. */
  ouvertLe: string;
  joursDepuisOuverture: number;
  /** D'où court le délai : la plus récente de l'ouverture, du dernier lien communiqué et de la dernière relance photos. */
  referenceLe: string;
  /** Un texte portant le lien de son espace est parti (SMS, mail, SMS copié, lien rendu par l'assistant). */
  lienCommunique: boolean;
  relancesFaites: number;
  rang: number;
  /** Le SMS à copier, avec le lien et la relance à compter. */
  sms: PropositionSms | null;
};

function relancePhotos(metadata: string): boolean {
  try {
    const relance = (JSON.parse(metadata) as { relance?: { type?: unknown } }).relance;
    return relance?.type === "PHOTOS";
  } catch {
    return false;
  }
}

/**
 * Les relances photos proposables aujourd'hui (une par projet d'espace), de la plus ancienne ouverture à la plus
 * récente. `delai` (partie 8, filtre « sans photo ni simulation depuis N jours » de l'assistant) remplace
 * DELAI_RELANCE_PHOTOS : la même règle, avec N à la place du paramètre.
 * Mission 17 (partie A) : `sms: false` ne prépare pas le SMS (`sms` vaut null). Le détecteur des tâches s'en sert :
 * `proposerSms` ouvre l'espace s'il le faut (un projet d'avant l'espace permanent, un dossier sans fiche client : il
 * ÉCRIT), et un détecteur ne doit rien écrire ; le SMS se prépare quand Lucas ouvre le raccourci.
 */
export async function relancesPhotosProposables(maintenant: Date = new Date(), filtre: { dossierId?: string; delai?: number; sms?: boolean } = {}): Promise<RelancePhotos[]> {
  const delai = filtre.delai ?? (await lireDelaiRelancePhotos(maintenant)).jours;
  const espaces = await prisma.espaceClient.findMany({
    where: { revoqueLe: null, archiveLe: null, dossier: { archiveLe: null, etape: { in: ETAPES_PHOTOS }, ...(filtre.dossierId ? { id: filtre.dossierId } : {}) } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      createdAt: true,
      permanent: { select: { code: true, revoqueLe: true } },
      dossier: { select: { id: true, clientNom: true, clientId: true, leadId: true, clientTelephone: true, photos: true, lead: { select: { telephone: true } }, accords: { where: { retireLe: null }, take: 1, select: { id: true } } } },
    },
  });
  const candidats = espaces.filter((e) => !e.permanent?.revoqueLe && e.dossier.accords.length === 0);
  if (candidats.length === 0) return [];

  const dossierIds = candidats.map((e) => e.dossier.id);
  const [avecSimulation, estEnStop, relances, liens] = await Promise.all([
    dossiersAvecSimulation(candidats.map((e) => e.dossier)),
    lecteurDuStop(candidats.flatMap((e) => [e.dossier.lead?.telephone, e.dossier.clientTelephone])),
    prisma.dossierEvenement.findMany({ where: { dossierId: { in: dossierIds }, type: "SMS_COPIE", metadata: { contains: "PHOTOS" } }, orderBy: { createdAt: "desc" }, select: { dossierId: true, metadata: true, createdAt: true } }),
    liensEnvoyes(),
  ]);

  const resultat: RelancePhotos[] = [];
  for (const espace of candidats) {
    const d = espace.dossier;
    if (avecSimulation.has(d.id)) continue;
    if (estEnStop([d.lead?.telephone, d.clientTelephone])) continue;
    if ((await photosDuClient(d.id, d.photos)).length > 0) continue;

    const faites = relances.filter((r) => r.dossierId === d.id && relancePhotos(r.metadata));
    if (faites.length >= RELANCES_PHOTOS_MAX) continue;
    // Le lien du client (son espace permanent), celui d'avant « Nouveau lien » compris ; avant le 22/09, celui du projet.
    const codes = [espace.permanent?.code, espace.code].filter((c): c is string => Boolean(c)).map((c) => `/e/${c}-`);
    const envois = liens.filter((l) => codes.some((c) => l.texte.includes(c)));
    const reference = [espace.createdAt, envois.at(-1)?.createdAt, faites[0]?.createdAt].filter((x): x is Date => Boolean(x)).reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
    if (maintenant.getTime() - reference.getTime() < delai * JOUR_MS) continue;

    const rang = faites.length + 1;
    const sms =
      filtre.sms === false
        ? null
        : await proposerSms({ action: "RELANCE_PHOTOS", dossierId: d.id, relance: { type: "PHOTOS", rang } }, maintenant).catch((erreur: unknown) => {
            console.error(`[relances] SMS de relance photos impossible à préparer pour le dossier ${d.id} :`, erreur);
            return null;
          });
    resultat.push({
      dossierId: d.id,
      espaceId: espace.id,
      clientNom: d.clientNom,
      ouvertLe: espace.createdAt.toISOString(),
      joursDepuisOuverture: Math.floor((maintenant.getTime() - espace.createdAt.getTime()) / JOUR_MS),
      referenceLe: reference.toISOString(),
      lienCommunique: envois.length > 0,
      relancesFaites: faites.length,
      rang,
      sms,
    });
  }
  return resultat;
}
