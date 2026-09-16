// Contrôles de saisie côté navigateur. Le serveur refait les mêmes contrôles
// (src/lib/dossiers/dossiers.ts). Signaler, jamais bloquer : seul le nom est
// exigé ; ce qui ne peut pas s'enregistrer (e-mail illisible, montant qui
// n'est pas un nombre) est une erreur, ce qui manque ou semble faux est un
// avertissement, affiché sans retenir l'enregistrement.

import type { SourceDossier } from "@/lib/dossiers/constants";
import { lireNombre } from "@/lib/dossiers/montants";

export type ChampsCoordonnees = {
  clientNom: string;
  clientTelephone: string;
  clientEmail: string;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  objet: string;
  source: SourceDossier | "";
  montantEstime: string;
};

export type ErreursCoordonnees = Partial<Record<keyof ChampsCoordonnees, string>>;

/** Ce qui empêche l'enregistrement : à corriger (ou à vider) sous le champ. */
export function validerCoordonnees(champs: ChampsCoordonnees): ErreursCoordonnees {
  const erreurs: ErreursCoordonnees = {};
  if (!champs.clientNom.trim()) erreurs.clientNom = "Le nom du client est obligatoire.";
  if (champs.clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(champs.clientEmail.trim())) {
    erreurs.clientEmail = "Adresse e-mail illisible : corrige-la ou laisse le champ vide.";
  }
  if (champs.montantEstime.trim()) {
    const montant = lireNombre(champs.montantEstime);
    if (montant === null || montant < 0) erreurs.montantEstime = "Montant invalide.";
  }
  return erreurs;
}

/** Ce qui semble faux sans empêcher l'enregistrement : dit en gris sous le champ. */
export function avertissementsCoordonnees(champs: ChampsCoordonnees): ErreursCoordonnees {
  const avertissements: ErreursCoordonnees = {};
  const chiffres = champs.clientTelephone.match(/\d/g)?.length ?? 0;
  if (champs.clientTelephone.trim() && chiffres < 9) avertissements.clientTelephone = "Numéro incomplet ? Il sera gardé tel quel.";
  if (champs.clientCp.trim() && !/^\d{5}$/.test(champs.clientCp.trim())) avertissements.clientCp = "Code postal français : 5 chiffres.";
  return avertissements;
}

/** Ce qui manque, pour le dire avant d'enregistrer (le dossier le signalera ensuite). */
export function manquesCoordonnees(champs: ChampsCoordonnees): string[] {
  return [
    ...(champs.clientTelephone.trim() ? [] : ["téléphone"]),
    ...(champs.clientAdresse.trim() && champs.clientCp.trim() && champs.clientVille.trim() ? [] : ["adresse complète"]),
    ...(champs.objet.trim() ? [] : ["objet du chantier"]),
    ...(champs.source ? [] : ["source"]),
  ];
}
