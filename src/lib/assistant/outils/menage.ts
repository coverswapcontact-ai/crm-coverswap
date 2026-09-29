import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { pluriel, titreDossier } from "@/lib/commun/format";
import { archiverDossier, restaurerDossier } from "@/lib/dossiers/archivage";
import { effacerDeLaCorbeille, mettreALaCorbeille } from "@/lib/prospects/corbeille";
import { appliquerActionLeads } from "@/lib/prospects/menage";
import { MOTIFS_ARCHIVAGE } from "@/lib/prospects/menage-constantes";
import { definirOutil, format, lien, type ResultatOutil } from "../definition";

/**
 * Le ménage de l'assistant : archiver, mettre à la corbeille (ou effacer),
 * restaurer des leads ou des dossiers. Extrait tel quel d'`ecriture.ts`
 * (mission 14, partie 3 : le fichier dépassait 600 lignes) ; les outils restent
 * listés, dans le même ordre, dans `OUTILS_ECRITURE`.
 */

const schemaArchivage = z.object({
  leads: z.array(z.string().max(40)).max(200).optional().describe("Identifiants de leads."),
  dossiers: z.array(z.string().max(40)).max(50).optional().describe("Identifiants de dossiers."),
  motif: z.string().min(2).max(300).describe("Pourquoi (« doublon », « test », « hors cible », ou une phrase)."),
});

function motifLead(motif: string): (typeof MOTIFS_ARCHIVAGE)[number] {
  const m = motif.toLowerCase();
  if (/doublon/.test(m)) return "DOUBLON";
  if (/test|essai/.test(m)) return "TEST";
  if (/hors|zone|cible|trop loin/.test(m)) return "HORS_CIBLE";
  return "AUTRE";
}

async function nomsDe(leads: string[], dossiers: string[]) {
  const [l, d] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leads } }, select: { id: true, prenom: true, nom: true, ville: true } }),
    prisma.dossier.findMany({ where: { id: { in: dossiers } }, select: { id: true, clientNom: true, objet: true } }),
  ]);
  return { leads: l.map((x) => `${x.prenom} ${x.nom}`.trim() + (x.ville ? ` (${x.ville})` : "")), dossiers: d.map((x) => titreDossier(x)), inconnus: leads.length + dossiers.length - l.length - d.length };
}

async function archiver(e: z.output<typeof schemaArchivage>): Promise<ResultatOutil> {
  const leads = [...new Set(e.leads ?? [])];
  const dossiers = [...new Set(e.dossiers ?? [])];
  if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à archiver : donne des identifiants de leads ou de dossiers (« chercher », « leads_a_appeler »).", 400);
  const noms = await nomsDe(leads, dossiers);
  if (noms.inconnus) throw new ErreurMetier(`${pluriel(noms.inconnus, "identifiant inconnu", "identifiants inconnus")} : rien n'a été fait.`, 404);
  const faits: string[] = [];
  if (leads.length) {
    const { ids } = await appliquerActionLeads({ action: "ARCHIVER", ids: leads, motif: motifLead(e.motif) });
    faits.push(`${pluriel(ids.length, "lead archivé", "leads archivés")}`);
  }
  for (const id of dossiers) await archiverDossier(id, e.motif);
  if (dossiers.length) faits.push(`${pluriel(dossiers.length, "dossier archivé", "dossiers archivés")}`);
  return { texte: `${faits.join(" et ")} (motif : ${e.motif}). Rien n'est supprimé : « restaurer » les remet.`, donnees: { leads, dossiers }, liens: [lien("Leads", "/leads")] };
}

const apercuArchivage = async (e: z.output<typeof schemaArchivage>) => {
  const noms = await nomsDe([...new Set(e.leads ?? [])], [...new Set(e.dossiers ?? [])]);
  return `Je vais archiver ${pluriel(noms.leads.length, "lead")}${noms.leads.length ? ` : ${noms.leads.join(", ")}` : ""}${noms.dossiers.length ? ` et ${pluriel(noms.dossiers.length, "dossier")} : ${noms.dossiers.join(", ")}` : ""} — motif « ${e.motif} ». Réversible.`;
};

export const outilArchiver = definirOutil({
  nom: "archiver",
  titre: "Archiver des leads ou des dossiers",
  description: "Archive un ou plusieurs leads (ils sortent des listes « À appeler » et « À rappeler ») ou dossiers, avec un motif. Réversible par « restaurer ». Au-delà de trois éléments : aperçu de la liste, puis confirmation. Pour « tous sauf X » : liste d'abord (« leads_a_appeler » ne couvre que « À appeler », 50 au plus ; les leads de « À rappeler » se trouvent par « ce_qui_m_attend » ou « chercher »), retire X, puis donne les identifiants restants ; dis à Lucas ce que tes listes ne couvraient pas.",
  niveau: "REVERSIBLE",
  schema: schemaArchivage,
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  apercu: apercuArchivage,
  executer: archiver,
});

