import { Prisma, type Client } from "@prisma/client";
import { z } from "zod/v4";
import prisma, { type Transaction } from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { definirProposition } from "@/lib/validation/definitions";

/**
 * Fusion de deux fiches client, uniquement après validation (proposition
 * FUSION_CLIENTS). Tout ce qui pointe vers la fiche absorbée — leads,
 * dossiers, coordonnées, consentements, propositions, et demain documents et
 * messages — passe sur la fiche conservée ; la fiche absorbée est archivée et
 * garde le lien vers celle qui l'a absorbée. Rien n'est perdu : le journal
 * garde les deux fiches telles qu'elles étaient.
 */

/** Modèles qui portent un `clientId` : lus dans le schéma, un nouveau modèle est couvert d'office. */
function modelesRattachesAuClient(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((modele) => modele.name !== "Client" && modele.fields.some((champ) => champ.name === "clientId" && champ.kind === "scalar"))
    .map((modele) => modele.name);
}

type Delegue = { updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }> };

function delegue(tx: Transaction, modele: string): Delegue {
  const nom = modele.charAt(0).toLowerCase() + modele.slice(1);
  const trouve = (tx as unknown as Record<string, Delegue | undefined>)[nom];
  if (!trouve) throw new Error(`Modèle ${modele} introuvable pour la fusion`);
  return trouve;
}

const CHAMPS_COMPLETABLES = [
  "prenom",
  "nomFamille",
  "raisonSociale",
  "siret",
  "adresse",
  "codePostal",
  "ville",
  "sourceDetail",
  "campagne",
  "publicite",
  "formulaire",
  "recommandeParTexte",
] as const;

/**
 * Une adresse ou un numéro présents sur les deux fiches n'apparaissent qu'une
 * fois sur la fiche conservée : le double est archivé (jamais supprimé), la
 * coordonnée principale ou la plus ancienne reste.
 */
async function archiverCoordonneesEnDouble(tx: Transaction, clientId: string): Promise<number> {
  const motif = "En double après la fusion des fiches";
  let archivees = 0;
  const emails = await tx.clientEmail.findMany({ where: { clientId, archiveLe: null }, orderBy: [{ principale: "desc" }, { createdAt: "asc" }] });
  const adresses = new Set<string>();
  for (const ligne of emails) {
    if (!adresses.has(ligne.adresse)) {
      adresses.add(ligne.adresse);
      continue;
    }
    await tx.clientEmail.update({ where: { id: ligne.id }, data: { archiveLe: new Date(), archiveMotif: motif, principale: false } });
    archivees++;
  }
  const telephones = await tx.clientTelephone.findMany({ where: { clientId, archiveLe: null }, orderBy: [{ principal: "desc" }, { createdAt: "asc" }] });
  const numeros = new Set<string>();
  for (const ligne of telephones) {
    if (!numeros.has(ligne.numero)) {
      numeros.add(ligne.numero);
      continue;
    }
    await tx.clientTelephone.update({ where: { id: ligne.id }, data: { archiveLe: new Date(), archiveMotif: motif, principal: false } });
    archivees++;
  }
  return archivees;
}

