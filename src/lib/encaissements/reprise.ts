import prisma from "@/lib/prisma";
import { versCentimes } from "@/lib/dossiers/montants";
import { cleNumero, lireNumero } from "@/lib/dossiers/numerotation";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";

export type ResumeReprise = { crees: number; dejaRepris: number; sansDate: number; illisibles: number };

/**
 * Reprise des paiements cochés dans l'ancien écran des factures (acompte et
 * solde, avec leur date) en encaissements, pour que le livre des recettes et
 * les seuils les comptent. Les montants sont ceux du devis d'origine (acompte
 * et solde) ; le moyen de paiement, inconnu, reste à compléter. Idempotente
 * (clé de reprise) : relancée chaque heure, elle reprend aussi ce qui serait
 * encore coché dans l'ancien écran. Un paiement coché sans date n'est pas
 * inventé : il est compté, à saisir à la main.
 */
export async function reprendrePaiementsAncienEcran(): Promise<ResumeReprise> {
  const resume: ResumeReprise = { crees: 0, dejaRepris: 0, sansDate: 0, illisibles: 0 };
  const factures = await prisma.facture.findMany({
    where: { OR: [{ acompteRecu: true }, { soldeRecu: true }] },
    include: { devis: { select: { acompte30: true, solde70: true, lead: { select: { prenom: true, nom: true, clientId: true } } } } },
  });

  for (const facture of factures) {
    const lu = lireNumero(facture.numero);
    if (!lu) {
      resume.illisibles++;
      continue;
    }
    const parties = [
      { partie: "acompte", recu: facture.acompteRecu, le: facture.acompteDate, montant: facture.devis.acompte30 },
      { partie: "solde", recu: facture.soldeRecu, le: facture.soldeDate, montant: facture.devis.solde70 },
    ];
    for (const { partie, recu, le, montant } of parties) {
      if (!recu) continue;
      if (!le || !(montant > 0)) {
        resume.sansDate++;
        continue;
      }
      const cleReprise = `ancien-ecran:facture:${facture.id}:${partie}`;
      if (await prisma.encaissement.findUnique({ where: { cleReprise }, select: { id: true } })) {
        resume.dejaRepris++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const cle = cleNumero(lu.famille, lu.annee, lu.rang);
        const ligne =
          (await tx.numeroDocument.findUnique({ where: { cle }, include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } } })) ??
          (await tx.numeroDocument.create({
            data: { cle, numero: facture.numero, famille: lu.famille, annee: lu.annee, rang: lu.rang, type: "FACTURE", origine: "ANCIEN_CRM", emisLe: facture.createdAt, montant: facture.montantTotal },
            include: { affectations: { where: { statut: "ACTIVE" }, select: { montant: true } } },
          }));
        const du = versCentimes(ligne.montant ?? facture.montantTotal);
        const regle = ligne.affectations.reduce((somme, affectation) => somme + versCentimes(affectation.montant), 0);
        const centimes = versCentimes(montant);
        const impute = Math.max(0, Math.min(centimes, du - regle));
        const lead = facture.devis.lead;
        await tx.encaissement.create({
          data: {
            clientId: lead.clientId,
            payeur: lead.prenom === lead.nom ? lead.nom : `${lead.prenom} ${lead.nom}`.trim(),
            montant: centimes / 100,
            moyen: null,
            recuLe: le,
            origine: "REPRISE_ANCIEN_ECRAN",
            cleReprise,
            note: `Repris de l'ancien écran : ${partie} de la facture ${facture.numero}.`,
            affectations: impute > 0 ? { create: [{ numeroDocumentId: ligne.id, montant: impute / 100 }] } : undefined,
          },
        });
      });
      resume.crees++;
    }
  }
  return resume;
}

export function enregistrerTachesEncaissements(): void {
  enregistrerTravailPeriodique({
    nom: "reprise-paiements-ancien-ecran",
    libelle: "Reprise des paiements cochés dans l'ancien écran des factures",
    acteur: "SYSTEME:reprise-encaissements",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      const resume = await reprendrePaiementsAncienEcran();
      if (resume.crees > 0 || resume.sansDate > 0) console.info("[encaissements] reprise de l'ancien écran :", resume);
    },
  });
}
