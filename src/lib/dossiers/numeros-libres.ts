// Numéros du registre proposés à un document repris. Fonctions pures : servent
// à l'écran de reprise comme à « Enregistrer un document existant ».

import type { NumeroLibre } from "./registre";

/** Série d'un numéro lu : « F2026-012 » → F, « 2026-012 » → rien. */
export function serieNumero(numero: string): string {
  return /^([A-Za-z]*)/.exec(numero.trim())?.[1]?.toUpperCase() ?? "";
}

/**
 * Numéros qu'un devis ou une facture repris peut porter. Un numéro dont le
 * registre connaît le type est proposé pour ce type, quelle que soit sa série :
 * avant le CRM, devis et factures partageaient la série sans préfixe. Un numéro
 * de type inconnu est proposé à une facture, et à un devis s'il est sans préfixe
 * (« F… » n'a jamais été un devis).
 */
export function numerosProposables(libres: NumeroLibre[], type: "DEVIS" | "FACTURE"): NumeroLibre[] {
  return libres.filter((libre) => libre.type === type || (libre.type === "INCONNU" && (type === "FACTURE" || serieNumero(libre.numero) === "")));
}