export async function fusionnerClients(
  tx: Transaction,
  conserveId: string,
  absorbeId: string,
  motif: string
): Promise<{ deplaces: Record<string, number> }> {
  if (conserveId === absorbeId) throw new ErreurMetier("Une fiche ne peut pas être fusionnée avec elle-même.", 400);
  const [conserve, absorbe] = await Promise.all([
    tx.client.findUnique({ where: { id: conserveId } }),
    tx.client.findUnique({ where: { id: absorbeId } }),
  ]);
  if (!conserve || !absorbe) throw new ErreurMetier("Fiche client introuvable.", 404);
  if (conserve.archiveLe || absorbe.archiveLe) {
    throw new ErreurMetier("Une des deux fiches est déjà archivée ou fusionnée.", 409);
  }

  // 1. Identité : on complète les blancs de la fiche conservée.
  const complements: Prisma.ClientUpdateInput = {};
  for (const champ of CHAMPS_COMPLETABLES) {
    if (!conserve[champ] && absorbe[champ]) complements[champ] = absorbe[champ];
  }
  // L'acquisition est celle du premier contact.
  if (absorbe.premierContactLe < conserve.premierContactLe) {
    complements.premierContactLe = absorbe.premierContactLe;
    if (absorbe.source !== "INCONNUE") {
      complements.source = absorbe.source;
      complements.sourceDetail = absorbe.sourceDetail;
      complements.campagne = absorbe.campagne ?? conserve.campagne;
      complements.publicite = absorbe.publicite ?? conserve.publicite;
      complements.formulaire = absorbe.formulaire ?? conserve.formulaire;
    }
  }
  const recommandeur = conserve.recommandeParId ?? absorbe.recommandeParId;
  if (!conserve.recommandeParId && recommandeur && recommandeur !== conserveId) {
    complements.recommandePar = { connect: { id: recommandeur } };
  }
  if (absorbe.notes) {
    complements.notes = [conserve.notes, `— Repris de la fiche fusionnée « ${absorbe.nom} » —\n${absorbe.notes}`]
      .filter(Boolean)
      .join("\n\n");
  }
  if (Object.keys(complements).length > 0) await tx.client.update({ where: { id: conserveId }, data: complements });

  // 2. Tout ce qui pointe vers la fiche absorbée passe sur la fiche conservée.
  const deplaces: Record<string, number> = {};
  for (const modele of modelesRattachesAuClient()) {
    const donnees: Record<string, unknown> = { clientId: conserveId };
    if (modele === "ClientEmail") donnees.principale = false;
    if (modele === "ClientTelephone") donnees.principal = false;
    const { count } = await delegue(tx, modele).updateMany({ where: { clientId: absorbeId }, data: donnees });
    if (count > 0) deplaces[modele] = count;
  }
  const enDouble = await archiverCoordonneesEnDouble(tx, conserveId);
  if (enDouble > 0) deplaces.coordonneesEnDouble = enDouble;
  // Clients recommandés par la fiche absorbée (sans créer d'auto-recommandation).
  const { count: recommandes } = await tx.client.updateMany({
    where: { recommandeParId: absorbeId, id: { not: conserveId } },
    data: { recommandeParId: conserveId },
  });
  if (recommandes > 0) deplaces.recommandations = recommandes;
  await tx.client.updateMany({ where: { id: conserveId, recommandeParId: absorbeId }, data: { recommandeParId: null } });

  // 3. La fiche absorbée est archivée et garde la trace de la fusion.
  await tx.client.update({
    where: { id: absorbeId },
    data: {
      archiveLe: new Date(),
      archiveMotif: motif.slice(0, 500),
      fusionneDansId: conserveId,
      recommandeParId: null,
    },
  });
  return { deplaces };
}

/** Suivre les fusions : la fiche vivante d'un client éventuellement absorbé. */
export async function ficheVivante(clientId: string, client: Transaction | typeof prisma = prisma): Promise<Client | null> {
  let courant = await client.client.findUnique({ where: { id: clientId } });
  for (let saut = 0; courant?.fusionneDansId && saut < 10; saut++) {
    courant = await client.client.findUnique({ where: { id: courant.fusionneDansId } });
  }
  return courant;
}

export const propositionFusionClients = definirProposition({
  type: "FUSION_CLIENTS",
  libelle: "Fusionner deux fiches client",
  schema: z.object({
    clientAId: z.string().min(1).max(40),
    clientBId: z.string().min(1).max(40),
    conserver: z.enum(["A", "B"], "Choisis la fiche à conserver."),
  }),
  // Rien ne part chez le client ni ne touche à l'argent, mais une fusion ne se
  // fait jamais sans validation, et jamais en lot : chaque paire se regarde.
  sensible: false,
  validationGroupee: false,
  automatisable: false,
  champs: [
    {
      cle: "conserver",
      libelle: "Fiche à conserver",
      nature: "choix",
      obligatoire: true,
      options: [
        { valeur: "A", libelle: "La première fiche (A)" },
        { valeur: "B", libelle: "La seconde fiche (B)" },
      ],
      aide: "L'autre fiche est archivée ; ses dossiers, leads et coordonnées rejoignent celle-ci.",
    },
  ],
  motifsRejet: [
    { code: "PERSONNES_DIFFERENTES", libelle: "Ce sont deux personnes différentes" },
    { code: "MEME_FOYER", libelle: "Même foyer, mais deux clients à garder" },
  ],
  liens: (contenu) => [
    { libelle: "Voir la fiche A", href: `/clients/${contenu.clientAId}` },
    { libelle: "Voir la fiche B", href: `/clients/${contenu.clientBId}` },
  ],
  execution: "IMMEDIATE",
  async executer(contenu, { tx, propositionId }) {
    if (!tx) throw new Error("FUSION_CLIENTS s'exécute dans la transaction de la validation");
    const [conserveId, absorbeId] =
      contenu.conserver === "A" ? [contenu.clientAId, contenu.clientBId] : [contenu.clientBId, contenu.clientAId];
    const conserve = await tx.client.findUnique({ where: { id: conserveId }, select: { nom: true } });
    const resultat = await fusionnerClients(
      tx,
      conserveId,
      absorbeId,
      `Fusionnée dans « ${conserve?.nom ?? conserveId} » (proposition ${propositionId})`
    );
    return { resultat: { conserveId, absorbeId, ...resultat } };
  },
  async pertinente(contenu) {
    const fiches = await prisma.client.findMany({
      where: { id: { in: [contenu.clientAId, contenu.clientBId] } },
      select: { id: true },
    });
    return fiches.length === 2 ? null : "une des deux fiches a déjà été fusionnée ou archivée";
  },
});
