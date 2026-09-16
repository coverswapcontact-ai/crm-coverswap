/**
 * Appelé une fois au démarrage du serveur, avant la première requête : la base
 * est vérifiée, les déclencheurs du journal réinstallés et les migrations de
 * données exécutées. En cas d'échec, le serveur ne démarre pas : mieux vaut un
 * CRM arrêté qu'un CRM qui écrit sans journal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { preparerBase } = await import("@/lib/base/preparation");
  await preparerBase();
}
