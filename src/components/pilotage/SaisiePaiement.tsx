"use client";

import { jourParis } from "@/lib/dossiers/dates";
import { lireNombre } from "@/lib/dossiers/montants";
import { LIBELLES_MOYEN, MOYENS_PAIEMENT, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { Champ, Puces } from "./ui";

/** Saisie d'un paiement reçu, telle que l'écran la garde (textes bruts). */
export type SaisiePaiement = { montant: string; recuLe: string; moyen: MoyenPaiement | null; reference: string };

/** Moyen facultatif : un paiement repris d'avant le CRM peut ne pas l'avoir (signalé au livre). */
export type PaiementLu = { montant: number; recuLe: string; moyen: MoyenPaiement | null; reference: string | null };

/** Saisie pré-remplie : montant attendu, reçu aujourd'hui. */
export function saisiePaiement(montant: number | null): SaisiePaiement {
  return {
    montant: montant && montant > 0 ? String(Math.round(montant * 100) / 100).replace(".", ",") : "",
    recuLe: jourParis(new Date()),
    moyen: null,
    reference: "",
  };
}

/** Paiement prêt à envoyer, ou ce qui manque. */
export function lirePaiement(saisie: SaisiePaiement): { paiement: PaiementLu | null; erreurMontant: string | null; erreurDate: string | null } {
  const montant = saisie.montant.trim() ? lireNombre(saisie.montant) : null;
  const erreurMontant = saisie.montant.trim() && (montant === null || montant <= 0) ? "Montant invalide." : null;
  const erreurDate = saisie.recuLe > jourParis(new Date()) ? "La date est à venir." : null;
  const complet = montant !== null && montant > 0 && saisie.recuLe && !erreurDate;
  return {
    paiement: complet ? { montant: montant!, recuLe: saisie.recuLe, moyen: saisie.moyen, reference: saisie.reference.trim() || null } : null,
    erreurMontant,
    erreurDate,
  };
}

/**
 * Champs d'un paiement reçu : montant, date de réception, moyen, référence.
 * Le moyen se choisit d'un doigt (facultatif, signalé s'il manque) ; la date
 * est celle du jour, à corriger si le paiement est arrivé avant, même avant
 * l'ouverture du dossier.
 */
export function ChampsPaiement({
  saisie,
  onChange,
  libelleMontant = "Montant reçu (€)",
}: {
  saisie: SaisiePaiement;
  onChange: (saisie: SaisiePaiement) => void;
  libelleMontant?: string;
}) {
  const { erreurMontant, erreurDate } = lirePaiement(saisie);
  const changer = <C extends keyof SaisiePaiement>(cle: C, valeur: SaisiePaiement[C]) => onChange({ ...saisie, [cle]: valeur });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Champ
          libelle={libelleMontant}
          obligatoire
          inputMode="decimal"
          placeholder="Ex. 390"
          value={saisie.montant}
          erreur={erreurMontant}
          onChange={(evenement) => changer("montant", evenement.target.value)}
        />
        <Champ
          libelle="Reçu le"
          obligatoire
          type="date"
          max={jourParis(new Date())}
          value={saisie.recuLe}
          erreur={erreurDate}
          onChange={(evenement) => changer("recuLe", evenement.target.value)}
        />
      </div>
      <div>
        <Puces
          libelle="Moyen de paiement"
          options={MOYENS_PAIEMENT.map((moyen) => ({ valeur: moyen, libelle: LIBELLES_MOYEN[moyen] }))}
          valeur={saisie.moyen}
          onChange={(moyen) => changer("moyen", saisie.moyen === moyen ? null : moyen)}
        />
        {saisie.moyen ? null : <p className="mt-1 text-[12px] text-[#9CA3AF]">Non renseigné : il sera signalé au livre des recettes.</p>}
      </div>
      <Champ
        libelle={saisie.moyen === "CHEQUE" ? "N° du chèque (facultatif)" : saisie.moyen === "VIREMENT" ? "Libellé du virement (facultatif)" : "Référence (facultative)"}
        maxLength={120}
        value={saisie.reference}
        onChange={(evenement) => changer("reference", evenement.target.value)}
      />
    </div>
  );
}
