import type { EspaceClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ErreurMetier } from "@/lib/commun/erreurs";
import { jourParis } from "@/lib/dossiers/dates";
import { formatCentimes, versCentimes } from "@/lib/dossiers/montants";
import { enregistrerEncaissement } from "@/lib/encaissements/service";
import { DEVIS_EN_VIGUEUR, faitsPaiements } from "@/lib/encaissements/soldes";
import { prevenir } from "@/lib/espace/alertes";
import { lienPourLeProjet } from "@/lib/espace/liens";
import { chargerProjet } from "@/lib/espace/service";
import { avecActeur } from "@/lib/journal/contexte";
import { alerter } from "@/lib/alertes/canaux";
import { creerSessionCheckout, fenetreSession, stripeActif, type NaturePaiementCarte, type SessionPayee } from "./stripe";

/**
 * Mission 18 (B10, écart 10) — le paiement par carte depuis l'espace du client.
 *
 * 1. Le bouton « Payer par carte » de l'onglet Paiement (site, `EtapePaiement.tsx`) appelle
 *    `POST /api/espace/<jeton>/paiement-carte` : le CRM calcule SEUL ce qui est dû (`aReglerParCarte` : l'acompte du
 *    devis signé, ou le reste des factures d'un chantier facturé), ouvre une session Stripe Checkout et rend son adresse ;
 *    le site y envoie le client, qui revient sur son espace, onglet Paiement.
 * 2. Stripe appelle le webhook signé `POST /api/webhook/stripe` : `enregistrerPaiementStripe` enregistre l'encaissement
 *    (moyen CARTE, origine STRIPE, clé `stripe:<session>` : un événement rejoué ne s'enregistre pas deux fois) par la même
 *    fonction que l'écran (`enregistrerEncaissement`, point d'entrée PAIEMENT_RECU : étape, main, prochaine action, mail
 *    « paiement reçu » de l'automatisme existant), puis prévient Lucas (alerte, pas un envoi au client).
 * Aucun autre envoi au client : les reçus de Stripe restent désactivés dans son tableau de bord.
 */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "https://crm.coverswap.fr").replace(/\/$/, "");

export type ReglementCarte = { nature: NaturePaiementCarte; centimes: number; documentId: string | null; numero: string | null; libelle: string };

/**
 * Ce que le client peut régler par carte maintenant, calculé par le serveur (jamais lu du navigateur) ; null : rien.
 * - l'acompte du devis signé tant qu'il n'est pas reçu en entier (ce que l'espace affiche : montant moins reçu) ;
 * - sinon, chantier facturé, le reste dû sur les factures (pas le solde du devis : la facture peut en différer).
 */
export async function aReglerParCarte(espace: EspaceClient): Promise<ReglementCarte | null> {
  const { dossier, lecture } = await chargerProjet(espace);
  if (!lecture.devis || !lecture.accord || !lecture.paiement) return null;
  const acompte = lecture.paiement.acompte;
  if (acompte && acompte.statut !== "PAYE") {
    const centimes = versCentimes(acompte.montant) - versCentimes(acompte.recu);
    const numero = lecture.devis.numero;
    if (centimes > 0) return { nature: "ACOMPTE", centimes, documentId: lecture.devis.id, numero, libelle: `Acompte – devis ${numero ?? "signé"}` };
  }
  if (dossier.etape === "FACTURE" || dossier.etape === "ENCAISSE") {
    const { resteCentimes, pieces } = await faitsPaiements(prisma, dossier.id);
    const facture = pieces.find((piece) => piece.type === "FACTURE" && piece.active && (piece.resteCentimes ?? 0) > 0);
    if (resteCentimes > 0) return { nature: "SOLDE", centimes: resteCentimes, documentId: facture?.documentId ?? null, numero: facture?.numero ?? null, libelle: `Solde – facture ${facture?.numero ?? "du chantier"}` };
  }
  return null;
}

/** Ouvre la page de paiement Stripe pour ce que le client doit maintenant ; rend son adresse. */
export async function preparerPaiementCarte(espace: EspaceClient, maintenant = new Date()): Promise<{ url: string; nature: NaturePaiementCarte; montant: number }> {
  if (!stripeActif()) throw new ErreurMetier("Le paiement par carte n'est pas ouvert : réglez par virement, ou appelez CoverSwap.", 409, { raison: "carte-fermee" });
  const reglement = await aReglerParCarte(espace);
  if (!reglement) throw new ErreurMetier("Rien à régler par carte pour l'instant.", 409, { raison: "rien-a-regler" });
  const retour = await lienPourLeProjet(espace);
  if (!retour) throw new ErreurMetier("Ce lien n'est plus actif : appelez CoverSwap pour en recevoir un nouveau.", 409, { raison: "lien-revoque" });
  const valides = await prisma.encaissement.count({ where: { dossierId: espace.dossierId, statut: "VALIDE" } });
  // Deux clics rapprochés rendent la même session (même clé, même corps : stripe.ts › FENETRE_SESSION_MS) ; dix minutes
  // plus tard (session peut-être abandonnée), une nouvelle. Deux sessions payées toutes deux : le webhook alerte Lucas.
  const fenetre = fenetreSession(maintenant);
  const session = await creerSessionCheckout({
    centimes: reglement.centimes,
    libelle: reglement.libelle,
    nature: reglement.nature,
    dossierId: espace.dossierId,
    espaceId: espace.id,
    documentId: reglement.documentId,
    retour: `${retour}#paiement`,
    cleIdempotence: `paiement-carte:${espace.dossierId}:${reglement.nature}:${reglement.centimes}:${valides}:${fenetre}`,
    maintenant,
  });
  return { url: session.url, nature: reglement.nature, montant: reglement.centimes / 100 };
}

