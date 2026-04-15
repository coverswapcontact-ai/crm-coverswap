import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Helpers ──
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const PRENOMS = ["Lucas", "Marie", "Thomas", "Sophie", "Antoine", "Julie", "Pierre", "Camille", "Nicolas", "Emma", "Alexandre", "Laura", "Julien", "Chloe", "Maxime", "Lea", "Hugo", "Manon", "Romain", "Sarah", "Kevin", "Pauline", "Clement", "Marine", "Florian", "Charlotte", "Baptiste", "Oceane", "Quentin", "Margaux"];
const NOMS = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel", "Girard", "Andre", "Mercier", "Dupont", "Lambert", "Bonnet", "Francois", "Martinez", "Blanc"];
const VILLES = [
  { v: "Montpellier", cp: "34000" }, { v: "Perols", cp: "34470" }, { v: "Lattes", cp: "34970" },
  { v: "Castelnau-le-Lez", cp: "34170" }, { v: "Mauguio", cp: "34130" }, { v: "Nimes", cp: "30000" },
  { v: "Beziers", cp: "34500" }, { v: "Sete", cp: "34200" }, { v: "Palavas", cp: "34250" },
  { v: "Lunel", cp: "34400" }, { v: "Grabels", cp: "34790" }, { v: "Juvignac", cp: "34990" },
  { v: "Toulouse", cp: "31000" }, { v: "Marseille", cp: "13000" }, { v: "Lyon", cp: "69000" },
  { v: "Paris", cp: "75000" }, { v: "Perpignan", cp: "66000" }, { v: "Narbonne", cp: "11100" },
];
const SOURCES = ["SITE_SIMULATEUR", "SITE_CONTACT", "SITE_DEVIS", "META_ADS", "ORGANIQUE", "ORGANIQUE"];
const TYPES = ["CUISINE", "CUISINE", "CUISINE", "SDB", "MEUBLES", "PRO", "AUTRE"];
const REFS_CUISINE = ["AA04", "AA12", "AA21", "MK14", "NE24", "K1", "KI01", "LP04", "R11", "AA08", "MK02", "NE12"];
const REFS_SDB = ["MK14", "MK02", "NE24", "AA21", "K1"];
const REFS_MEUBLES = ["AA04", "AA12", "LP04", "K1", "KI01"];

const STATUTS_PIPELINE = [
  "NOUVEAU", "NOUVEAU", "CONTACTE", "CONTACTE", "DEVIS_ENVOYE",
  "DEVIS_ENVOYE", "SIGNE", "SIGNE", "CHANTIER_PLANIFIE", "TERMINE", "TERMINE", "PERDU"
];

