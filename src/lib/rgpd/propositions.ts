import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { estJourValide } from "@/lib/dossiers/dates";
import { definirProposition } from "@/lib/validation/definitions";
import { anonymiserDansTransaction } from "./anonymisation";

export const MOTIFS_ANONYMISATION = ["DEMANDE_PERSONNE", "DUREE_ECOULEE", "AUTRE"] as const;
export type MotifAnonymisation = (typeof MOTIFS_ANONYMISATION)[number];

export const LIBELLES_MOTIF_ANONYMISATION: Record<MotifAnonymisation, string> = {
  DEMANDE_PERSONNE: "Demande de la personne (droit à l'effacement)",
  DUREE_ECOULEE: "Durée de conservation écoulée",
  AUTRE: "Autre motif",
};

/**
 * Anonymiser un client : irréversible. Proposée par la durée de conservation
 * ou demandée depuis la fiche ; toujours décidée par une personne, jamais en
 * lot, jamais seule. Le titre ne porte pas de nom (référence seulement).
 */
export const propositionAnonymisationClient = definirProposition({
  type: "ANONYMISATION_CLIENT",
  libelle: "Anonymiser un client (RGPD)",
  schema: z.object({
    clientId: z.string("Client manquant.").min(1, "Client manquant.").max(40),
    motif: z.enum(MOTIFS_ANONYMISATION, "Motif d'anonymisation invalide."),
    commentaire: z.string().trim().max(500).nullable().optional().transform((valeur) => valeur || null),
    derniereActivite: z.string().refine(estJourValide, "Date invalide.").nullable().optional().transform((valeur) => valeur ?? null),
  }),
  sensible: true,
  validationGroupee: false,
  motifsRejet: [
    { code: "RELATION_EN_COURS", libelle: "La relation continue" },
    { code: "CONSERVATION_NECESSAIRE", libelle: "À garder (litige, garantie, réclamation)" },
  ],
  execution: "IMMEDIATE",
  liens: (contenu) => [{ libelle: "Fiche client", href: `/clients/${contenu.clientId}` }],
  async pertinente(contenu) {
    const client = await prisma.client.findUnique({ where: { id: contenu.clientId }, select: { anonymiseLe: true } });
    if (!client) return "le client n'existe plus";
    return client.anonymiseLe ? "la fiche est déjà anonymisée" : null;
  },
  async executer(contenu, { tx, decidePar, propositionId }) {
    if (!tx) throw new Error("ANONYMISATION_CLIENT s'exécute dans la transaction de la validation");
    const bilan = await anonymiserDansTransaction(tx, contenu.clientId, { decidePar, propositionId });
    return { resultat: bilan };
  },
});