export type IssuePaiementStripe = { statut: "ENREGISTRE" | "DEJA" | "IGNORE"; raison?: string; dossierId?: string; encaissementId?: string };

const estDoublon = (erreur: unknown) => erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002";

/**
 * Une session payée (webhook signé) devient un encaissement, une seule fois : l'imputation va au devis de l'acompte
 * (s'il est toujours en vigueur ; sinon, comme pour un solde, l'imputation automatique sur les pièces du dossier).
 */
export async function enregistrerPaiementStripe(session: SessionPayee): Promise<IssuePaiementStripe> {
  const cle = `stripe:${session.sessionId}`;
  if (await prisma.encaissement.findUnique({ where: { cleReprise: cle }, select: { id: true } })) return { statut: "DEJA", raison: `session ${session.sessionId} déjà enregistrée` };
  const dossier = session.dossierId ? await prisma.dossier.findUnique({ where: { id: session.dossierId }, select: { id: true, clientNom: true } }) : null;
  if (!dossier) {
    console.error(`[stripe] session ${session.sessionId} payée sans dossier connu (${session.dossierId ?? "aucun"}) : à saisir à la main.`);
    // Mission 18 (relecture) : l'argent est reçu mais n'apparaît nulle part (Stripe ne rejouera pas) : Lucas est prévenu,
    // pour saisir l'encaissement à la main. Une alerte à lui, sans nom de client (aucun envoi au client).
    await alerter(
      { titre: "Paiement par carte sans dossier", texte: `Stripe a reçu ${formatCentimes(session.centimes)} (session ${session.sessionId}) sans dossier du CRM reconnu : à saisir à la main (Finances › Ajouter un paiement).`, lien: `${appUrl()}/finances`, libelleLien: "Ouvrir Finances", urgence: 4, etiquette: `stripe-${session.sessionId}` },
      { origine: "stripe", canaux: ["telegram", "ntfy", "pushweb"] }
    ).catch((erreur) => console.error("[stripe] alerte « paiement sans dossier » non envoyée :", erreur));
    return { statut: "IGNORE", raison: "dossier inconnu" };
  }
  // Mission 18 (relecture) : ce qui restait dû avant ce paiement (la même lecture que « Payer par carte ») ; au-delà, un
  // second paiement de la même échéance (deux fenêtres, deux sessions payées) : enregistré quand même, Lucas alerté.
  const espace = await prisma.espaceClient.findFirst({ where: { dossierId: dossier.id } });
  const restaitDu = espace ? ((await aReglerParCarte(espace).catch(() => null))?.centimes ?? 0) : null;
  const devis =
    session.nature === "ACOMPTE" && session.documentId
      ? await prisma.document.findFirst({ where: { id: session.documentId, dossierId: dossier.id, type: "DEVIS", statut: { in: [...DEVIS_EN_VIGUEUR] } }, select: { id: true } })
      : null;
  const ligne = devis ? await prisma.numeroDocument.findUnique({ where: { documentId: devis.id }, select: { id: true } }) : null;
  const quoi = session.nature === "SOLDE" ? "solde" : "acompte";
  let encaissementId: string;
  try {
    const resultat = await avecActeur({ acteur: "EXTERNE:stripe", origine: "POST /api/webhook/stripe" }, () =>
      enregistrerEncaissement({
        dossierId: dossier.id,
        numeroDocumentId: ligne?.id ?? null,
        paiement: {
          montant: session.centimes / 100,
          moyen: "CARTE",
          recuLe: jourParis(new Date(Math.min(session.creeLe * 1000, Date.now()))),
          reference: session.paiementId ?? session.sessionId,
          note: `Payé en ligne depuis l'espace client (Stripe) : ${quoi}`,
        },
        origine: "STRIPE",
        cleReprise: cle,
      })
    );
    encaissementId = resultat.encaissement.id;
  } catch (erreur) {
    if (estDoublon(erreur)) return { statut: "DEJA", raison: `session ${session.sessionId} déjà enregistrée` };
    throw erreur;
  }
  await prevenir(
    dossier.id,
    { titre: "Paiement par carte reçu", texte: `${dossier.clientNom} : ${formatCentimes(session.centimes)} (${quoi}) payés en ligne.`, urgence: 3, etiquette: `stripe-${session.sessionId}`, rubrique: "encaisser" },
    "stripe"
  );
  if (restaitDu !== null && session.centimes > restaitDu + 50) {
    await prevenir(
      dossier.id,
      { titre: "Paiement par carte en trop", texte: `${dossier.clientNom} : ${formatCentimes(session.centimes)} payés en ligne alors qu'il ne restait que ${formatCentimes(restaitDu)} à régler (deux paiements de la même échéance ?). À vérifier, et à rembourser depuis Stripe si besoin.`, urgence: 4, etiquette: `stripe-trop-${session.sessionId}`, rubrique: "encaisser" },
      "stripe"
    );
  }
  return { statut: "ENREGISTRE", dossierId: dossier.id, encaissementId };
}
