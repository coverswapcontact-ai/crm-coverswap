import type { MigrationDonnees } from "./index";

/**
 * Mission 7, premier soir en production (22/09/2026) : le rangement d'office
 * dans Gmail étant coupé (interrupteur), les mails rangés par le tri étaient
 * restés dans la boîte Gmail sans libellé — et la synchronisation y a vu un
 * « remonté par Lucas » : règle « ne jamais ranger » posée sur leur
 * expéditeur, mail rendu à la boîte. Aucune n'était vraie (Lucas n'avait
 * encore rien touché). Cette migration archive ces règles et rend au tri les
 * mails concernés, qui seront rangés de nouveau au passage suivant.
 */
export const migrationMailRemontesFantomes: MigrationDonnees = {
  nom: "mail-remontes-fantomes-22-09",
  description: "Archive les règles « ne jamais ranger » posées à tort par la synchronisation Gmail (22/09/2026) et rend au tri les mails remontés à tort",
  executer: async (client) => {
    const maintenant = new Date();
    const regles = await client.regleExpediteur.updateMany({
      where: { par: "LUCAS:gmail", archiveLe: null },
      data: { archiveLe: maintenant, archiveMotif: "Posée à tort par la synchronisation Gmail du 22/09/2026 (rangement Gmail inactif : rien n'avait été remonté)" },
    });
    const remontes = await client.message.findMany({ where: { canal: "EMAIL", remonteLe: { not: null }, rangeLe: null, OR: [{ classePar: null }, { classePar: { not: "LUCAS" } }] }, select: { id: true } });
    await client.message.updateMany({ where: { id: { in: remontes.map((m) => m.id) } }, data: { remonteLe: null } });
    // Retriés tout de suite, sans les règles fantômes : le bruit redevient rangé (dans le CRM ; Gmail n'est touché que si l'interrupteur est actif).
    const { classerMessage } = await import("@/lib/mail/boite");
    let ranges = 0;
    for (const m of remontes) if ((await classerMessage(m.id))?.decision.ranger) ranges++;
    return { reglesArchivees: regles.count, mailsRendusAuTri: remontes.length, rangesDeNouveau: ranges };
  },
};
