import { pluriel } from "@/lib/commun/format";
import { jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import type { ChequeACrediter, LigneEncours } from "@/lib/finances/tableau";
import type { PropositionSms } from "@/lib/sms/catalogue";
import { jourRelatif } from "./dates";

/**
 * Mission 22 (A4) — la logique pure de l'écran Argent v2 (`components/v2/argent/`), importable par les essais : les
 * trois nombres du haut (à encaisser, encaissé ce mois, dépensé ce mois), la plage du mois courant, la phrase de retard
 * d'une facture, la ligne d'un chèque, et le SMS de relance d'une facture (un geste qui n'existait pas par facture :
 * un texte court, sans nom de client, copié par l'écran SMS existant — copier vaut relance, `POST /api/sms/copie`).
 */
export const ENCOURS_VISIBLES = 5;

export type CleNombre = "A_ENCAISSER" | "ENCAISSE_MOIS" | "DEPENSE_MOIS";
export type NombreArgent = { cle: CleNombre; libelle: string; montant: number; /** Rouge seulement s'il reste une facture en retard. */ retard: boolean };

/** « À encaisser : 4 200 € », « Encaissé ce mois : 3 100 € », « Dépensé ce mois : 800 € ». */
export function troisNombres({ encours, encaisseMois, depenseMois }: { encours: { total: number; lignes: readonly Pick<LigneEncours, "joursRetard">[] }; encaisseMois: number; depenseMois: number }): NombreArgent[] {
  return [
    { cle: "A_ENCAISSER", libelle: "À encaisser", montant: encours.total, retard: encours.lignes.some((l) => (l.joursRetard ?? 0) > 0) },
    { cle: "ENCAISSE_MOIS", libelle: "Encaissé ce mois", montant: encaisseMois, retard: false },
    { cle: "DEPENSE_MOIS", libelle: "Dépensé ce mois", montant: depenseMois, retard: false },
  ];
}

/** Du premier jour du mois (Paris) à aujourd'hui, pour `encaissementsDeLaPeriode` et `depensesDeLaPeriode`. */
export function plageDuMois(maintenant: Date): { du: string; au: string } {
  const au = jourParis(maintenant);
  return { du: `${au.slice(0, 7)}-01`, au };
}

/** « octobre 2026 ». */
export function libelleMoisCourant(maintenant: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" }).format(maintenant);
}

/** La somme arrondie au centime. */
export const sommeMontants = (lignes: readonly { montant: number }[]): number => Math.round(lignes.reduce((t, l) => t + l.montant, 0) * 100) / 100;

/** « en retard de 12 jours » (rouge), « échéance inconnue », rien pour une facture pas encore échue. */
export function phraseRetard(ligne: Pick<LigneEncours, "joursRetard" | "tranche">): { texte: string; retard: boolean } | null {
  if ((ligne.joursRetard ?? 0) > 0) return { texte: `en retard de ${pluriel(ligne.joursRetard ?? 0, "jour")}`, retard: true };
  if (ligne.tranche === "INCONNUE") return { texte: "échéance inconnue", retard: false };
  return null;
}

/** « émise le 12 oct. · déjà réglé 200 € sur 1 200 € ». */
export function phraseFacture(ligne: Pick<LigneEncours, "emiseLe" | "regle" | "montant">, maintenant: Date): string {
  const parties = [ligne.emiseLe ? `émise ${jourRelatif(ligne.emiseLe, maintenant)}` : "date d'émission inconnue"];
  if (ligne.regle > 0) parties.push(`déjà réglé ${formatMontant(ligne.regle)} sur ${formatMontant(ligne.montant)}`);
  return parties.join(" · ");
}

/** « 450 € · Payeur · n° 123 · reçu il y a 12 jours » ; `vieux` quand il attend depuis plus de 15 jours. */
export function phraseCheque(cheque: Pick<ChequeACrediter, "montant" | "payeur" | "reference" | "recuLe" | "joursDepuisReception">, maintenant: Date): { texte: string; vieux: boolean } {
  const parties = [formatMontant(cheque.montant), cheque.payeur, cheque.reference ? `n° ${cheque.reference}` : null, `reçu ${jourRelatif(cheque.recuLe, maintenant)}`];
  return { texte: parties.filter(Boolean).join(" · "), vieux: cheque.joursDepuisReception > 15 };
}

/** Le code d'un SMS libre pour la trace (`lib/sms/copie.ts › CODE_LIBRE`) : le texte n'est pas dans le catalogue. */
export const CODE_SMS_LIBRE = "LIBRE";

/**
 * Le texte de la relance d'une facture : court (un seul SMS), poli, sans nom de client ni montant inventé, le numéro de
 * facture et le reste dû. Modifiable dans l'écran SMS avant la copie.
 */
export function texteRelanceFacture(ligne: Pick<LigneEncours, "numero" | "reste">): string {
  return `Bonjour, sauf erreur de notre part, la facture ${ligne.numero} (${formatMontant(ligne.reste)}) reste à régler. Joignable pour toute question. Merci, bonne journée. CoverSwap`;
}

/** Ce que l'écran SMS reçoit pour relancer une facture (le dossier porte la trace « SMS copié »). */
export function propositionRelanceFacture(ligne: Pick<LigneEncours, "numero" | "reste" | "client" | "dossierId" | "telephone">): PropositionSms {
  return {
    // Le code « LIBRE » est accepté par `POST /api/sms/copie` (schéma de la copie) ; il n'est pas un code du catalogue.
    code: CODE_SMS_LIBRE as PropositionSms["code"],
    texte: texteRelanceFacture(ligne),
    telephone: ligne.telephone,
    nom: ligne.client,
    prenom: "",
    leadId: null,
    dossierId: ligne.dossierId,
  };
}

/** Comment relancer : par SMS (numéro et dossier connus), par mail (dossier connu), ou à la main (facture hors CRM). */
export function moyenDeRelance(ligne: Pick<LigneEncours, "dossierId" | "telephone">): "SMS" | "MAIL" | "MAIN" {
  if (!ligne.dossierId) return "MAIN";
  return ligne.telephone ? "SMS" : "MAIL";
}

/** Les mois de l'année qui ont des recettes, du plus récent au plus ancien : « Octobre · 3 100 € » (majuscule initiale). */
export function moisDuLivre(parMois: readonly number[], annee: number, maintenant: Date): { mois: number; libelle: string; montant: number }[] {
  const courant = jourParis(maintenant);
  const dernier = courant.startsWith(String(annee)) ? Number(courant.slice(5, 7)) : 12;
  return Array.from({ length: dernier }, (_, i) => i + 1)
    .filter((mois) => (parMois[mois - 1] ?? 0) !== 0)
    .map((mois) => {
      const brut = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(Date.UTC(annee, mois - 1, 15)));
      return { mois, libelle: brut.charAt(0).toUpperCase() + brut.slice(1), montant: parMois[mois - 1] ?? 0 };
    })
    .reverse();
}
