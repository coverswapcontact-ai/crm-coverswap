import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { pluriel, titreDossier } from "@/lib/commun/format";
import { effacerDeLaCorbeille, mettreALaCorbeille } from "@/lib/prospects/corbeille";
import { definirOutil, format, lien } from "../definition";

/**
 * « supprimer » (mission 11) : mettre des leads ou des dossiers à la corbeille, ou les effacer. Mission 17 (partie C) :
 * « archiver » et « restaurer » d'ici sont remplacés par les outils génériques (generiques.ts) ; « supprimer » reste
 * tel quel, listé dans `OUTILS_ECRITURE`.
 */

async function nomsDe(leads: string[], dossiers: string[]) {
  const [l, d] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leads } }, select: { id: true, prenom: true, nom: true, ville: true } }),
    prisma.dossier.findMany({ where: { id: { in: dossiers } }, select: { id: true, clientNom: true, objet: true } }),
  ]);
  return { leads: l.map((x) => `${x.prenom} ${x.nom}`.trim() + (x.ville ? ` (${x.ville})` : "")), dossiers: d.map((x) => titreDossier(x)), inconnus: leads.length + dossiers.length - l.length - d.length };
}

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
    if (leads.length + dossiers.length === 0) throw new ErreurMetier("Rien à supprimer : donne des identifiants de leads ou de dossiers (« chercher », « lister » LEADS ou DOSSIERS).", 400);
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

