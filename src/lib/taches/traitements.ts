/**
 * Point d'enregistrement unique des traitements et des travaux périodiques de
 * chaque volet, appelé au démarrage avant l'exécuteur (src/instrumentation.ts).
 * Un import explicite par volet : ce fichier est la liste de tout ce qui tourne
 * en arrière-plan.
 */
export function enregistrerTousLesTraitements(): void {
  // Chaque volet ajoute ici son appel d'enregistrement.
}
