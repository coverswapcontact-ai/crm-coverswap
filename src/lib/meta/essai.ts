import { randomInt } from "node:crypto";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { normaliserLeadMeta } from "./champs";
import type { LeadGraph } from "./graph";
import { accuserReceptionLeadgen, evenementsDeLaCharge, traiterLeadMeta } from "./leads";
import { signerCommeMeta, verifierSignatureMeta } from "./signature";
import { canauxConfigures } from "@/lib/alertes/canaux";
import { pluriel } from "@/lib/commun/format";

/**
 * Mode d'essai : prouve que la chaîne complète marche, sans dépendre de Meta.
 *
 * Il simule un événement `leadgen` exactement tel que Meta l'envoie, le signe
 * avec META_APP_SECRET, le fait passer par le vrai webhook, puis traite le lead
 * avec des réponses de formulaire fictives à la place de l'appel Graph. Il
 * vérifie ensuite ce qui est réellement en base, rejoue l'événement pour
 * contrôler l'idempotence, et essaie une signature fausse.
 *
 * Aucune donnée réelle : le contact créé porte « ESSAI » et un numéro réservé
 * aux essais, et il est archivé à la fin (rien ne se supprime).
 */
/** Chaque essai a ses propres coordonnées : deux essais de suite ne se gênent pas. */
function champsEssai(marque: string): { name: string; values: string[] }[] {
  return [
    { name: "full_name", values: ["ESSAI Camille Martin"] },
    { name: "phone_number", values: [`+3360000${marque}`] },
    { name: "email", values: [`essai-meta-${marque}@example.com`] },
    { name: "city", values: ["Pérols"] },
    { name: "post_code", values: ["34470"] },
    { name: "quelle_pièce_souhaitez-vous_rénover_?", values: ["Ma cuisine"] },
    { name: "quand_souhaitez-vous_réaliser_les_travaux_?", values: ["Dans les 3 mois"] },
    { name: "êtes-vous_propriétaire_?", values: ["Oui"] },
  ];
}

export type EtapeEssai = { etape: string; ok: boolean; detail: string };

export type RapportEssai = {
  ok: boolean;
  leadgenId: string;
  leadId: string | null;
  etapes: EtapeEssai[];
  /** Ce qui est réellement en base après l'essai. */
  contact: Record<string, unknown> | null;
};

function fauxLeadGraph(soumisLe: Date, marque: string): LeadGraph {
  return {
    normalise: normaliserLeadMeta(champsEssai(marque)),
    soumisLe,
    formId: "000000000000001",
    formNom: "Formulaire d'essai — rénovation cuisine",
    adId: "000000000000002",
    adNom: "Publicité d'essai — avant/après cuisine",
    adsetId: "000000000000003",
    adsetNom: "Ensemble d'essai — Montpellier 25 km",
    campagneId: "000000000000004",
    campagneNom: "Campagne d'essai — Cuisines septembre",
    plateforme: "facebook",
    organique: false,
  };
}

