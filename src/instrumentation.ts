/**
 * Appelé une fois au démarrage du serveur, avant la première requête :
 * 1. la base est vérifiée, les déclencheurs du journal réinstallés et les
 *    migrations de données exécutées. En cas d'échec, le serveur ne démarre
 *    pas : mieux vaut un CRM arrêté qu'un CRM qui écrit sans journal ;
 * 2. l'exécuteur des tâches de fond démarre (sauf TACHES_DESACTIVEES=1).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { preparerBase } = await import("@/lib/base/preparation");
  await preparerBase();

  if (process.env.TACHES_DESACTIVEES === "1") {
    console.warn("[taches] Exécuteur désactivé (TACHES_DESACTIVEES=1) : aucune tâche de fond ne tournera.");
    return;
  }
  const { enregistrerTousLesTraitements } = await import("@/lib/taches/traitements");
  const { demarrerExecuteur } = await import("@/lib/taches/executeur");
  enregistrerTousLesTraitements();
  demarrerExecuteur();
}
