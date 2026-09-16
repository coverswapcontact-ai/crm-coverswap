import { cleNumero, lireNumero } from "@/lib/dossiers/numerotation";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { BaseDonnees } from "@/lib/prisma";
import type { MigrationDonnees } from "./index";

/**
 * Numérotation manuelle de 2026, d'avant le CRM : une série partagée entre
 * devis et factures, de 2026-001 à 2026-037 (030 et 032 sont des factures,
 * 031 et 033 à 037 des devis ; la nature de 001 à 029 n'est pas connue). Ces
 * numéros ont été envoyés à des clients : ils ne seront jamais réattribués.
 */
const MANUELS_2026 = { dernierRang: 37, factures: [30, 32], devis: [31, 33, 34, 35, 36, 37] };

type Inscription = {
  numero: string;
  type: string;
  origine: "CRM" | "ANCIEN_CRM" | "MANUEL";
  emisLe: Date | null;
  montant: number | null;
  destinataire: string | null;
  documentId?: string;
  note?: string;
};

async function inscrire(client: BaseDonnees, inscription: Inscription): Promise<"inscrit" | "lie" | "doublon" | "deja" | "illisible"> {
  const lu = lireNumero(inscription.numero);
  if (!lu) return "illisible";
  const cle = cleNumero(lu.famille, lu.annee, lu.rang);
  const existant = await client.numeroDocument.findUnique({ where: { cle } });
  if (!existant) {
    await client.numeroDocument.create({
      data: { cle, famille: lu.famille, annee: lu.annee, rang: lu.rang, ...inscription },
    });
    return "inscrit";
  }
  if (inscription.documentId && existant.documentId === inscription.documentId) return "deja";
  if (inscription.documentId && !existant.documentId && existant.origine === "CRM") {
    await client.numeroDocument.update({ where: { id: existant.id }, data: { documentId: inscription.documentId } });
    return "lie";
  }
  if (existant.origine === inscription.origine && !inscription.documentId) return "deja";
  // Le même numéro a été émis deux fois (avant le registre) : on le signale, sans rien écraser.
  const trace = `Doublon constaté : aussi émis par ${inscription.origine === "ANCIEN_CRM" ? "l'ancien écran" : "le CRM"} (${inscription.numero}${inscription.documentId ? `, document ${inscription.documentId}` : ""}).`;
  if (!existant.note?.includes(trace)) {
    await client.numeroDocument.update({
      where: { id: existant.id },
      data: { note: [existant.note, trace].filter(Boolean).join(" ") },
    });
  }
  return "doublon";
}

export const migrationRegistreNumeros: MigrationDonnees = {
  nom: "2026-09-17-registre-numeros",
  description: "Inscrit au registre tous les numéros déjà émis : manuels 2026, ancien écran, module Dossiers",
  async executer(client) {
    const resume: Record<string, number> = {};
    const compter = (cle: string) => (resume[cle] = (resume[cle] ?? 0) + 1);

    for (let rang = 1; rang <= MANUELS_2026.dernierRang; rang++) {
      const type = MANUELS_2026.factures.includes(rang) ? "FACTURE" : MANUELS_2026.devis.includes(rang) ? "DEVIS" : "INCONNU";
      compter(
        `manuel:${await inscrire(client, {
          numero: `2026-${String(rang).padStart(3, "0")}`,
          type,
          origine: "MANUEL",
          emisLe: null,
          montant: null,
          destinataire: null,
          note: "Numérotation manuelle d'avant le CRM (série partagée entre devis et factures).",
        })}`
      );
    }

    for (const devis of await client.devis.findMany({ select: { numero: true, createdAt: true, prixVente: true } })) {
      compter(`ancienDevis:${await inscrire(client, { numero: devis.numero, type: "DEVIS", origine: "ANCIEN_CRM", emisLe: devis.createdAt, montant: devis.prixVente, destinataire: null })}`);
    }
    for (const facture of await client.facture.findMany({ select: { numero: true, createdAt: true, montantTotal: true } })) {
      compter(`ancienneFacture:${await inscrire(client, { numero: facture.numero, type: "FACTURE", origine: "ANCIEN_CRM", emisLe: facture.createdAt, montant: facture.montantTotal, destinataire: null })}`);
    }

    const documents = await client.document.findMany({
      where: { ...AVEC_ARCHIVES, numero: { not: null } },
      include: { dossier: { select: { clientId: true, clientNom: true, clientAdresse: true, clientCp: true, clientVille: true, client: { select: { categorie: true, siret: true } } } } },
    });
    for (const document of documents) {
      compter(
        `document:${await inscrire(client, {
          numero: document.numero!,
          type: document.type,
          origine: "CRM",
          emisLe: document.dateEmission,
          montant: document.totalHt,
          destinataire: document.dossier.clientNom,
          documentId: document.id,
        })}`
      );
      // Compléments figés, pour les documents émis avant eux (renseignés une fois, jamais modifiés).
      const categorie = document.dossier.client?.categorie ?? "PARTICULIER";
      const complements: { clientId?: string; destinataire?: string; categorieClient?: string } = {};
      if (!document.clientId && document.dossier.clientId) complements.clientId = document.dossier.clientId;
      if (!document.destinataire) {
        complements.destinataire = JSON.stringify({
          nom: document.dossier.clientNom,
          adresse: document.dossier.clientAdresse,
          codePostal: document.dossier.clientCp,
          ville: document.dossier.clientVille,
          siret: categorie === "PARTICULIER" ? null : (document.dossier.client?.siret ?? null),
          categorie,
        });
      }
      if (!document.categorieClient) complements.categorieClient = categorie;
      if (Object.keys(complements).length > 0) {
        await client.document.update({ where: { id: document.id }, data: complements });
        compter("document:complete");
      }
    }
    return resume;
  },
};
