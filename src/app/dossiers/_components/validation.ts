// Contrôles de saisie côté navigateur. Le serveur refait les mêmes contrôles
// (src/lib/dossiers/dossiers.ts) : ceux-ci servent à afficher l'erreur sous
// le bon champ avant l'envoi.

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

export function validerCoordonnees(champs: ChampsCoordonnees): ErreursCoordonnees {
  const erreurs: ErreursCoordonnees = {};
  if (!champs.clientNom.trim()) erreurs.clientNom = "Le nom du client est obligatoire.";
  if ((champs.clientTelephone.match(/\d/g)?.length ?? 0) < 9) erreurs.clientTelephone = "Numéro de téléphone invalide.";
  if (champs.clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(champs.clientEmail.trim())) {
    erreurs.clientEmail = "Adresse e-mail invalide.";
  }
  if (!champs.clientAdresse.trim()) erreurs.clientAdresse = "L'adresse est obligatoire.";
  if (!/^\d{5}$/.test(champs.clientCp.trim())) erreurs.clientCp = "5 chiffres attendus.";
  if (!champs.clientVille.trim()) erreurs.clientVille = "La ville est obligatoire.";
  if (!champs.objet.trim()) erreurs.objet = "L'objet du chantier est obligatoire.";
  if (!champs.source) erreurs.source = "Choisis la source du dossier.";
  if (champs.montantEstime.trim()) {
    const montant = lireNombre(champs.montantEstime);
    if (montant === null || montant < 0) erreurs.montantEstime = "Montant invalide.";
  }
  return erreurs;
}
