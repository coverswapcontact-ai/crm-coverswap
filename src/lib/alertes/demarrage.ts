import { pushDisponible } from "./configuration";
import { alerter, resumerEnvoi } from "./canaux";
import { derniereAlerte } from "./registre";
import { sonderReseau } from "./reseau";

/**
 * Au démarrage du serveur, hors du chemin critique : dire dans les journaux ce
 * que le serveur arrive à joindre, et vérifier que le push passe réellement.
 *
 * L'essai d'envoi ne part QUE si rien ne prouve encore que le push fonctionne
 * (aucune alerte consignée, ou la dernière n'a pas atteint le téléphone). Une
 * fois un push réussi, les redémarrages suivants restent silencieux. Le message
 * part en priorité basse : il n'allume pas l'écran et ne sonne pas.
 */
export async function verifierAlertesAuDemarrage(): Promise<void> {
  try {
    const sonde = await sonderReseau();
    for (const hote of sonde.hotes) {
      const adresses = hote.dns ? `DNS : ${hote.dns}` : hote.adresses.map((a) => `${a.adresse} (IPv${a.famille}) ${a.tcp}`).join(" ; ");
      console.log(`[reseau] ${hote.hote} — ${adresses} — fetch : ${hote.fetch} — https IPv4 : ${hote.ipv4}`);
    }
  } catch (erreur) {
    console.error("[reseau] sonde impossible :", erreur);
  }

  try {
    const { compterAbonnes } = await import("./pushweb");
    console.log(`[alertes] push web : ${await compterAbonnes()} appareil(s) abonné(s).`);
  } catch (erreur) {
    console.error("[alertes] abonnements au push web illisibles :", erreur);
  }

  if (!pushDisponible()) return;
  try {
    const derniere = await derniereAlerte();
    if (derniere?.pousse) {
      console.log(`[alertes] dernier push réussi le ${derniere.quand.toISOString()} (${derniere.origine}) : pas d'essai au démarrage.`);
      return;
    }
    const resultats = await alerter(
      {
        titre: "CRM CoverSwap : notifications verifiees",
        texte: "Le serveur vient de redémarrer et a vérifié que ses notifications arrivent jusqu'ici. Rien à faire.",
        urgence: 2,
      },
      { canaux: ["telegram", "ntfy"], origine: "demarrage" }
    );
    console.log(`[alertes] essai au démarrage — ${resumerEnvoi(resultats)}`);
  } catch (erreur) {
    console.error("[alertes] essai au démarrage impossible :", erreur);
  }
}
