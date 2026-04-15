import { PrismaClient } from "@prisma/client";
import { subDays, addDays } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.commande.deleteMany();
  await prisma.chantier.deleteMany();
  await prisma.facture.deleteMany();
  await prisma.devis.deleteMany();
  await prisma.interaction.deleteMany();
  await prisma.objectif.deleteMany();
  await prisma.lead.deleteMany();

  const now = new Date();

  // 3 NOUVEAU leads (2 without contact for 7+ days)
  const lead1 = await prisma.lead.create({
    data: {
      nom: "Dupont", prenom: "Marie", telephone: "06 12 34 56 78", email: "marie.dupont@gmail.com",
      ville: "Montpellier", codePostal: "34000", source: "META_ADS", statut: "NOUVEAU",
      typeProjet: "CUISINE", referenceChoisie: "NE81", mlEstimes: 12, prixDevis: 2340,
      scoreSignature: 65, createdAt: subDays(now, 10), updatedAt: subDays(now, 10),
    },
  });
  const lead2 = await prisma.lead.create({
    data: {
      nom: "Martin", prenom: "Thomas", telephone: "06 23 45 67 89",
      ville: "Nîmes", codePostal: "30000", source: "TIKTOK", statut: "NOUVEAU",
      typeProjet: "SDB", referenceChoisie: "AA01", mlEstimes: 8, prixDevis: 1560,
      scoreSignature: 42, createdAt: subDays(now, 8), updatedAt: subDays(now, 8),
    },
  });
  const lead3 = await prisma.lead.create({
    data: {
      nom: "Petit", prenom: "Sophie", telephone: "06 34 56 78 90", email: "sophie.petit@hotmail.fr",
      ville: "Montpellier", codePostal: "34070", source: "INSTAGRAM", statut: "NOUVEAU",
      typeProjet: "CUISINE", referenceChoisie: "K1", mlEstimes: 15, prixDevis: 2850,
      scoreSignature: 78, createdAt: subDays(now, 2), updatedAt: subDays(now, 2),
    },
  });

  // 3 CONTACTE leads
  const lead4 = await prisma.lead.create({
    data: {
      nom: "Bernard", prenom: "Lucas", telephone: "06 45 67 89 01", email: "lucas.bernard@orange.fr",
      ville: "Béziers", codePostal: "34500", source: "META_ADS", statut: "CONTACTE",
      typeProjet: "CUISINE", referenceChoisie: "NH10", mlEstimes: 10, prixDevis: 1980,
      scoreSignature: 55, createdAt: subDays(now, 6),
    },
  });
  await prisma.interaction.create({
    data: { type: "APPEL", contenu: "Premier contact, très intéressé par le revêtement NH10 pour sa cuisine. Envoi devis prévu.", leadId: lead4.id },
  });

  const lead5 = await prisma.lead.create({
    data: {
      nom: "Moreau", prenom: "Camille", telephone: "06 56 78 90 12",
      ville: "Sète", codePostal: "34200", source: "ORGANIQUE", statut: "CONTACTE",
      typeProjet: "PRO", referenceChoisie: "MK13", mlEstimes: 25, prixDevis: 4200,
      scoreSignature: 72, createdAt: subDays(now, 4),
    },
  });
  await prisma.interaction.create({
    data: { type: "APPEL", contenu: "Restaurant à rénover, 25ml de comptoir. Demande devis détaillé.", leadId: lead5.id },
  });

  const lead6 = await prisma.lead.create({
    data: {
      nom: "Leroy", prenom: "Emma", telephone: "06 67 89 01 23", email: "emma.leroy@gmail.com",
      ville: "Perpignan", codePostal: "66000", source: "REFERENCE", statut: "CONTACTE",
      typeProjet: "SDB", mlEstimes: 6, scoreSignature: 48, createdAt: subDays(now, 3),
    },
  });

  // 3 DEVIS_ENVOYE (1 expiring in 3 days)
  const lead7 = await prisma.lead.create({
    data: {
      nom: "Roux", prenom: "Antoine", telephone: "06 78 90 12 34", email: "antoine.roux@free.fr",
      ville: "Montpellier", codePostal: "34000", source: "META_ADS", statut: "DEVIS_ENVOYE",
      typeProjet: "CUISINE", referenceChoisie: "K1", mlEstimes: 14, prixDevis: 2680,
      scoreSignature: 70, createdAt: subDays(now, 15),
    },
  });
  await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0001", expiresAt: addDays(now, 3), statut: "ENVOYE",
      reference: "K1", mlTotal: 14, prixMatiere: 504, prixVente: 2680, margeNette: 2176,
      acompte30: 804, solde70: 1876, leadId: lead7.id,
    },
  });

  const lead8 = await prisma.lead.create({
    data: {
      nom: "Fournier", prenom: "Julie", telephone: "06 89 01 23 45",
      ville: "Lyon", codePostal: "69000", source: "TIKTOK", statut: "DEVIS_ENVOYE",
      typeProjet: "MEUBLES", referenceChoisie: "AA01", mlEstimes: 7, prixDevis: 1420,
      scoreSignature: 52, createdAt: subDays(now, 12),
    },
  });
  await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0002", expiresAt: addDays(now, 15), statut: "ENVOYE",
      reference: "AA01", mlTotal: 7, prixMatiere: 252, prixVente: 1420, margeNette: 1168,
      acompte30: 426, solde70: 994, leadId: lead8.id,
    },
  });

  const lead9 = await prisma.lead.create({
    data: {
      nom: "Girard", prenom: "Nicolas", telephone: "06 90 12 34 56", email: "n.girard@outlook.fr",
      ville: "Toulouse", codePostal: "31000", source: "META_ADS", statut: "DEVIS_ENVOYE",
      typeProjet: "CUISINE", referenceChoisie: "NE81", mlEstimes: 11, prixDevis: 2180,
      scoreSignature: 60, createdAt: subDays(now, 20),
    },
  });
  await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0003", expiresAt: addDays(now, 10), statut: "ENVOYE",
      reference: "NE81", mlTotal: 11, prixMatiere: 396, prixVente: 2180, margeNette: 1784,
      acompte30: 654, solde70: 1526, leadId: lead9.id,
    },
  });

  // 2 SIGNE leads with devis + facture
  const lead10 = await prisma.lead.create({
    data: {
      nom: "Bonnet", prenom: "Chloé", telephone: "06 01 23 45 67", email: "chloe.bonnet@gmail.com",
      ville: "Montpellier", codePostal: "34080", source: "META_ADS", statut: "SIGNE",
      typeProjet: "CUISINE", referenceChoisie: "K1", mlEstimes: 16, prixDevis: 3040,
      scoreSignature: 92, createdAt: subDays(now, 25),
    },
  });
  const devis10 = await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0004", expiresAt: addDays(now, 5), statut: "SIGNE",
      reference: "K1", mlTotal: 16, prixMatiere: 576, prixVente: 3040, margeNette: 2464,
      acompte30: 912, solde70: 2128, leadId: lead10.id,
    },
  });
  await prisma.facture.create({
    data: {
      numero: "FACT-2026-0001", statut: "ACOMPTE_EN_ATTENTE", montantTotal: 3040,
      devisId: devis10.id,
    },
  });

  const lead11 = await prisma.lead.create({
    data: {
      nom: "Lambert", prenom: "Hugo", telephone: "06 11 22 33 44", email: "hugo.lambert@laposte.net",
      ville: "Narbonne", codePostal: "11100", source: "ORGANIQUE", statut: "SIGNE",
      typeProjet: "PRO", referenceChoisie: "MK13", mlEstimes: 20, prixDevis: 3500,
      scoreSignature: 88, createdAt: subDays(now, 18),
    },
  });
  const devis11 = await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0005", expiresAt: subDays(now, 2), statut: "SIGNE",
      reference: "MK13", mlTotal: 20, prixMatiere: 720, prixVente: 3500, margeNette: 2780,
      acompte30: 1050, solde70: 2450, leadId: lead11.id,
    },
  });
  await prisma.facture.create({
    data: {
      numero: "FACT-2026-0002", statut: "ACOMPTE_RECU", montantTotal: 3500,
      acompteRecu: true, acompteDate: subDays(now, 5), devisId: devis11.id,
    },
  });

  // 2 CHANTIER_PLANIFIE
  const lead12 = await prisma.lead.create({
    data: {
      nom: "Mercier", prenom: "Léa", telephone: "06 22 33 44 55", email: "lea.mercier@gmail.com",
      ville: "Montpellier", codePostal: "34000", source: "META_ADS", statut: "CHANTIER_PLANIFIE",
      typeProjet: "CUISINE", referenceChoisie: "NH10", mlEstimes: 13, prixDevis: 2520,
      scoreSignature: 95, createdAt: subDays(now, 30),
    },
  });
  const chantier12 = await prisma.chantier.create({
    data: {
      dateIntervention: addDays(now, 5), adresse: "15 rue de la Loge, 34000 Montpellier",
      reference: "NH10", mlCommandes: 13, prixMatiere: 468, margeNette: 2052,
      statut: "MATIERE_RECUE", acompteRecu: true, leadId: lead12.id,
    },
  });
  await prisma.commande.create({
    data: {
      reference: "NH10", quantiteML: 13, prixMatiere: 468, statut: "RECUE",
      dateCommande: subDays(now, 10), dateReceptionReelle: subDays(now, 2), chantierId: chantier12.id,
    },
  });

  const lead13 = await prisma.lead.create({
    data: {
      nom: "Blanc", prenom: "Maxime", telephone: "06 33 44 55 66",
      ville: "Nîmes", codePostal: "30000", source: "INSTAGRAM", statut: "CHANTIER_PLANIFIE",
      typeProjet: "SDB", referenceChoisie: "AA01", mlEstimes: 9, prixDevis: 1780,
      scoreSignature: 90, createdAt: subDays(now, 22),
    },
  });
  const chantier13 = await prisma.chantier.create({
    data: {
      dateIntervention: addDays(now, 12), adresse: "8 avenue Jean Jaurès, 30000 Nîmes",
      reference: "AA01", mlCommandes: 9, prixMatiere: 324, margeNette: 1456,
      statut: "COMMANDE_PASSEE", acompteRecu: true, leadId: lead13.id,
    },
  });
  await prisma.commande.create({
    data: {
      reference: "AA01", quantiteML: 9, prixMatiere: 324, statut: "COMMANDEE",
      dateCommande: subDays(now, 3), dateReceptionEstimee: addDays(now, 4), chantierId: chantier13.id,
    },
  });

  // 1 TERMINE lead with photos
  const lead14 = await prisma.lead.create({
    data: {
      nom: "Dubois", prenom: "Sarah", telephone: "06 44 55 66 77", email: "sarah.dubois@yahoo.fr",
      ville: "Montpellier", codePostal: "34070", source: "META_ADS", statut: "TERMINE",
      typeProjet: "CUISINE", referenceChoisie: "K1", mlEstimes: 11, prixDevis: 2180,
      scoreSignature: 98, createdAt: subDays(now, 45),
    },
  });
  const devis14 = await prisma.devis.create({
    data: {
      numero: "DEVIS-2026-0006", expiresAt: subDays(now, 15), statut: "SIGNE",
      reference: "K1", mlTotal: 11, prixMatiere: 396, prixVente: 2180, margeNette: 1784,
      acompte30: 654, solde70: 1526, leadId: lead14.id,
    },
  });
  await prisma.facture.create({
    data: {
      numero: "FACT-2026-0003", statut: "SOLDEE", montantTotal: 2180,
      acompteRecu: true, acompteDate: subDays(now, 35),
      soldeRecu: true, soldeDate: subDays(now, 14), devisId: devis14.id,
    },
  });
  await prisma.chantier.create({
    data: {
      dateIntervention: subDays(now, 14), adresse: "22 rue du Faubourg, 34070 Montpellier",
      reference: "K1", mlCommandes: 11, prixMatiere: 396, margeNette: 1784,
      statut: "TERMINE", acompteRecu: true, soldeRecu: true,
      photosAvant: JSON.stringify(["/photos/dubois-avant-1.jpg", "/photos/dubois-avant-2.jpg"]),
      photosApres: JSON.stringify(["/photos/dubois-apres-1.jpg", "/photos/dubois-apres-2.jpg"]),
      leadId: lead14.id,
    },
  });

  // 1 PERDU lead
  await prisma.lead.create({
    data: {
      nom: "Garcia", prenom: "Pierre", telephone: "06 55 66 77 88",
      ville: "Marseille", codePostal: "13000", source: "TIKTOK", statut: "PERDU",
      typeProjet: "CUISINE", referenceChoisie: "NE81", mlEstimes: 8, prixDevis: 1560,
      scoreSignature: 25, notes: "Trop cher, a trouvé moins cher ailleurs",
      createdAt: subDays(now, 30),
    },
  });

  // Objectifs for last 3 months
  const months = ["2026-01", "2026-02", "2026-03"];
  for (const m of months) {
    await prisma.objectif.create({
      data: {
        periode: m,
        caMensuel: m === "2026-01" ? 8000 : m === "2026-02" ? 10000 : 12000,
        nombreChantiers: m === "2026-01" ? 4 : m === "2026-02" ? 5 : 6,
        tauxConversion: m === "2026-01" ? 0.28 : m === "2026-02" ? 0.32 : 0.35,
      },
    });
  }

  // Some interactions
  await prisma.interaction.createMany({
    data: [
      { type: "APPEL", contenu: "Appel de découverte, très motivée par la rénovation cuisine", leadId: lead1.id, createdAt: subDays(now, 9) },
      { type: "SMS", contenu: "Envoi du lien vers le simulateur Cover Styl'", leadId: lead3.id, createdAt: subDays(now, 1) },
      { type: "EMAIL", contenu: "Devis envoyé par email", leadId: lead7.id, createdAt: subDays(now, 14) },
      { type: "APPEL", contenu: "Relance téléphonique, toujours intéressé mais en réflexion", leadId: lead7.id, createdAt: subDays(now, 7) },
      { type: "DEVIS", contenu: "Devis signé et retourné", leadId: lead10.id, createdAt: subDays(now, 10) },
      { type: "NOTE", contenu: "Client très satisfait, avis Google laissé", leadId: lead14.id, createdAt: subDays(now, 12) },
    ],
  });

  console.log("✅ Seed terminé : 15 leads, devis, factures, chantiers et objectifs créés");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
