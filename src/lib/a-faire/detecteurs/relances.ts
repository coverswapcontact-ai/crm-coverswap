import { relancesProposables } from "@/lib/relances/proposables";
import type { Detection } from "../types";
import { ilYaJours, rang, titreTache } from "./libelles";
import { cleTache, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur RELANCES — les relances proposables aujourd'hui (calculées, jamais stockées :
 * `relancesProposables`, la source de la feuille « Relances », lue UNE fois).
 * - Devis → RELANCER_DEVIS « Relancer le devis · Nom », niveau 2, clé `RELANCER_DEVIS:dossier:<id>`, montant = total
 *   HT du devis, raison « devis 2026-041 envoyé il y a 7 jours, 1re relance ». Raccourci : l'aperçu du mail de relance
 *   s'il attend sa validation (RELANCE_MAIL, `donnees.propositionId` — ce mail n'est pas rendu par PROPOSITIONS), sinon
 *   le SMS à copier (`sms: { action: "RELANCE_DEVIS", dossierId, relance: { documentId, rang } }`, texte prêt dans
 *   `donnees.texteSms`).
 * - Photos → RELANCER_PHOTOS « Relancer pour les photos · Nom », niveau 3, clé `RELANCER_PHOTOS:dossier:<id>`,
 *   raccourci SMS `{ action: "RELANCE_PHOTOS", dossierId, relance: { type: "PHOTOS", rang } }`.
 * Le SMS des relances photos n'est PAS préparé ici (`smsPhotos: false`) : `proposerSms` ouvre l'espace s'il le faut
 * (projet d'avant l'espace permanent, dossier sans fiche client) et un détecteur n'écrit rien ; l'écran SMS le prépare
 * à l'ouverture du raccourci. Celui des devis n'ouvre rien (relances/service.ts › listerRelances).
 * Achèvement : la relance n'est plus proposable (SMS copié, mail parti ou validé) : le moteur coche par absence.
 */
export const detecteurRelances: Detecteur = {
  source: "RELANCES",
  async detecter({ maintenant }) {
    const { devis, photos } = await relancesProposables(maintenant, { smsPhotos: false });
    const detections: Detection[] = [];
    for (const d of devis) {
      const sujet = { type: "DOSSIER" as const, id: d.dossierId };
      const relance = { documentId: d.documentId, rang: d.rang };
      detections.push({
        cle: cleTache("RELANCER_DEVIS", sujet),
        type: "RELANCER_DEVIS",
        source: "RELANCES",
        sujet,
        dossierId: d.dossierId,
        titre: titreTache("Relancer le devis", d.clientNom),
        raison: `devis ${d.numero} envoyé ${ilYaJours(d.joursDepuisEmission)}, ${rang(d.rang)} relance`,
        niveau: 2,
        montant: d.totalHt,
        depuis: new Date(d.prochaineProposableLe ?? d.emisLe),
        raccourci: d.mail
          ? { genre: "RELANCE_MAIL", libelle: "Relire le mail de relance", propositionId: d.mail.propositionId, dossierId: d.dossierId }
          : { genre: "SMS", libelle: "Copier le SMS", dossierId: d.dossierId, telephone: d.sms?.telephone ?? null, sms: { action: "RELANCE_DEVIS", dossierId: d.dossierId, relance } },
        donnees: {
          documentId: d.documentId,
          rangRelance: d.rang,
          ...(d.mail ? { propositionId: d.mail.propositionId } : {}),
          ...(d.sms ? { texteSms: d.sms.texte } : {}),
        },
      });
    }
    for (const p of photos) {
      const sujet = { type: "DOSSIER" as const, id: p.dossierId };
      detections.push({
        cle: cleTache("RELANCER_PHOTOS", sujet),
        type: "RELANCER_PHOTOS",
        source: "RELANCES",
        sujet,
        dossierId: p.dossierId,
        titre: titreTache("Relancer pour les photos", p.clientNom),
        raison: `espace ouvert ${ilYaJours(p.joursDepuisOuverture)}, sans photo, ${rang(p.rang)} relance`,
        niveau: 3,
        depuis: new Date(p.referenceLe),
        raccourci: { genre: "SMS", libelle: "Copier le SMS", dossierId: p.dossierId, sms: { action: "RELANCE_PHOTOS", dossierId: p.dossierId, relance: { type: "PHOTOS", rang: p.rang } } },
        donnees: { rangRelance: p.rang },
      });
    }
    return detections;
  },
};
