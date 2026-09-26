import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import { CANAUX_PUSH, alerter, type ResultatCanal } from "@/lib/alertes/canaux";
import { secretRequeteValide, secretsWebhook } from "@/lib/acces/secret-webhook";
import { etatNotifications } from "@/lib/meta/sante";
import { lienFiche } from "@/lib/meta/config";

/**
 * DIAGNOSTIC — à appeler depuis un téléphone, sans session CRM.
 *
 * Répond à trois questions, celles qu'on se pose quand un lead payant n'a pas
 * fait sonner le téléphone :
 *   1. quels canaux d'alerte sont réellement configurés sur ce serveur ?
 *   2. qu'a donné le dernier envoi sur chacun ?
 *   3. ce contact-là est-il complet ?
 * Et, sur demande, elle envoie une VRAIE notification d'essai pour le vérifier
 * de bout en bout.
 *
 *   GET /api/webhook/diagnostic  avec l'en-tête X-Webhook-Secret: <WEBHOOK_SECRET>  (« ?secret= » toléré jusqu'au 26/10/2026)
 *   GET /api/webhook/diagnostic?secret=…&notifier=1     → envoie une alerte d'essai
 *   GET /api/webhook/diagnostic?secret=…&lead=<id>      → résumé d'un contact
 *
 * Protection : le même secret partagé que les webhooks, comparé à temps
 * constant. Aucune valeur de variable d'environnement n'est renvoyée, seulement
 * des noms de variables et des états. Le résumé d'un contact masque le numéro.
 */
export const dynamic = "force-dynamic";

function masquerTelephone(numero: string | null): string | null {
  if (!numero) return null;
  return numero.length <= 6 ? "***" : `${numero.slice(0, 4)}…${numero.slice(-2)}`;
}

async function resumerContact(id: string) {
  const lead = await prisma.lead.findUnique({
    where: { id, ...AVEC_ARCHIVES },
    select: {
      id: true,
      prenom: true,
      nom: true,
      telephone: true,
      email: true,
      ville: true,
      codePostal: true,
      source: true,
      campagne: true,
      publicite: true,
      formulaire: true,
      statut: true,
      vuLe: true,
      createdAt: true,
      archiveLe: true,
      clientId: true,
      metaLeadgenId: true,
      notes: true,
    },
  });
  if (!lead) return { trouve: false as const, id };

  const evenements = await prisma.metaLead.findMany({
    where: { ...AVEC_ARCHIVES, leadId: id },
    select: {
      leadgenId: true,
      campagneId: true,
      campagneNom: true,
      adsetId: true,
      adsetNom: true,
      adId: true,
      adNom: true,
      formId: true,
      pageId: true,
      statut: true,
      soumisLe: true,
      notifications: true,
      notifieLe: true,
      pousseLe: true,
      archiveLe: true,
    },
  });
  const relance = lead.metaLeadgenId
    ? await prisma.tache.findUnique({
        where: { cle: `meta-relance:${lead.metaLeadgenId}` },
        select: { statut: true, prochainEssaiLe: true, termineLe: true },
      })
    : null;

  // Ce qui manque pour que la fiche soit exploitable : dit en clair, sans jargon.
  const manques: string[] = [];
  if (!lead.telephone) manques.push("téléphone");
  if (!lead.ville || /^(non renseign|inconnue?$)/i.test(lead.ville)) manques.push("ville");
  if (!lead.codePostal) manques.push("code postal");
  if (!lead.campagne) manques.push("campagne");
  if (!evenements.some((e) => e.adsetId || e.adsetNom)) manques.push("ensemble de publicités");
  if (!lead.publicite) manques.push("publicité");
  if (lead.source !== "META_ADS") manques.push("source META_ADS");
  if (!evenements.some((e) => e.pousseLe)) manques.push("notification poussée");

  return {
    trouve: true as const,
    complet: manques.length === 0,
    manques,
    contact: {
      id: lead.id,
      prenom: lead.prenom,
      nom: lead.nom ? `${lead.nom.slice(0, 1)}.` : null,
      telephone: masquerTelephone(lead.telephone),
      email: lead.email ? "présent" : "absent",
      ville: lead.ville,
      codePostal: lead.codePostal,
      source: lead.source,
      campagne: lead.campagne,
      publicite: lead.publicite,
      formulaire: lead.formulaire,
      statut: lead.statut,
      recuLe: lead.createdAt.toISOString(),
      ficheOuverte: lead.vuLe?.toISOString() ?? null,
      archive: lead.archiveLe?.toISOString() ?? null,
      clientRattache: Boolean(lead.clientId),
      villeDeduite: /déduite du code postal/.test(lead.notes ?? "") || null,
      lien: lienFiche(lead.id),
    },
    evenementsMeta: evenements.map((e) => ({
      ...e,
      soumisLe: e.soumisLe.toISOString(),
      notifieLe: e.notifieLe?.toISOString() ?? null,
      pousseLe: e.pousseLe?.toISOString() ?? null,
      archiveLe: e.archiveLe?.toISOString() ?? null,
      notifications: e.notifications ? (JSON.parse(e.notifications) as ResultatCanal[]) : null,
    })),
    relance: relance
      ? { statut: relance.statut, prochainEssaiLe: relance.prochainEssaiLe.toISOString(), termineLe: relance.termineLe?.toISOString() ?? null }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Mission 13 : secret dans l'en-tête X-Webhook-Secret ; « ?secret= » toléré jusqu'au 26/10/2026 (secret-webhook.ts).
  if (!secretRequeteValide(request, "GET /api/webhook/diagnostic", secretsWebhook(process.env.META_VERIFY_TOKEN))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 403 });
  }

  const notifications = await etatNotifications();
  const reponse: Record<string, unknown> = {
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || "inconnu").slice(0, 7),
    horodatage: new Date().toISOString(),
    notifications: {
      pushDisponible: notifications.push,
      canauxConfigures: notifications.canaux,
      canaux: notifications.etats,
      leadsSansPush: notifications.leadsSansPush,
    },
    aPoserSurRailway: notifications.etats.filter((e) => !e.configure).flatMap((e) => e.manquantes),
  };

  const leadId = searchParams.get("lead");
  if (leadId) reponse.lead = await resumerContact(leadId.trim());

  if (searchParams.get("notifier") === "1") {
    const resultats = await alerter({
      titre: "Essai de notification CoverSwap",
      texte: [
        "Ceci est un essai lancé depuis /api/webhook/diagnostic.",
        "Si vous lisez ce message sur votre téléphone, le canal qui l'a livré fonctionne.",
        `Canaux configurés : ${notifications.canaux.join(", ") || "aucun"}.`,
      ].join("\n\n"),
      lien: `${(process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "")}/publicite`,
      libelleLien: "Ouvrir l'écran Publicité",
      telephone: "+33612345678",
      urgence: 4,
    }, { origine: "essai" });
    reponse.essai = {
      resultats,
      pousseRecue: resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal)),
    };
  }

  return NextResponse.json(reponse);
}
