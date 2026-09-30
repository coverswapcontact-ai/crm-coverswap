import prisma from "@/lib/prisma";
import { pluriel } from "@/lib/commun/format";
import { estReponse, TYPES_REPONSE } from "@/lib/dossiers/main";
import { messagesEspace, type MessageEspaceVue } from "@/lib/espace/messages";
import type { Detection } from "../types";
import { entreGuillemets, moment, paquets, plusAncienne, titreTache } from "./libelles";
import { cleTache, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur ESPACE_MESSAGES — ce que le client a écrit dans son espace (message, commentaire
 * d'une simulation, demande d'autre proposition) et que Lucas n'a pas lu (`MessageEspace` CLIENT, `luLe` nul ;
 * `messagesEspace({ nonLus: true, limite: null })` : TOUS — relecture : une liste tronquée ferait cocher un dossier non lu),
 * groupé par dossier → REPONDRE « Répondre · Nom », niveau 1, clé `REPONDRE:dossier:<id>` (la même que MAIL et les
 * SMS : le moteur fusionne). Raison « « extrait » · le 30/09 à 14 h » (le plus récent ; date absolue) ; `depuis` = le plus ancien non lu. Raccourci : le fil de l'espace, champ de réponse ouvert ;
 * `donnees.espaceDossierId` (l'effet « Fait / Pas à faire » marque lu et écrit l'événement : reponses.ts).
 * Un dossier archivé est ignoré. Un message déjà répondu par un autre canal (mail parti, SMS copié, appel abouti,
 * réponse notée depuis Tâches, prochaine action posée à la main : `dossiers/main.ts › estReponse`) APRÈS le dernier
 * message non lu n'est plus une tâche, même s'il reste non lu (docs/TACHES.md § 5 : « réponse partie »).
 * Lecture seule.
 */

type Evenement = { dossierId: string; type: string; direction: string; metadata: string; contenu: string; createdAt: Date; survenuLe: Date | null };

export const detecteurEspaceMessages: Detecteur = {
  source: "ESPACE_MESSAGES",
  async detecter() {
    const messages = await messagesEspace({ nonLus: true, limite: null });
    if (messages.length === 0) return [];
    const parDossier = new Map<string, MessageEspaceVue[]>();
    // Du plus récent au plus ancien (ordre de messagesEspace).
    for (const m of messages) parDossier.set(m.dossierId, [...(parDossier.get(m.dossierId) ?? []), m]);
    const ids = [...parDossier.keys()];
    const plusAncien = plusAncienne(messages.map((m) => new Date(m.le)));

    const dossiers = new Map<string, { clientNom: string; clientId: string | null; leadId: string | null }>();
    const reponses: Evenement[] = [];
    for (const paquet of paquets(ids)) {
      const [vivants, evenements] = await Promise.all([
        prisma.dossier.findMany({ where: { id: { in: paquet } }, select: { id: true, clientNom: true, clientId: true, leadId: true } }),
        prisma.dossierEvenement.findMany({
          where: { dossierId: { in: paquet }, type: { in: [...TYPES_REPONSE] }, OR: [{ createdAt: { gte: plusAncien } }, { survenuLe: { gte: plusAncien } }] },
          select: { dossierId: true, type: true, direction: true, metadata: true, contenu: true, createdAt: true, survenuLe: true },
        }),
      ]);
      for (const d of vivants) dossiers.set(d.id, d);
      reponses.push(...evenements);
    }

    const detections: Detection[] = [];
    for (const [dossierId, liste] of parDossier) {
      const dossier = dossiers.get(dossierId);
      if (!dossier) continue;
      const recent = liste[0];
      const recuLe = new Date(recent.le);
      const repondu = reponses.some((e) => e.dossierId === dossierId && estReponse(e) && (e.survenuLe ?? e.createdAt).getTime() > recuLe.getTime());
      if (repondu) continue;
      const nombre = liste.length > 1 ? ` · ${pluriel(liste.length, "message")}` : "";
      detections.push({
        cle: cleTache("REPONDRE", { type: "DOSSIER", id: dossierId }),
        type: "REPONDRE",
        source: "ESPACE_MESSAGES",
        sujet: { type: "DOSSIER", id: dossierId },
        dossierId,
        clientId: dossier.clientId,
        leadId: dossier.leadId,
        titre: titreTache("Répondre", dossier.clientNom),
        raison: `${entreGuillemets(recent.texte, 50, "(message vide)")} · ${moment(recuLe)}${nombre}`,
        niveau: 1,
        depuis: plusAncienne(liste.map((m) => new Date(m.le))),
        raccourci: { genre: "ESPACE", libelle: "Répondre dans l'espace", dossierId, rubrique: "messages", href: `/dossiers?dossier=${dossierId}&rubrique=messages&repondre=1` },
        donnees: { espaceDossierId: dossierId },
      });
    }
    return detections;
  },
};
