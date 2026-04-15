import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86400000); }

async function main() {
  const now = new Date();

  // ═══════════════════════════════════════════════════
  // LEAD 1 — Marie Durand — Nouveau lead Meta Ads
  // Scénario : Elle a rempli un formulaire via une pub Instagram
  // Tu dois la rappeler pour qualifier le projet
  // ═══════════════════════════════════════════════════
  const lead1 = await prisma.lead.create({
    data: {
      prenom: "Marie", nom: "Durand",
      telephone: "06 12 34 56 78", email: "marie.durand@gmail.com",
      ville: "Montpellier", codePostal: "34000",
      source: "META_ADS", statut: "NOUVEAU", typeProjet: "CUISINE",
      referenceChoisie: "K1", mlEstimes: 12, prixDevis: 2280,
      scoreSignature: 75,
      createdAt: subDays(now, 3), updatedAt: subDays(now, 3),
    },
  });
  await prisma.interaction.create({
    data: {
      type: "NOTE",
      contenu: "Lead reçu via Meta Ads — Campagne Cuisine Montpellier. A rempli le formulaire après avoir vu la vidéo avant/après.",
      leadId: lead1.id,
      createdAt: subDays(now, 3),
    },
  });

  // ═══════════════════════════════════════════════════
  // LEAD 2 — Thomas Lefebvre — Devis envoyé, attend sa réponse
  // Scénario : Contacté, devis envoyé il y a 7 jours
  // Il hésite avec un peintre classique, tu dois le relancer
  // ═══════════════════════════════════════════════════
  const lead2 = await prisma.lead.create({
    data: {
      prenom: "Thomas", nom: "Lefebvre",
      telephone: "06 23 45 67 89", email: "thomas.lefebvre@outlook.fr",
      ville: "Nîmes", codePostal: "30000",
      source: "INSTAGRAM", statut: "DEVIS_ENVOYE", typeProjet: "SDB",
      referenceChoisie: "NE81", mlEstimes: 8, prixDevis: 1594,
      scoreSignature: 62,
      createdAt: subDays(now, 10),
    },
  });
  await prisma.interaction.createMany({
    data: [
      { type: "APPEL", contenu: "Premier contact — très intéressé par la rénovation de sa salle de bain, veut du effet béton ciré NE81. Salle de bain de 6m², murs + contour baignoire.", leadId: lead2.id, createdAt: subDays(now, 9) },
      { type: "EMAIL", contenu: "Devis DEVIS-2026-0001 envoyé par email — 1 594€ TTC pour 8ml de NE81 + 50€ déplacement Nîmes", leadId: lead2.id, createdAt: subDays(now, 7) },
      { type: "SMS", contenu: "Relance SMS : \"Bonjour Thomas, avez-vous eu le temps de regarder le devis ? Je reste disponible pour toute question.\" — Réponse : \"Oui je compare avec un peintre, je vous redis cette semaine\"", leadId: lead2.id, createdAt: subDays(now, 3) },
    ],
  });
  await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0001", expiresAt: addDays(now, 20), statut: "ENVOYE",
      reference: "NE81", mlTotal: 8, prixMatiere: 307.20, prixVente: 1594.40, margeNette: 1287.20,
      fraisDeplacement: 50, acompte30: 478.32, solde70: 1116.08, leadId: lead2.id,
    },
  });

  // ═══════════════════════════════════════════════════
  // LEAD 3 — Sophie Moreau — Signée, chantier dans 6 jours
  // Scénario : Tout est bon, acompte reçu, matière livrée
  // Tu as juste à poser dans 6 jours
  // ═══════════════════════════════════════════════════
  const lead3 = await prisma.lead.create({
    data: {
      prenom: "Sophie", nom: "Moreau",
      telephone: "06 34 56 78 90", email: "sophie.moreau@gmail.com",
      ville: "Montpellier", codePostal: "34070",
      source: "META_ADS", statut: "CHANTIER_PLANIFIE", typeProjet: "CUISINE",
      referenceChoisie: "NH10", mlEstimes: 14, prixDevis: 2872,
      scoreSignature: 95,
      createdAt: subDays(now, 20),
    },
  });
  await prisma.interaction.createMany({
    data: [
      { type: "APPEL", contenu: "Premier contact — cuisine complète à rénover (plan de travail + crédence + façades), 14ml, très motivée, a déjà vu nos réalisations sur Instagram.", leadId: lead3.id, createdAt: subDays(now, 19) },
      { type: "EMAIL", contenu: "Devis DEVIS-2026-0002 envoyé — 2 872€ TTC pour 14ml de NH10 (bois foncé)", leadId: lead3.id, createdAt: subDays(now, 17) },
      { type: "APPEL", contenu: "Appel de suivi — elle a validé, envoie le bon pour accord signé par email ce soir. Pose prévue dans 2-3 semaines.", leadId: lead3.id, createdAt: subDays(now, 14) },
      { type: "DEVIS", contenu: "Devis signé reçu par email + virement acompte 861,60€ reçu sur le compte", leadId: lead3.id, createdAt: subDays(now, 12) },
      { type: "NOTE", contenu: "Commande NH10 14ml passée chez Tego France (France@tego.eu). Livraison estimée sous 5-7 jours.", leadId: lead3.id, createdAt: subDays(now, 10) },
      { type: "NOTE", contenu: "Matière reçue — 14ml de NH10. Pose confirmée pour le ${addDays(now, 6).toLocaleDateString('fr-FR')}.", leadId: lead3.id, createdAt: subDays(now, 2) },
    ],
  });
  const devis3 = await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0002", expiresAt: subDays(now, 3), statut: "SIGNE",
      reference: "NH10", mlTotal: 14, prixMatiere: 588, prixVente: 2872, margeNette: 2284,
      acompte30: 861.60, solde70: 2010.40, leadId: lead3.id,
    },
  });
  await prisma.facture.create({
    data: {
      numero: "FACT-2026-0001", statut: "ACOMPTE_RECU", montantTotal: 2872,
      acompteRecu: true, acompteDate: subDays(now, 12), devisId: devis3.id,
    },
  });
  const chantier3 = await prisma.chantier.create({
    data: {
      dateIntervention: addDays(now, 6),
      adresse: "23 rue des Aiguerelles, 34070 Montpellier",
      reference: "NH10", mlCommandes: 14, prixMatiere: 588, margeNette: 2284,
      statut: "MATIERE_RECUE", acompteRecu: true, leadId: lead3.id,
    },
  });
  await prisma.commande.create({
    data: {
      reference: "NH10", quantiteML: 14, prixMatiere: 588, statut: "RECUE",
      dateCommande: subDays(now, 10), dateReceptionReelle: subDays(now, 2),
      chantierId: chantier3.id,
    },
  });

  console.log("✅ 3 exemples réalistes créés :");
  console.log("   1. Marie Durand — NOUVEAU (à rappeler)");
  console.log("   2. Thomas Lefebvre — DEVIS ENVOYE (à relancer)");
  console.log("   3. Sophie Moreau — CHANTIER PLANIFIE (pose dans 6 jours)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
