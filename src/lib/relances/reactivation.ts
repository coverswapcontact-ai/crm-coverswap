import prisma from "@/lib/prisma";
import { normaliserTelephone } from "@/lib/clients/normalisation";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { lecteurDuStop } from "@/lib/sms/conversations";
import { proposerSms } from "@/lib/sms/proposition";
import { adressesDesinscrites, refusCommercial, SELECTION_CLIENT_COMMERCIAL } from "./accord-commercial";

/**
 * Mission 18 (A4) — la réactivation à 6 mois, devenue un type de relance (elle était une séquence de mails, jamais
 * activée, retirée du code). Un contact perdu (lead « sans suite ») depuis JOURS_REACTIVATION jours (180) qui a donné
 * son accord aux messages commerciaux, sans désinscription (`accord-commercial.ts`), fait proposer UN SMS, REACTIVATION,
 * à copier : « où en est votre projet ? ». Une seule fois par contact, jamais vers un numéro en STOP.
 *
 * La date de la perte se lit sur le lead (`perteLe`, posée quand il passe « sans suite »), sinon sur son dossier perdu
 * (`Dossier.perteLe`, posée par chaque passage en « Perdu ») — jamais sur `updatedAt`, que toute écriture repousse.
 * Sans date connue, pas de réactivation. Écartés : le contact dont le client a un dossier vivant (en cours, signé,
 * terminé) ou un autre contact encore actif, l'archivé, l'anonymisé. Un client, une réactivation (son contact perdu le
 * plus récent).
 *
 * La copie du SMS (`noterSmsCopie`, `relance: { type: "REACTIVATION", rang: 1 }`) se trace sur le lead (échange
 * « SMS REACTIVATION copié : … »), même s'il garde un dossier perdu : c'est elle qui compte la relance. Rien n'est
 * envoyé ni écrit ici. `analyses/clients.ts › aReactiver` (clients terminés depuis 6 mois) reste une lecture d'analyse.
 */

export const JOURS_REACTIVATION = 180;
export const RELANCES_REACTIVATION_MAX = 1;
const JOUR_MS = 86_400_000;

/** Le début de la trace d'une réactivation copiée (`sms/copie.ts › contenuCopie("REACTIVATION", …)`). */
export const PREFIXE_TRACE_REACTIVATION = "SMS REACTIVATION copié";

export type RelanceReactivation = {
  leadId: string;
  clientId: string;
  /** Prénom et nom du contact. */
  nom: string;
  perduLe: string;
  /** Le jour où la réactivation est devenue proposable (perte + JOURS_REACTIVATION). */
  proposableLe: string;
  joursDepuisPerte: number;
  telephone: string | null;
  rang: number;
  /** Le SMS à copier, avec la relance à compter. */
  sms: PropositionSms | null;
};

const sansDefaut = (texte: string | null | undefined) => (texte ?? "").trim().replace(/^(inconnu|client)$/i, "");

/**
 * Les réactivations proposables aujourd'hui, du contact perdu depuis le plus longtemps au plus récent. `sms: false`
 * ne prépare pas le SMS (détecteur des tâches, comptes du jour).
 */
export async function relancesReactivationProposables(maintenant: Date = new Date(), filtre: { leadId?: string; sms?: boolean } = {}): Promise<RelanceReactivation[]> {
  const limite = new Date(maintenant.getTime() - JOURS_REACTIVATION * JOUR_MS);
  const leads = await prisma.lead.findMany({
    where: { archiveLe: null, statut: "PERDU", clientId: { not: null }, ...(filtre.leadId ? { id: filtre.leadId } : {}) },
    select: {
      id: true,
      prenom: true,
      nom: true,
      email: true,
      telephone: true,
      clientId: true,
      perteLe: true,
      dossiers: { where: { etape: "PERDU", perteLe: { not: null } }, orderBy: { perteLe: "desc" }, take: 1, select: { perteLe: true } },
      client: {
        select: {
          ...SELECTION_CLIENT_COMMERCIAL,
          archiveLe: true,
          // L'extension ne filtre pas les include : les archivés s'écartent ici.
          dossiers: { where: { archiveLe: null, etape: { not: "PERDU" } }, take: 1, select: { id: true } },
          leads: { where: { archiveLe: null, statut: { not: "PERDU" } }, take: 1, select: { id: true } },
        },
      },
    },
  });
  const datees = leads.flatMap((l) => {
    const perduLe = l.perteLe ?? l.dossiers[0]?.perteLe ?? null;
    const client = l.client;
    if (!perduLe || perduLe.getTime() > limite.getTime() || !client || client.archiveLe || client.anonymiseLe) return [];
    if (client.dossiers.length > 0 || client.leads.length > 0) return [];
    return [{ lead: l, client, perduLe }];
  });
  if (datees.length === 0) return [];

  const [desinscrites, estEnStop, traces] = await Promise.all([
    adressesDesinscrites(datees.flatMap(({ lead, client }) => [lead.email, ...client.emails.map((e) => e.adresse)])),
    lecteurDuStop(datees.map(({ lead }) => lead.telephone)),
    prisma.interaction.findMany({ where: { leadId: { in: datees.map(({ lead }) => lead.id) }, type: "SMS", contenu: { startsWith: PREFIXE_TRACE_REACTIVATION } }, select: { leadId: true } }),
  ]);
  const faites = new Set(traces.map((t) => t.leadId));

  // Un client, une réactivation : son contact perdu le plus récent.
  const parClient = new Map<string, (typeof datees)[number]>();
  for (const d of datees) {
    const deja = parClient.get(d.lead.clientId!);
    if (!deja || d.perduLe.getTime() > deja.perduLe.getTime()) parClient.set(d.lead.clientId!, d);
  }

  const resultat: RelanceReactivation[] = [];
  for (const { lead, client, perduLe } of [...parClient.values()].sort((a, b) => a.perduLe.getTime() - b.perduLe.getTime())) {
    const nom = [sansDefaut(lead.prenom), sansDefaut(lead.nom)].filter(Boolean).join(" ") || "Contact sans nom";
    if (refusCommercial({ nom, consentement: client.consentements[0]?.statut ?? null, adresses: [lead.email, ...client.emails.map((e) => e.adresse)] }, desinscrites)) continue;
    if (estEnStop([lead.telephone])) continue;
    if (faites.has(lead.id)) continue;
    const rang = 1;
    const sms =
      filtre.sms === false
        ? null
        : await proposerSms({ action: "REACTIVATION", leadId: lead.id, relance: { type: "REACTIVATION", rang } }, maintenant).catch((erreur: unknown) => {
            console.error(`[relances] SMS de réactivation impossible à préparer pour le contact ${lead.id} :`, erreur);
            return null;
          });
    resultat.push({
      leadId: lead.id,
      clientId: lead.clientId!,
      nom,
      perduLe: perduLe.toISOString(),
      proposableLe: new Date(perduLe.getTime() + JOURS_REACTIVATION * JOUR_MS).toISOString(),
      joursDepuisPerte: Math.floor((maintenant.getTime() - perduLe.getTime()) / JOUR_MS),
      telephone: normaliserTelephone(lead.telephone),
      rang,
      sms,
    });
  }
  return resultat;
}
