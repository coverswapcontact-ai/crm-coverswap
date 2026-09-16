import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { enregistrerEncaissementDansTransaction } from "@/lib/encaissements/service";
import { schemaPaiement } from "@/lib/encaissements/schemas";
import { ETAPES_ACTIVES, LIBELLES_ETAPE, type EtapeActive, type EtapeDossier } from "./constants";
import { dateDepuisJour, estJourValide, formatDateCourte, jourParis } from "./dates";
import { rattacherDocumentExistant, schemaDocumentExistant } from "./documents-existants";
import { originesDuDossier, ouvrirDossier, reculerPremierContact, schemaCreation, suitesOuverture } from "./dossiers";
import { lireMetadataChangementEtape, rangEtape, type MetadataChangementEtape } from "./regles";
import { effetsDuChangementEtape } from "./transitions";

/**
 * Reprise d'un dossier commencé avant le CRM, en une fois : le client, l'étape
 * où en est le chantier, ses dates clés, les devis et factures déjà émis, les
 * paiements déjà reçus. Tout s'écrit dans une transaction, ou rien.
 *
 * Le parcours se reconstitue à ses dates réelles : l'ouverture, un passage par
 * jalon daté (devis envoyé, signé, chantier, facturé) et l'arrivée à l'étape
 * actuelle. Un jalon sans date n'invente rien ; l'arrivée à l'étape actuelle
 * sans date est gardée « date inconnue » (signalée, à compléter).
 */

/** Jalons qui se datent à la reprise, dans l'ordre du tunnel. */
export const JALONS_REPRISE = ["DEVIS_ENVOYE", "SIGNE", "CHANTIER", "FACTURE"] as const;
export type JalonReprise = (typeof JALONS_REPRISE)[number];

const jourPasse = (message: string) =>
  z
    .string(message)
    .refine(estJourValide, message)
    .refine((jour) => jour <= jourParis(new Date()), `${message.replace(/ invalide\.$/, "")} : la date est à venir.`);

export const schemaReprise = z.object({
  dossier: schemaCreation.omit({ etape: true, dateChantier: true }),
  /** Étape où en est le chantier aujourd'hui. */
  etape: z.enum(ETAPES_ACTIVES, "Étape invalide."),
  dates: z
    .object({
      ouvertLe: jourPasse("Date d'ouverture invalide.").optional(),
      jalons: z.partialRecord(z.enum(JALONS_REPRISE, "Jalon invalide."), jourPasse("Date de jalon invalide.")).optional(),
      /** Arrivée à l'étape actuelle. */
      etapeDepuisLe: jourPasse("Date d'arrivée à l'étape invalide.").optional(),
      /** Date du chantier (prévue ou passée). */
      dateChantier: z.string("Date du chantier invalide.").refine(estJourValide, "Date du chantier invalide.").optional(),
    })
    .default({}),
  documents: z.array(schemaDocumentExistant, "Documents invalides.").max(20, "20 documents au plus par reprise.").default([]),
  paiements: z.array(schemaPaiement, "Paiements invalides.").max(40, "40 paiements au plus par reprise.").default([]),
});
export type EntreeReprise = z.output<typeof schemaReprise>;

export type ResultatReprise = { id: string; documents: { index: number; documentId: string }[]; avertissements: string[] };