export async function lancerEssaiMeta(options: { notifier?: boolean; base?: string } = {}): Promise<RapportEssai> {
  const notifier = options.notifier ?? true;
  const etapes: EtapeEssai[] = [];
  const ajouter = (etape: string, ok: boolean, detail: string) => etapes.push({ etape, ok, detail });
  // Identifiant fictif : 9 999 999 puis dix chiffres au hasard. Hors du format des vrais
  // identifiants Meta, et deux essais lancés coup sur coup ne tombent pas sur le même.
  const marque = String(randomInt(1000, 10000));
  const leadgenId = `9999999${String(randomInt(0, 1_000_000)).padStart(6, "0")}${marque}`;
  const soumisLe = new Date(Date.now() - 60_000);
  const charge = {
    object: "page",
    entry: [
      {
        id: process.env.META_PAGE_ID || "000000000000010",
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: leadgenId,
              page_id: process.env.META_PAGE_ID || "000000000000010",
              form_id: "000000000000001",
              adgroup_id: "000000000000002",
              created_time: Math.floor(soumisLe.getTime() / 1000),
            },
          },
        ],
      },
    ],
  };
  const corps = JSON.stringify(charge);
  const secret = process.env.META_APP_SECRET;

  // 1. Signature : la vraie, puis une fausse.
  if (!secret) ajouter("Signature", false, "META_APP_SECRET absente : le webhook refuserait tous les appels de Meta.");
  else {
    const bonne = verifierSignatureMeta(corps, signerCommeMeta(corps, secret), secret);
    const fausse = verifierSignatureMeta(corps, signerCommeMeta(corps, `${secret}-faux`), secret);
    ajouter("Signature", bonne.ok && !fausse.ok, bonne.ok && !fausse.ok ? "La vraie signature passe, une fausse est rejetée." : "Vérification de signature incorrecte.");
  }

  // 2. Le webhook lit bien l'événement dans la charge de Meta.
  const evenements = evenementsDeLaCharge(charge);
  ajouter("Lecture de l'événement", evenements.length === 1 && evenements[0].leadgenId === leadgenId, evenements.length === 1 ? `leadgen_id ${leadgenId} reconnu.` : `${pluriel(evenements.length, "événement reconnu", "événements reconnus")}, 1 attendu.`);
  if (evenements.length !== 1) return { ok: false, leadgenId, leadId: null, etapes, contact: null };

  // 3. Accusé de réception, puis rejeu : deux fois le même événement ne doivent faire qu'une ligne.
  const premier = await accuserReceptionLeadgen(evenements[0]);
  const second = await accuserReceptionLeadgen(evenements[0]);
  ajouter("Idempotence de la réception", premier.nouveau && !second.nouveau && premier.metaLeadId === second.metaLeadId, premier.nouveau && !second.nouveau ? "Le même leadgen_id rejoué ne crée pas de seconde ligne." : "L'événement rejoué a été traité comme nouveau.");

  // 4. Traitement complet, avec des réponses fictives à la place de l'appel Graph.
  let leadId: string | null = null;
  try {
    const resultat = await traiterLeadMeta(leadgenId, async () => fauxLeadGraph(soumisLe, marque));
    leadId = resultat.leadId;
    const canaux = notifier ? resultat.notifications : [];
    ajouter("Création du contact", Boolean(leadId), leadId ? `Contact ${leadId} créé${resultat.rattache ? " (rattaché à un contact existant)" : ""}.` : "Aucun contact créé.");
    if (notifier) {
      const envoyees = canaux.filter((c) => c.ok).map((c) => c.canal);
      ajouter(
        "Notification",
        envoyees.length > 0,
        envoyees.length > 0
          ? `Partie sur : ${envoyees.join(", ")}${canaux.length > envoyees.length ? ` — en échec : ${canaux.filter((c) => !c.ok).map((c) => `${c.canal} (${c.detail})`).join(", ")}` : ""}`
          : `Aucune notification envoyée. Canaux configurés : ${canauxConfigures().join(", ") || "aucun"}.`
      );
    }
  } catch (erreur) {
    ajouter("Création du contact", false, erreur instanceof Error ? erreur.message : "échec du traitement");
  }

  // 5. Le rejeu du traitement ne crée pas de second contact.
  if (leadId) {
    const rejeu = await traiterLeadMeta(leadgenId, async () => fauxLeadGraph(soumisLe, marque));
    const contacts = await prisma.lead.count({ where: { ...AVEC_ARCHIVES, metaLeadgenId: leadgenId } });
    ajouter("Idempotence du traitement", rejeu.leadId === leadId && contacts === 1, contacts === 1 ? "Deux traitements du même leadgen_id : un seul contact." : `${contacts} contacts pour un même leadgen_id.`);
  }

  // 6. Ce qui est réellement en base.
  let contact: Record<string, unknown> | null = null;
  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { prenom: true, nom: true, telephone: true, email: true, ville: true, codePostal: true, typeProjet: true, source: true, campagne: true, publicite: true, formulaire: true, metaLeadgenId: true, notes: true, createdAt: true, clientId: true },
    });
    const metaLead = await prisma.metaLead.findUnique({ where: { leadgenId }, select: { campagneNom: true, adsetNom: true, adNom: true, campagneId: true, adsetId: true, adId: true, plateforme: true, soumisLe: true, statut: true, reponses: true } });
    contact = { ...lead, meta: metaLead };
    const attendus: [string, boolean][] = [
      ["prénom", lead?.prenom === "ESSAI"],
      ["nom", lead?.nom === "Camille Martin"],
      ["téléphone", lead?.telephone === `+3360000${marque}`],
      ["e-mail", lead?.email === `essai-meta-${marque}@example.com`],
      ["ville", lead?.ville === "Pérols"],
      ["code postal", lead?.codePostal === "34470"],
      ["type de projet", lead?.typeProjet === "CUISINE"],
      ["source META_ADS", lead?.source === "META_ADS"],
      ["nom de campagne", lead?.campagne === "Campagne d'essai — Cuisines septembre"],
      ["nom de publicité", Boolean(lead?.publicite)],
      ["nom de formulaire", Boolean(lead?.formulaire)],
      ["leadgen_id conservé", lead?.metaLeadgenId === leadgenId],
      ["horodatage de soumission", Math.abs((lead?.createdAt?.getTime() ?? 0) - soumisLe.getTime()) < 2000],
      ["questions personnalisées", Boolean(lead?.notes?.includes("Dans les 3 mois") && lead?.notes?.includes("propriétaire"))],
      ["identifiants campagne/ensemble/publicité", Boolean(metaLead?.campagneId && metaLead?.adsetId && metaLead?.adId)],
      ["client pérenne rattaché", Boolean(lead?.clientId)],
    ];
    const manquants = attendus.filter(([, ok]) => !ok).map(([nom]) => nom);
    ajouter("Champs en base", manquants.length === 0, manquants.length === 0 ? `Les ${attendus.length} champs attendus sont présents et justes.` : `Manquants ou faux : ${manquants.join(", ")}.`);
  }

  // 7. Ménage : le contact d'essai est archivé (rien ne se supprime).
  if (leadId) {
    await prisma.lead.update({ where: { id: leadId }, data: { archiveLe: new Date(), archiveMotif: "Contact d'essai de l'intégration Meta" } });
    await prisma.metaLead.update({ where: { leadgenId }, data: { archiveLe: new Date(), archiveMotif: "Essai de l'intégration Meta" } });
    await prisma.tache.updateMany({ where: { cle: { in: [`meta-lead:${leadgenId}`, `meta-relance:${leadgenId}`] }, statut: { in: ["EN_ATTENTE", "ECHEC_DEFINITIF"] } }, data: { statut: "ANNULEE", termineLe: new Date() } });
    ajouter("Ménage", true, "Contact et événement d'essai archivés, relance annulée.");
  }

  return { ok: etapes.every((e) => e.ok), leadgenId, leadId, etapes, contact };
}
