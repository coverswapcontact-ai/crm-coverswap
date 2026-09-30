import type { Detecteur } from "./types";

/**
 * Mission 17 (partie A) : détecteur LEADS — les contacts sans dossier (règle de `prospects/leads.ts`).
 *
 * TODO (lot 2, docs/TACHES.md § 1 et § 3, prospects/leads.ts) : rendre, sur `whereActif` (sans dossier vivant, ni PERDU, ni
 * après devis, non archivé),
 * - APPELER « Appeler · Nom » : jamais appelé ni contacté (`dernierAppelLe`, `rappelLe` et `dernierContactLe` nuls),
 *   niveau 2 si arrivé il y a moins de 24 h, sinon 3 ; borné à 60 jours (`JOURS_A_TRAITER`) — au-delà, lot ;
 * - RAPPELER « Rappeler · Nom » : `rappelLe` au plus tard ce soir (niveau 2) ;
 * - DECIDER « Décider · Nom » : appelé ou contacté, sans rappel daté (niveau 3) ;
 * - ECARTER « Classer · Nom » : jamais appelé et `priorite = A_ECARTER` (niveau 5) ;
 * - CLASSER_LEAD « Classer · Nom » : anciens contacts (> 60 j, jamais rappelés), niveau 5, `lot: { cle: "anciens-leads",
 *   libelle: "ancien lead à classer|anciens leads à classer" }` (convention « singulier|pluriel » lue par lecture.ts).
 * Clés : `cleTache("APPELER", { type: "LEAD", id })`. Ne jamais appeler `proposerSms` ici (il ouvre dossier et espace).
 */
export const detecteurLeads: Detecteur = {
  source: "LEADS",
  async detecter() {
    return [];
  },
};