export async function reprendreDossier(entree: EntreeReprise): Promise<ResultatReprise> {
  const origines = await originesDuDossier(entree.dossier);
  const etape: EtapeActive = entree.etape;
  const rangActuel = rangEtape(etape);

  const resultat = await prisma.$transaction(
    async (tx) => {
      const avertissements: string[] = [];
      const dossier = await ouvrirDossier(
        tx,
        { ...entree.dossier, etape: "QUALIFICATION", dateChantier: entree.dates.dateChantier ?? null },
        { leadId: origines.lead?.id ?? null, prospectId: origines.prospect?.id ?? null }
      );

      // Ouverture à sa date réelle.
      const ouvertLe = entree.dates.ouvertLe ? dateDepuisJour(entree.dates.ouvertLe) : null;
      if (ouvertLe) {
        await tx.dossier.update({ where: { id: dossier.id }, data: { ouvertLe } });
        const ouverture = (await tx.dossierEvenement.findMany({ where: { dossierId: dossier.id, type: "CHANGEMENT_ETAPE" }, select: { id: true, metadata: true } })).find(
          (evenement) => lireMetadataChangementEtape(evenement.metadata)?.nature === "OUVERTURE"
        );
        if (ouverture) await tx.dossierEvenement.update({ where: { id: ouverture.id }, data: { survenuLe: ouvertLe } });
        await reculerPremierContact(tx, dossier.id);
      }

      // Documents déjà émis, puis paiements déjà reçus (imputés sur ces pièces).
      const documents: ResultatReprise["documents"] = [];
      for (const [index, document] of entree.documents.entries()) {
        const rattache = await rattacherDocumentExistant(tx, dossier.id, document);
        documents.push({ index, documentId: rattache.documentId });
        avertissements.push(...rattache.avertissements);
      }
      for (const paiement of entree.paiements) {
        await enregistrerEncaissementDansTransaction(tx, { dossierId: dossier.id, paiement });
      }

      // Parcours : un passage par jalon daté, puis l'arrivée à l'étape actuelle.
      if (rangActuel > 0) {
        const devisAccepte = await tx.document.findFirst({
          where: { dossierId: dossier.id, type: "DEVIS", statut: "ACCEPTE" },
          orderBy: { dateEmission: "desc" },
          select: { id: true },
        });
        const dates: { libelle: string; jour: string }[] = entree.dates.ouvertLe ? [{ libelle: "l'ouverture", jour: entree.dates.ouvertLe }] : [];
        let precedente: EtapeDossier = "QUALIFICATION";
        let derniere = ouvertLe;
        const passage = async (vers: EtapeActive, jour: string | undefined) => {
          const survenuLe = jour ? dateDepuisJour(jour) : derniere;
          const metadata: MetadataChangementEtape = {
            de: precedente,
            vers,
            nature: "SUIVANTE",
            ...(vers === "SIGNE" && devisAccepte ? { documentId: devisAccepte.id } : {}),
            ...(jour ? {} : { dateInconnue: true }),
          };
          await tx.dossierEvenement.create({
            data: {
              dossierId: dossier.id,
              type: "CHANGEMENT_ETAPE",
              direction: "INTERNE",
              contenu: `${LIBELLES_ETAPE[precedente]} → ${LIBELLES_ETAPE[vers]} (dossier repris${jour ? `, le ${formatDateCourte(dateDepuisJour(jour))}` : ", date inconnue"})`,
              metadata: JSON.stringify(metadata),
              survenuLe,
            },
          });
          if (jour) {
            dates.push({ libelle: `« ${LIBELLES_ETAPE[vers]} »`, jour });
            derniere = dateDepuisJour(jour);
          }
          precedente = vers;
        };
        for (const jalon of JALONS_REPRISE) {
          const jour = entree.dates.jalons?.[jalon];
          if (rangEtape(jalon) < rangActuel && jour) await passage(jalon, jour);
        }
        await passage(etape, entree.dates.etapeDepuisLe);
        await tx.dossier.update({ where: { id: dossier.id }, data: { etape } });

        const desordre = dates.find((date, index) => index > 0 && date.jour < dates[index - 1].jour);
        if (desordre) {
          const avant = dates[dates.indexOf(desordre) - 1];
          avertissements.push(`Les dates ne se suivent pas : ${desordre.libelle} le ${formatDateCourte(dateDepuisJour(desordre.jour))}, avant ${avant.libelle} le ${formatDateCourte(dateDepuisJour(avant.jour))}.`);
        }
        if (!entree.dates.etapeDepuisLe) avertissements.push(`Date d'arrivée en « ${LIBELLES_ETAPE[etape]} » inconnue : à compléter sur le dossier.`);
      }
      return { id: dossier.id, documents, avertissements };
    },
    { maxWait: 10_000, timeout: 60_000 }
  );

  await suitesOuverture(origines, resultat.id);
  // Le lead d'origine suit l'étape ; une reprise n'envoie rien à Meta.
  if (rangActuel > 0) await effetsDuChangementEtape({ dossierId: resultat.id, de: "QUALIFICATION", vers: etape, nature: "REPRISE" });
  return resultat;
}
