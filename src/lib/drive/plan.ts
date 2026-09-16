import { createHash } from "node:crypto";
import path from "node:path";
import prisma from "@/lib/prisma";
import { LIBELLES_ETAPE, LIBELLES_TYPE_DOCUMENT, type EtapeDossier, type TypeDocument } from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant } from "@/lib/dossiers/montants";
import { estPhotoApres, idPhoto, lireFichier, lirePhotos, typeMimePhoto } from "@/lib/dossiers/stockage";
import { LIBELLES_MOYEN, type MoyenPaiement } from "@/lib/encaissements/constantes";
import { chargerPaiementsDossier } from "@/lib/encaissements/soldes";
import { chargerLivre, livreEnCsv } from "@/lib/finances/livre";
import { pseudonyme } from "@/lib/synthese/references";

/**
 * Ce que le miroir Drive doit contenir, calculé depuis la base (la seule
 * source) : un arbre lisible par client, et la comptabilité.
 *
 *   CoverSwap CRM/
 *     Clients/<client · code>/<AAAA-MM objet>/
 *       Photos avant/…   Photos après/…   Devis et factures/…   Fiche du dossier.txt
 *     Clients/Sans fiche client/<AAAA-MM objet>/…
 *     Comptabilité/<année>/Livre des recettes <année>.csv
 *     Comptabilité/<année>/Justificatifs de dépenses/<AAAA-MM>/<date fournisseur montant>
 *     Archives (retirés du CRM)/
 *
 * Chaque élément porte une clé stable (ce qu'il représente) : renommer un
 * client renomme son dossier Drive, sans rien recréer.
 */

export type ElementPlan = {
  cle: string;
  nom: string;
  parentCle: string | null;
  dossier: boolean;
  /** Fichiers : version du contenu ; un changement renvoie le fichier. */
  empreinte?: string;
  contenu?: () => Promise<{ type: string; octets: Buffer }>;
};

export const CLE_RACINE = "racine";
export const CLE_ARCHIVES = "archives";

const nomLisible = (texte: string) => texte.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Sans nom";
const empreinteDe = (texte: string | Buffer) => createHash("sha256").update(texte).digest("hex");

function ficheDossier(dossier: {
  clientNom: string;
  clientTelephone: string;
  clientEmail: string | null;
  clientAdresse: string;
  clientCp: string;
  clientVille: string;
  objet: string;
  etape: string;
  createdAt: Date;
  dateChantier: Date | null;
  prochaineAction: string | null;
  documents: { type: string; numero: string | null; statut: string; totalHt: number; dateEmission: Date | null }[];
}, paiements: Awaited<ReturnType<typeof chargerPaiementsDossier>>): string {
  const lignes = [
    `${dossier.clientNom} — ${dossier.objet}`,
    "",
    `Adresse du chantier : ${dossier.clientAdresse}, ${dossier.clientCp} ${dossier.clientVille}`,
    `Téléphone : ${dossier.clientTelephone}${dossier.clientEmail ? ` · E-mail : ${dossier.clientEmail}` : ""}`,
    `Ouvert le ${formatDateCourte(dossier.createdAt)} · étape : ${LIBELLES_ETAPE[dossier.etape as EtapeDossier] ?? dossier.etape}`,
    dossier.dateChantier ? `Chantier prévu le ${formatDateCourte(dossier.dateChantier)}` : "",
    dossier.prochaineAction ? `Prochaine action : ${dossier.prochaineAction}` : "",
    "",
    "Documents",
    ...dossier.documents
      .filter((document) => document.numero)
      .map((document) => `- ${LIBELLES_TYPE_DOCUMENT[document.type as TypeDocument] ?? document.type} ${document.numero} du ${document.dateEmission ? formatDateCourte(document.dateEmission) : "?"} : ${formatMontant(document.totalHt)} (${document.statut.toLowerCase()})`),
    "",
    "Paiements",
    ...(paiements.encaissements.length
      ? paiements.encaissements.map(
          (encaissement) =>
            `- ${formatDateCourte(encaissement.recuLe)} : ${formatMontant(encaissement.montant)} par ${encaissement.moyen ? LIBELLES_MOYEN[encaissement.moyen as MoyenPaiement].toLowerCase() : "moyen non renseigné"}${encaissement.statut === "VALIDE" ? "" : ` (${encaissement.statut === "REJETE" ? "rejeté" : "annulé"})`}`
        )
      : ["- aucun"]),
    paiements.resteDu > 0 ? `Reste à encaisser : ${formatMontant(paiements.resteDu)}` : "",
    "",
    "Copie en lecture : le CRM fait foi, cette fiche est réécrite à chaque changement.",
  ];
  return lignes.filter((ligne, index, toutes) => ligne !== "" || toutes[index - 1] !== "").join("\n");
}

