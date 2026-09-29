import { HISTORIQUE_APPELS, suiviDesAppels } from "@/lib/commercial/suivi-appels";
import { accord, pluriel } from "@/lib/commun/format";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Mission 14 (29/09/2026), partie 3 — les deux listes de Leads (« À appeler »,
 * « À rappeler ») lisent deux nouvelles colonnes du lead, remplies ici d'après
 * l'historique (`commercial/suivi-appels.ts › suiviDesAppels`, la même lecture
 * que la fusion d'un doublon), puis tenues à jour en direct par la fin d'appel
 * (`noterAppel`), « Noter un échange » de type appel (`ajouterEchange`) et les
 * notes d'appel (`creerNoteAppel`, `modifierNoteAppel`) :
 *  - `dernierAppelLe` : le plus récent de ses échanges « appel », des événements
 *    « appel » de ses dossiers (date réelle, sinon saisie) et de ses notes d'appel
 *    qui disent quelque chose (texte ou étiquette) ;
 *  - `tentatives` : les appels sans réponse d'affilée à la fin de l'historique
 *    (échanges et événements « appel ») ; un appel dont l'issue est connue se lit
 *    sur elle seule, comme en direct (`appelSansReponse`).
 * Idempotente : tout est recalculé, seules les valeurs différentes s'écrivent,
 * et sans toucher `updatedAt` (la dernière activité du contact, que lisent la
 * conservation RGPD et l'ordre des entrants : un rattrapage n'en est pas une).
 * Archivés compris (un lead restauré retrouve son historique) ; les lignes
 * archivées de l'historique ne comptent pas.
 */

const NOM = "appels-des-leads-14-3";

export async function suivreLesAppels(client: BaseDonnees): Promise<Record<string, number>> {
  // Lecture avec les archivés : le `where` de premier niveau parle de `archiveLe` (les `select` imbriqués ne sont pas filtrés).
  const leads = await client.lead.findMany({
    where: { ...AVEC_ARCHIVES },
    select: { id: true, dernierAppelLe: true, tentatives: true, updatedAt: true, ...HISTORIQUE_APPELS },
  });

  let modifies = 0;
  let appeles = 0;
  let avecTentatives = 0;
  for (const lead of leads) {
    const { dernierAppelLe, tentatives } = suiviDesAppels(lead);
    if (dernierAppelLe) appeles++;
    if (tentatives > 0) avecTentatives++;
    if ((lead.dernierAppelLe?.getTime() ?? null) === (dernierAppelLe?.getTime() ?? null) && lead.tentatives === tentatives) continue;
    // `updatedAt` fourni tel quel : Prisma ne le remplace pas par maintenant.
    await client.lead.update({ where: { id: lead.id }, data: { dernierAppelLe, tentatives, updatedAt: lead.updatedAt } });
    modifies++;
  }
  console.info(
    `[migration ${NOM}] ${pluriel(leads.length, "lead relu", "leads relus")} : ${appeles} déjà ${accord(appeles, "appelé")}, ${avecTentatives} avec des appels sans réponse d'affilée, ${modifies} mis à jour`
  );
  return { examines: leads.length, modifies, inchanges: leads.length - modifies, appeles, avecTentatives };
}

export const migrationAppelsDesLeads14: MigrationDonnees = {
  nom: NOM,
  description:
    "Dernier appel et tentatives (appels sans réponse d'affilée) de chaque lead, d'après ses échanges, ses notes d'appel et les appels de ses dossiers : les listes « À appeler » et « À rappeler » de Leads s'en servent",
  executer: (client) => suivreLesAppels(client),
};
