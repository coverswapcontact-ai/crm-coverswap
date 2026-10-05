import { dateCourte } from "@/lib/commun/format";
import { relancesProposables } from "@/lib/relances/proposables";
import type { Detection } from "../types";
import { jourEtMois, rang, titreTache } from "./libelles";
import { cleTache, type Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur RELANCES — les relances proposables aujourd'hui (calculées, jamais stockées :
 * `relancesProposables`, la source de la feuille « Relances », lue UNE fois).
 * - Devis → RELANCER_DEVIS « Relancer le devis · Nom », niveau 2, clé `RELANCER_DEVIS:dossier:<id>`, montant = total
 *   HT du devis, raison « devis 2026-041 envoyé le 23/09, 1re relance ». Raccourci : l'aperçu du mail de relance
 *   s'il attend sa validation (RELANCE_MAIL, `donnees.propositionId` — ce mail n'est pas rendu par PROPOSITIONS), sinon
 *   le SMS à copier (`sms: { action: "RELANCE_DEVIS", dossierId, relance: { documentId, rang } }`).
 * - Photos → RELANCER_PHOTOS « Relancer pour les photos · Nom », niveau 3, clé `RELANCER_PHOTOS:dossier:<id>`,
 *   raccourci SMS `{ action: "RELANCE_PHOTOS", dossierId, relance: { type: "PHOTOS", rang } }`.
 * - Mission 18 (A4) — demande d'avis → RELANCER_AVIS « Demander un avis · Nom », niveau 3, clé
 *   `RELANCER_AVIS:dossier:<id>`, raccourci SMS `{ action: "RELANCE_AVIS", dossierId, relance: { type: "AVIS", rang } }`.
 * - Mission 18 (A4) — réactivation → REACTIVER « Reprendre contact · Nom », niveau 3, sur le LEAD (clé
 *   `REACTIVER:lead:<id>` : un contact perdu, pas un dossier), raccourci SMS `{ action: "REACTIVATION", leadId,
 *   relance: { type: "REACTIVATION", rang: 1 } }`.
 * Aucun SMS n'est préparé ici : celui des relances photos (`smsPhotos: false`) parce que `proposerSms` ouvre l'espace
 * s'il le faut (projet d'avant l'espace permanent, dossier sans fiche client) et qu'un détecteur n'écrit rien ; celui
 * des devis (`smsDevis: false`, relecture) pour ne pas lire le catalogue devis par devis à chaque passage. L'écran SMS
 * (et l'outil « taches ») le prépare à l'ouverture du raccourci.
 * Occurrence du besoin (`donnees.occurrence`, moteur.ts) : le devis et le rang de la relance ; pour les photos, le rang
 * et la référence du délai — la 2e relance après un « Fait » sur la 1re est un besoin nouveau ; pour l'avis, la fin du
 * chantier ; pour la réactivation, la date de la perte. Ni l'avis ni la réactivation ne préparent leur SMS ici.
 * Raisons en dates absolues (une raison qui change à chaque passage réécrit la tâche).
 * Achèvement : la relance n'est plus proposable (SMS copié, mail parti ou validé) : le moteur coche par absence.
 */
export const detecteurRelances: Detecteur = {
  source: "RELANCES",
  async detecter({ maintenant }) {
    const { devis, photos, avis, reactivations } = await relancesProposables(maintenant, { smsPhotos: false, smsDevis: false, smsAvis: false, smsReactivations: false });
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
        raison: `devis ${d.numero} envoyé le ${jourEtMois(new Date(d.envoyeLe))}, ${rang(d.rang)} relance`,
        niveau: 2,
        montant: d.totalHt,
        depuis: new Date(d.prochaineProposableLe ?? d.emisLe),
        raccourci: d.mail
          ? { genre: "RELANCE_MAIL", libelle: "Relire le mail de relance", propositionId: d.mail.propositionId, dossierId: d.dossierId }
          : { genre: "SMS", libelle: "Copier le SMS", dossierId: d.dossierId, telephone: d.sms?.telephone ?? d.telephone, sms: { action: "RELANCE_DEVIS", dossierId: d.dossierId, relance } },
        donnees: {
          documentId: d.documentId,
          rangRelance: d.rang,
          occurrence: `${d.documentId}:${d.rang}`,
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
        raison: `espace ouvert le ${jourEtMois(new Date(p.ouvertLe))}, sans photo, ${rang(p.rang)} relance`,
        niveau: 3,
        depuis: new Date(p.referenceLe),
        raccourci: { genre: "SMS", libelle: "Copier le SMS", dossierId: p.dossierId, sms: { action: "RELANCE_PHOTOS", dossierId: p.dossierId, relance: { type: "PHOTOS", rang: p.rang } } },
        donnees: { rangRelance: p.rang, occurrence: `${p.rang}:${p.referenceLe}` },
      });
    }
    for (const a of avis) {
      const sujet = { type: "DOSSIER" as const, id: a.dossierId };
      detections.push({
        cle: cleTache("RELANCER_AVIS", sujet),
        type: "RELANCER_AVIS",
        source: "RELANCES",
        sujet,
        dossierId: a.dossierId,
        titre: titreTache("Demander un avis", a.clientNom),
        raison: `chantier terminé le ${jourEtMois(new Date(a.termineLe))}, pas encore d'avis`,
        niveau: 3,
        depuis: new Date(a.proposableLe),
        raccourci: { genre: "SMS", libelle: "Copier le SMS", dossierId: a.dossierId, telephone: a.telephone, sms: { action: "RELANCE_AVIS", dossierId: a.dossierId, relance: { type: "AVIS", rang: a.rang } } },
        donnees: { rangRelance: a.rang, occurrence: `avis:${a.termineLe}` },
      });
    }
    for (const r of reactivations) {
      const sujet = { type: "LEAD" as const, id: r.leadId };
      detections.push({
        cle: cleTache("REACTIVER", sujet),
        type: "REACTIVER",
        source: "RELANCES",
        sujet,
        leadId: r.leadId,
        clientId: r.clientId,
        titre: titreTache("Reprendre contact", r.nom),
        raison: `sans suite depuis le ${dateCourte(new Date(r.perduLe))}, d'accord pour les messages commerciaux`,
        niveau: 3,
        depuis: new Date(r.proposableLe),
        raccourci: { genre: "SMS", libelle: "Copier le SMS", leadId: r.leadId, telephone: r.telephone, sms: { action: "REACTIVATION", leadId: r.leadId, relance: { type: "REACTIVATION", rang: r.rang } } },
        donnees: { rangRelance: r.rang, occurrence: `reactivation:${r.perduLe}` },
      });
    }
    return detections;
  },
};