async function main() {
  console.log("🧹 Nettoyage...");
  await prisma.interaction.deleteMany();
  await prisma.commande.deleteMany();
  await prisma.chantier.deleteMany();
  await prisma.facture.deleteMany();
  await prisma.devis.deleteMany();
  await prisma.lead.deleteMany();

  console.log("🌱 Création des leads...");

  // On veut ~45k€ de CA total en factures soldées
  // Panier moyen ~2500€, donc ~18 chantiers terminés
  // + des leads en cours dans le pipeline

  const leads = [];
  let devisCounter = 1;
  let factureCounter = 1;
  let totalCA = 0;

  // ── 18 leads TERMINES avec factures soldées (~45k CA) ──
  for (let i = 0; i < 18; i++) {
    const ville = rand(VILLES);
    const type = rand(["CUISINE", "CUISINE", "CUISINE", "SDB", "MEUBLES"]);
    const ref = type === "CUISINE" ? rand(REFS_CUISINE) : type === "SDB" ? rand(REFS_SDB) : rand(REFS_MEUBLES);
    const ml = randInt(8, 35);
    const prixM2 = randInt(85, 140);
    const prixVente = ml * prixM2;
    const prixMatiere = ml * randInt(18, 28);
    const margeNette = prixVente - prixMatiere;
    const fraisDeplacement = ville.v === "Paris" || ville.v === "Lyon" || ville.v === "Toulouse" || ville.v === "Marseille" ? randInt(150, 350) : randInt(0, 80);
    const prixTotal = prixVente + fraisDeplacement;
    const createdDaysAgo = randInt(30, 180);

    totalCA += prixTotal;

    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        email: `client${i}@email.com`,
        telephone: `06${String(randInt(10000000, 99999999))}`,
        ville: ville.v,
        codePostal: ville.cp,
        source: rand(SOURCES),
        statut: "TERMINE",
        typeProjet: type,
        referenceChoisie: ref,
        mlEstimes: ml,
        prixDevis: prixTotal,
        scoreSignature: randInt(60, 95),
        notes: `Chantier termine — ${ml}ml de ${ref}`,
        lienSimulation: type === "CUISINE" ? `https://coverswap.fr/sim/${Math.random().toString(36).slice(2, 8)}` : undefined,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(randInt(5, 25)),
      },
    });

    // Interaction
    await prisma.interaction.create({
      data: {
        type: "NOTE",
        contenu: `Lead recu via webhook (${lead.source})`,
        leadId: lead.id,
        createdAt: daysAgo(createdDaysAgo),
      },
    });
    await prisma.interaction.create({
      data: {
        type: "APPEL",
        contenu: "Premier contact telephonique — RDV pris",
        leadId: lead.id,
        createdAt: daysAgo(createdDaysAgo - 1),
      },
    });

    // Devis
    const devisNum = `DEV-2026-${String(devisCounter++).padStart(3, "0")}`;
    const devis = await prisma.devis.create({
      data: {
        numero: devisNum,
        statut: "SIGNE",
        reference: ref,
        mlTotal: ml,
        prixMatiere,
        prixVente: prixTotal,
        margeNette,
        fraisDeplacement,
        acompte30: Math.round(prixTotal * 0.3),
        solde70: Math.round(prixTotal * 0.7),
        leadId: lead.id,
        expiresAt: daysAgo(createdDaysAgo - 30),
        createdAt: daysAgo(createdDaysAgo - 2),
      },
    });

    // Facture soldée
    const factNum = `FAC-2026-${String(factureCounter++).padStart(3, "0")}`;
    await prisma.facture.create({
      data: {
        numero: factNum,
        statut: "SOLDEE",
        montantTotal: prixTotal,
        acompteRecu: true,
        acompteDate: daysAgo(createdDaysAgo - 5),
        soldeRecu: true,
        soldeDate: daysAgo(randInt(5, 20)),
        devisId: devis.id,
        createdAt: daysAgo(createdDaysAgo - 3),
      },
    });

    // Chantier terminé
    await prisma.chantier.create({
      data: {
        dateIntervention: daysAgo(randInt(7, 30)),
        adresse: `${randInt(1, 200)} ${rand(["rue de la Paix", "avenue de la Mer", "boulevard Gambetta", "place de la Comedie", "chemin des Oliviers", "impasse des Lilas", "rue du Moulin", "avenue Jean Jaures"])} ${ville.v}`,
        reference: ref,
        mlCommandes: ml,
        prixMatiere,
        margeNette,
        statut: "TERMINE",
        acompteRecu: true,
        soldeRecu: true,
        leadId: lead.id,
      },
    });

    leads.push(lead);
  }

  console.log(`✅ 18 chantiers termines — CA total: ${totalCA}€`);

  // ── 5 leads SIGNES avec chantier planifié (acompte reçu) ──
  for (let i = 0; i < 5; i++) {
    const ville = rand(VILLES.slice(0, 8));
    const ref = rand(REFS_CUISINE);
    const ml = randInt(12, 30);
    const prixVente = ml * randInt(90, 130);
    const prixMatiere = ml * randInt(20, 26);

    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        email: `signe${i}@email.com`,
        telephone: `06${String(randInt(10000000, 99999999))}`,
        ville: ville.v,
        codePostal: ville.cp,
        source: rand(SOURCES),
        statut: "CHANTIER_PLANIFIE",
        typeProjet: "CUISINE",
        referenceChoisie: ref,
        mlEstimes: ml,
        prixDevis: prixVente,
        scoreSignature: randInt(75, 95),
        notes: `Chantier planifie — ${ml}ml de ${ref}`,
        createdAt: daysAgo(randInt(10, 40)),
        updatedAt: daysAgo(randInt(1, 5)),
      },
    });

    await prisma.interaction.create({
      data: { type: "NOTE", contenu: `Lead recu via webhook (${lead.source})`, leadId: lead.id },
    });

    const devisNum = `DEV-2026-${String(devisCounter++).padStart(3, "0")}`;
    const devis = await prisma.devis.create({
      data: {
        numero: devisNum,
        statut: "SIGNE",
        reference: ref,
        mlTotal: ml,
        prixMatiere,
        prixVente,
        margeNette: prixVente - prixMatiere,
        acompte30: Math.round(prixVente * 0.3),
        solde70: Math.round(prixVente * 0.7),
        leadId: lead.id,
        expiresAt: daysAgo(-30),
        createdAt: daysAgo(randInt(5, 15)),
      },
    });

    const factNum = `FAC-2026-${String(factureCounter++).padStart(3, "0")}`;
    await prisma.facture.create({
      data: {
        numero: factNum,
        statut: "ACOMPTE_EN_ATTENTE",
        montantTotal: prixVente,
        acompteRecu: i < 3,
        acompteDate: i < 3 ? daysAgo(randInt(1, 5)) : undefined,
        devisId: devis.id,
      },
    });

    await prisma.chantier.create({
      data: {
        dateIntervention: daysAgo(-randInt(3, 14)),
        adresse: `${randInt(1, 150)} ${rand(["rue des Acacias", "avenue de Toulouse", "boulevard du Jeu de Paume", "rue Foch", "place Albert 1er"])} ${ville.v}`,
        reference: ref,
        mlCommandes: ml,
        prixMatiere,
        margeNette: prixVente - prixMatiere,
        statut: i < 2 ? "MATIERE_RECUE" : "COMMANDE_PASSEE",
        acompteRecu: i < 3,
        leadId: lead.id,
      },
    });
  }
  console.log("✅ 5 chantiers planifies");

  // ── 8 leads DEVIS_ENVOYE (pipeline) ──
  for (let i = 0; i < 8; i++) {
    const ville = rand(VILLES);
    const type = rand(TYPES);
    const ref = type === "CUISINE" ? rand(REFS_CUISINE) : rand(REFS_SDB);
    const ml = randInt(8, 25);
    const prixVente = ml * randInt(85, 130);

    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        telephone: `06${String(randInt(10000000, 99999999))}`,
        email: i % 2 === 0 ? `prospect${i}@email.com` : undefined,
        ville: ville.v,
        codePostal: ville.cp,
        source: rand(SOURCES),
        statut: "DEVIS_ENVOYE",
        typeProjet: type,
        referenceChoisie: ref,
        mlEstimes: ml,
        prixDevis: prixVente,
        scoreSignature: randInt(40, 80),
        notes: `Devis envoye — ${ml}ml ${ref} — en attente de reponse`,
        createdAt: daysAgo(randInt(5, 25)),
        updatedAt: daysAgo(randInt(2, 10)),
      },
    });

    await prisma.interaction.create({
      data: { type: "NOTE", contenu: `Lead recu via webhook (${lead.source})`, leadId: lead.id },
    });
    await prisma.interaction.create({
      data: { type: "APPEL", contenu: "Appel de qualification — projet confirme", leadId: lead.id },
    });

    const devisNum = `DEV-2026-${String(devisCounter++).padStart(3, "0")}`;
    await prisma.devis.create({
      data: {
        numero: devisNum,
        statut: "ENVOYE",
        reference: ref,
        mlTotal: ml,
        prixMatiere: ml * randInt(18, 25),
        prixVente,
        margeNette: prixVente - ml * 22,
        acompte30: Math.round(prixVente * 0.3),
        solde70: Math.round(prixVente * 0.7),
        leadId: lead.id,
        expiresAt: daysAgo(-15),
        createdAt: daysAgo(randInt(3, 12)),
      },
    });
  }
  console.log("✅ 8 leads avec devis envoye");

  // ── 10 leads CONTACTE ──
  for (let i = 0; i < 10; i++) {
    const ville = rand(VILLES);
    const type = rand(TYPES);
    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        telephone: `06${String(randInt(10000000, 99999999))}`,
        email: i % 3 === 0 ? `contact${i}@email.com` : undefined,
        ville: ville.v,
        codePostal: ville.cp,
        source: rand(SOURCES),
        statut: "CONTACTE",
        typeProjet: type,
        referenceChoisie: type === "CUISINE" ? rand(REFS_CUISINE) : undefined,
        scoreSignature: randInt(25, 65),
        notes: "Premier contact effectue — a recontacter pour details projet",
        createdAt: daysAgo(randInt(3, 20)),
        updatedAt: daysAgo(randInt(1, 12)),
      },
    });

    await prisma.interaction.create({
      data: { type: "NOTE", contenu: `Lead recu via webhook (${lead.source})`, leadId: lead.id },
    });
    await prisma.interaction.create({
      data: { type: "APPEL", contenu: "Premier appel — interesse, demande de rappel", leadId: lead.id },
    });
  }
  console.log("✅ 10 leads contactes");

  // ── 15 leads NOUVEAU (frais du site) ──
  for (let i = 0; i < 15; i++) {
    const ville = rand(VILLES);
    const type = rand(TYPES);
    const source = rand(SOURCES);
    const isSimulator = source === "SITE_SIMULATEUR";

    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        telephone: `06${String(randInt(10000000, 99999999))}`,
        email: i % 2 === 0 ? `nouveau${i}@email.com` : undefined,
        ville: ville.v,
        codePostal: ville.cp,
        source,
        statut: "NOUVEAU",
        typeProjet: isSimulator ? "CUISINE" : type,
        referenceChoisie: isSimulator ? rand(REFS_CUISINE) : undefined,
        lienSimulation: isSimulator ? `https://coverswap.fr/sim/${Math.random().toString(36).slice(2, 8)}` : undefined,
        scoreSignature: randInt(15, 55),
        notes: isSimulator
          ? `Simulation IA cuisine — Credence ${rand(REFS_CUISINE)} | Plan ${rand(REFS_CUISINE)}`
          : `Demande via formulaire contact — ${type}`,
        createdAt: daysAgo(randInt(0, 7)),
        updatedAt: daysAgo(randInt(0, 3)),
      },
    });

    await prisma.interaction.create({
      data: {
        type: "NOTE",
        contenu: `Lead recu via webhook (${source})${isSimulator ? " — simulation IA cuisine generee" : ""}`,
        leadId: lead.id,
      },
    });
  }
  console.log("✅ 15 nouveaux leads");

  // ── 6 leads PERDU ──
  for (let i = 0; i < 6; i++) {
    const ville = rand(VILLES);
    const lead = await prisma.lead.create({
      data: {
        prenom: rand(PRENOMS),
        nom: rand(NOMS),
        telephone: `06${String(randInt(10000000, 99999999))}`,
        ville: ville.v,
        codePostal: ville.cp,
        source: rand(SOURCES),
        statut: "PERDU",
        typeProjet: rand(TYPES),
        scoreSignature: randInt(10, 35),
        notes: rand(["Budget insuffisant", "A choisi un concurrent", "Projet reporte", "Injoignable", "Pas de reponse au devis", "Projet annule"]),
        createdAt: daysAgo(randInt(20, 90)),
        updatedAt: daysAgo(randInt(10, 60)),
      },
    });

    await prisma.interaction.create({
      data: { type: "NOTE", contenu: `Lead recu via webhook (${lead.source})`, leadId: lead.id },
    });
    await prisma.interaction.create({
      data: { type: "NOTE", contenu: `Lead marque comme perdu — ${lead.notes}`, leadId: lead.id },
    });
  }
  console.log("✅ 6 leads perdus");

  // ── Résumé ──
  const totalLeads = await prisma.lead.count();
  const totalDevis = await prisma.devis.count();
  const totalFactures = await prisma.facture.count();
  const totalChantiers = await prisma.chantier.count();
  const caFinal = (await prisma.facture.findMany({ where: { statut: "SOLDEE" } })).reduce((s, f) => s + f.montantTotal, 0);

  console.log("\n══════════════════════════════════════");
  console.log(`📊 SEED TERMINE`);
  console.log(`   Leads:     ${totalLeads}`);
  console.log(`   Devis:     ${totalDevis}`);
  console.log(`   Factures:  ${totalFactures}`);
  console.log(`   Chantiers: ${totalChantiers}`);
  console.log(`   CA Total:  ${caFinal.toLocaleString("fr-FR")}€`);
  console.log("══════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch(console.error);
