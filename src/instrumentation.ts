/**
 * Appelé une fois au démarrage du serveur, avant la première requête :
 * 1. la base est vérifiée, les déclencheurs du journal réinstallés et les
 *    migrations de données exécutées. En cas d'échec, le serveur ne démarre
 *    pas : mieux vaut un CRM arrêté qu'un CRM qui écrit sans journal ;
 * 2. l'exécuteur des tâches de fond démarre (sauf TACHES_DESACTIVEES=1) ;
 * 3. l'état des canaux d'alerte est annoncé. Un CRM qui ne peut prévenir
 *    personne doit le dire au démarrage, pas le découvrir sur un lead perdu.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Réseau sortant : IPv4 d'abord (l'hébergeur n'a pas d'IPv6), voir le module.
  (await import("@/lib/base/reseau-sortant")).reglerReseauSortant();

  const { preparerBase } = await import("@/lib/base/preparation");
  await preparerBase();

  const { CANAUX, canalConfigure, pushDisponible, variablesManquantes } = await import("@/lib/alertes/configuration");
  const actifs = CANAUX.filter((canal) => canalConfigure(canal));
  const absents = CANAUX.filter((canal) => !canalConfigure(canal));
  console.log(`[alertes] canaux actifs : ${actifs.join(", ") || "aucun"}${absents.length ? ` — absents : ${absents.map((c) => `${c} (${variablesManquantes(c).join(", ")})`).join(", ")}` : ""}`);
  if (!pushDisponible()) {
    console.error("[alertes] AUCUNE NOTIFICATION POUSSÉE : un nouveau lead ne fera pas sonner le téléphone, seul un mail partira. Poser TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID ou NTFY_TOPIC.");
  }

  // Sonde du réseau sortant et essai de push : en tâche de fond, jamais bloquant.
  if (process.env.NODE_ENV === "production") {
    const { verifierAlertesAuDemarrage } = await import("@/lib/alertes/demarrage");
    void verifierAlertesAuDemarrage();
    // Audit de connectivité : une ligne par maillon dans les journaux, 45 s après le démarrage.
    setTimeout(() => {
      void import("@/lib/audit/connexions").then(({ journaliserAudit }) => journaliserAudit());
    }, 45_000);
  }

  if (process.env.TACHES_DESACTIVEES === "1") {
    console.warn("[taches] Exécuteur désactivé (TACHES_DESACTIVEES=1) : aucune tâche de fond ne tournera.");
    return;
  }
  const { enregistrerTousLesTraitements } = await import("@/lib/taches/traitements");
  const { demarrerExecuteur } = await import("@/lib/taches/executeur");
  enregistrerTousLesTraitements();
  demarrerExecuteur();
}