export async function planMiroir(maintenant: Date = new Date()): Promise<ElementPlan[]> {
  const plan: ElementPlan[] = [
    { cle: CLE_RACINE, nom: "CoverSwap CRM", parentCle: null, dossier: true },
    { cle: "clients", nom: "Clients", parentCle: CLE_RACINE, dossier: true },
    { cle: "clients:sans-fiche", nom: "Sans fiche client", parentCle: "clients", dossier: true },
    { cle: "comptabilite", nom: "Comptabilité", parentCle: CLE_RACINE, dossier: true },
    { cle: CLE_ARCHIVES, nom: "Archives (retirés du CRM)", parentCle: CLE_RACINE, dossier: true },
  ];

  const [clients, dossiers] = await Promise.all([
    prisma.client.findMany({ where: { fusionneDansId: null }, select: { id: true, nom: true } }),
    prisma.dossier.findMany({
      select: {
        id: true,
        clientId: true,
        clientNom: true,
        clientTelephone: true,
        clientEmail: true,
        clientAdresse: true,
        clientCp: true,
        clientVille: true,
        objet: true,
        etape: true,
        createdAt: true,
        dateChantier: true,
        prochaineAction: true,
        photos: true,
        documents: { where: { numero: { not: null } }, select: { id: true, type: true, numero: true, statut: true, totalHt: true, dateEmission: true, pdfPath: true, destinataire: true, origine: true } },
      },
    }),
  ]);

  const clientsAvecDossier = new Set(dossiers.map((dossier) => dossier.clientId).filter(Boolean));
  for (const client of clients.filter((candidat) => clientsAvecDossier.has(candidat.id))) {
    plan.push({ cle: `client:${client.id}`, nom: nomLisible(`${client.nom} · ${pseudonyme(client.id)}`), parentCle: "clients", dossier: true });
  }

  const { lirePdfDocument, nomFichierPdf } = await import("@/lib/dossiers/documents");
  for (const dossier of dossiers) {
    const cle = `dossier:${dossier.id}`;
    const parent = dossier.clientId && clients.some((client) => client.id === dossier.clientId) ? `client:${dossier.clientId}` : "clients:sans-fiche";
    plan.push({ cle, nom: nomLisible(`${jourParis(dossier.createdAt).slice(0, 7)} ${dossier.objet}`), parentCle: parent, dossier: true });
    plan.push({ cle: `${cle}:photos-avant`, nom: "Photos avant", parentCle: cle, dossier: true });
    plan.push({ cle: `${cle}:photos-apres`, nom: "Photos après", parentCle: cle, dossier: true });
    plan.push({ cle: `${cle}:documents`, nom: "Devis et factures", parentCle: cle, dossier: true });

    const rangs = { avant: 0, apres: 0 };
    for (const chemin of lirePhotos(dossier.photos)) {
      const apres = estPhotoApres(chemin);
      const rang = apres ? ++rangs.apres : ++rangs.avant;
      plan.push({
        cle: `photo:${dossier.id}:${idPhoto(chemin)}`,
        nom: `Photo ${String(rang).padStart(2, "0")}${path.posix.extname(chemin)}`,
        parentCle: `${cle}:${apres ? "photos-apres" : "photos-avant"}`,
        dossier: false,
        empreinte: chemin,
        contenu: async () => {
          const octets = await lireFichier(chemin);
          if (!octets) throw new Error(`Photo absente du stockage : ${chemin}`);
          return { type: typeMimePhoto(chemin), octets };
        },
      });
    }

    // Un document repris sans PDF importé n'a rien à copier.
    for (const document of dossier.documents.filter((candidat) => candidat.origine === "CRM" || candidat.pdfPath)) {
      plan.push({
        cle: `document:${document.id}`,
        nom: nomFichierPdf(document.type, document.numero!, dossier.clientNom),
        parentCle: `${cle}:documents`,
        dossier: false,
        // Un document émis ne change plus : son statut (remplacé, annulé) figure dans la fiche.
        empreinte: `${document.id}:${document.pdfPath ?? ""}`,
        contenu: async () => ({ type: "application/pdf", octets: (await lirePdfDocument(dossier.id, document.id)).contenu }),
      });
    }

    const paiements = await chargerPaiementsDossier(prisma, dossier.id);
    const fiche = ficheDossier(dossier, paiements);
    plan.push({
      cle: `${cle}:fiche`,
      nom: "Fiche du dossier.txt",
      parentCle: cle,
      dossier: false,
      empreinte: empreinteDe(fiche),
      contenu: async () => ({ type: "text/plain; charset=utf-8", octets: Buffer.from(fiche, "utf8") }),
    });
  }

  // Comptabilité : livre des recettes et justificatifs, par année.
  const anneeCourante = Number(jourParis(maintenant).slice(0, 4));
  const depenses = await prisma.depense.findMany({
    where: { justificatifId: { not: null } },
    select: { id: true, payeeLe: true, fournisseur: true, montant: true, justificatif: { select: { id: true, empreinte: true, chemin: true, typeMime: true, archiveLe: true } } },
  });
  const premiereAnnee = Math.min(anneeCourante, ...depenses.map((depense) => Number(jourParis(depense.payeeLe).slice(0, 4))), ...dossiers.map((dossier) => Number(jourParis(dossier.createdAt).slice(0, 4))));
  for (let annee = premiereAnnee; annee <= anneeCourante; annee++) {
    const cleAnnee = `comptabilite:${annee}`;
    plan.push({ cle: cleAnnee, nom: String(annee), parentCle: "comptabilite", dossier: true });
    const livre = await chargerLivre(`${annee}-01-01`, `${annee}-12-31`);
    if (livre.manquants.length === 0 && livre.lignes.length > 0) {
      const csv = livreEnCsv(livre.lignes);
      plan.push({
        cle: `livre:${annee}`,
        nom: `Livre des recettes ${annee}.csv`,
        parentCle: cleAnnee,
        dossier: false,
        empreinte: empreinteDe(csv),
        contenu: async () => ({ type: "text/csv; charset=utf-8", octets: Buffer.from(csv, "utf8") }),
      });
    }
    const deLAnnee = depenses.filter((depense) => depense.justificatif && !depense.justificatif.archiveLe && jourParis(depense.payeeLe).startsWith(`${annee}-`));
    if (deLAnnee.length === 0) continue;
    plan.push({ cle: `justificatifs:${annee}`, nom: "Justificatifs de dépenses", parentCle: cleAnnee, dossier: true });
    for (const mois of [...new Set(deLAnnee.map((depense) => jourParis(depense.payeeLe).slice(0, 7)))]) {
      plan.push({ cle: `justificatifs:${mois}`, nom: mois, parentCle: `justificatifs:${annee}`, dossier: true });
    }
    for (const depense of deLAnnee) {
      const justificatif = depense.justificatif!;
      plan.push({
        cle: `justificatif:${depense.id}`,
        nom: nomLisible(`${jourParis(depense.payeeLe)} ${depense.fournisseur} ${String(depense.montant.toFixed(2)).replace(".", ",")} €${path.posix.extname(justificatif.chemin)}`),
        parentCle: `justificatifs:${jourParis(depense.payeeLe).slice(0, 7)}`,
        dossier: false,
        empreinte: justificatif.empreinte,
        contenu: async () => {
          const octets = await lireFichier(justificatif.chemin);
          if (!octets) throw new Error(`Justificatif absent du stockage : ${justificatif.chemin}`);
          return { type: justificatif.typeMime, octets };
        },
      });
    }
  }
  return plan;
}