const schemaSuppression = z.object({
  leads: z.array(z.string().max(40)).max(200).optional(),
  dossiers: z.array(z.string().max(40)).max(50).optional(),
  motif: z.string().trim().min(1).max(200),
  definitif: z.boolean().optional().describe("Vrai : effacement immédiat (anonymisation, irréversible) au lieu de la corbeille ; toujours sous confirmation, après avoir dit à Lucas ce que ça implique."),
});

/** Mission 11 : « supprimer » = corbeille 30 jours (réversible), ou effacement définitif (anonymisation) sous confirmation. */
export const outilSupprimer = definirOutil({
  nom: "supprimer",
  titre: "Supprimer : corbeille 30 jours, ou effacement définitif",
  description:
    "Met des leads ou des dossiers à la corbeille : ils sortent des listes et des écrans, « restaurer » les remet pendant 30 jours ; passé ce délai, la purge quotidienne les efface — une anonymisation (RGPD) : les lignes restent, sans rien de personnel ; une facture ou un paiement empêchent l'effacement et la fiche reste à la corbeille, dite comme telle. definitif: true efface tout de suite, sous confirmation, après avoir dit à Lucas que c'est irréversible. Au-delà de trois éléments, ou définitif : aperçu puis confirmation.",
  niveau: "REVERSIBLE",
  schema: schemaSuppression,
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  sensible: (e) => Boolean(e.definitif),
  apercu: async (e) => {
    const noms = await nomsDe([...new Set(e.leads ?? [])], [...new Set(e.dossiers ?? [])]);
    const quoi = `${pluriel(noms.leads.length, "lead")}${noms.leads.length ? ` : ${noms.leads.join(", ")}` : ""}${noms.dossiers.length ? ` et ${pluriel(noms.dossiers.length, "dossier")} : ${noms.dossiers.join(", ")}` : ""}`;
    return e.definitif
      ? `Je vais EFFACER définitivement ${quoi} — motif « ${e.motif} ». Anonymisation irréversible : les lignes restent sans rien de personnel ; ce que la loi fait conserver (factures, paiements) bloque et reste à la corbeille.`
      : `Je vais mettre à la corbeille ${quoi} — motif « ${e.motif} ». Effacés (anonymisés) dans 30 jours sauf « restaurer » d'ici là.`;
  },
  executer: async (e) => {
    const leads = [...new Set(e.leads ?? [])];
    const dossiers = [...new Set(e.dossiers ?? [])];
    if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à supprimer : donne des identifiants de leads ou de dossiers (« chercher », « leads_a_appeler »).", 400);
    const noms = await nomsDe(leads, dossiers);
    if (noms.inconnus) throw new ErreurMetier(`${pluriel(noms.inconnus, "identifiant inconnu", "identifiants inconnus")} : rien n'a été fait.`, 404);
    const mise = await mettreALaCorbeille({ leads, dossiers, motif: e.motif });
    if (e.definitif) {
      const bilan = await effacerDeLaCorbeille({ leads, dossiers }, new Date(), "ASSISTANT:claude");
      return { texte: `${pluriel(bilan.effaces.length, "élément effacé", "éléments effacés")} (anonymisés, irréversible)${bilan.conserves.length ? ` ; ${pluriel(bilan.conserves.length, "conservé")} à la corbeille : ${bilan.conserves.map((c) => `${c.type.toLowerCase()} ${c.id} — ${c.raison}`).join(" ; ")}` : ""}.`, donnees: bilan, liens: [lien("Leads", "/leads")] };
    }
    return { texte: `${[leads.length ? `${pluriel(leads.length, "lead")}` : "", dossiers.length ? `${pluriel(dossiers.length, "dossier")}` : ""].filter(Boolean).join(" et ")} à la corbeille (motif : ${e.motif}) : effacement le ${format.jourCourt(mise.effacementLe)} sauf « restaurer » d'ici là.`, donnees: { leads: mise.leads, dossiers: mise.dossiers, effacementLe: mise.effacementLe.toISOString() }, liens: [lien("Leads", "/leads")] };
  },
});

export const outilRestaurer = definirOutil({
  nom: "restaurer",
  titre: "Restaurer des leads ou des dossiers archivés",
  description: "Remet des leads ou des dossiers archivés ou mis à la corbeille à leur place (inverse d'« archiver » et de « supprimer », tant que l'effacement n'a pas eu lieu).",
  niveau: "REVERSIBLE",
  schema: z.object({ leads: z.array(z.string().max(40)).max(200).optional(), dossiers: z.array(z.string().max(40)).max(50).optional() }),
  masse: (e) => (e.leads?.length ?? 0) + (e.dossiers?.length ?? 0),
  executer: async (e) => {
    const leads = [...new Set(e.leads ?? [])];
    const dossiers = [...new Set(e.dossiers ?? [])];
    if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à restaurer.", 400);
    const faits: string[] = [];
    if (leads.length) faits.push(`${pluriel((await appliquerActionLeads({ action: "RESTAURER", ids: leads })).ids.length, "lead restauré", "leads restaurés")}`);
    for (const id of dossiers) await restaurerDossier(id);
    if (dossiers.length) faits.push(`${pluriel(dossiers.length, "dossier restauré", "dossiers restaurés")}`);
    return { texte: faits.join(" et ") + ".", liens: [lien("Leads", "/leads")] };
  },
});
