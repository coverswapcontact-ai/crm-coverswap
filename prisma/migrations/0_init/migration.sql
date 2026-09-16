-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT,
    "telephone" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "codePostal" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AUTRE',
    "statut" TEXT NOT NULL DEFAULT 'NOUVEAU',
    "typeProjet" TEXT NOT NULL DEFAULT 'CUISINE',
    "referenceChoisie" TEXT,
    "mlEstimes" REAL,
    "prixDevis" REAL,
    "lienSimulation" TEXT,
    "scoreSignature" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SITE_SIMULATEUR',
    "referenceChoisie" TEXT,
    "mlEstimes" REAL,
    "prixDevis" REAL,
    "lienSimulation" TEXT,
    "imageBeforePath" TEXT,
    "imageAfterPath" TEXT,
    "imageOriginalPath" TEXT,
    "notes" TEXT,
    CONSTRAINT "Simulation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    CONSTRAINT "Interaction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Devis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'BROUILLON',
    "reference" TEXT NOT NULL,
    "nomReference" TEXT,
    "gamme" TEXT NOT NULL DEFAULT 'ESSENTIAL',
    "complexite" INTEGER NOT NULL DEFAULT 1,
    "mlTotal" REAL NOT NULL,
    "prixVenteHTml" REAL NOT NULL DEFAULT 0,
    "prixMatiere" REAL NOT NULL,
    "prixVente" REAL NOT NULL,
    "margeNette" REAL NOT NULL,
    "fraisDeplacement" REAL NOT NULL DEFAULT 0,
    "acompte30" REAL NOT NULL,
    "solde70" REAL NOT NULL,
    "objet" TEXT,
    "lignesAdditionnelles" TEXT NOT NULL DEFAULT '[]',
    "notesInternes" TEXT,
    "leadId" TEXT NOT NULL,
    CONSTRAINT "Devis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Facture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "numero" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'ACOMPTE_EN_ATTENTE',
    "montantTotal" REAL NOT NULL,
    "acompteRecu" BOOLEAN NOT NULL DEFAULT false,
    "acompteDate" DATETIME,
    "soldeRecu" BOOLEAN NOT NULL DEFAULT false,
    "soldeDate" DATETIME,
    "devisId" TEXT NOT NULL,
    CONSTRAINT "Facture_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chantier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dateIntervention" DATETIME NOT NULL,
    "adresse" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "mlCommandes" REAL NOT NULL,
    "prixMatiere" REAL NOT NULL,
    "margeNette" REAL NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'COMMANDE_PASSEE',
    "acompteRecu" BOOLEAN NOT NULL DEFAULT false,
    "soldeRecu" BOOLEAN NOT NULL DEFAULT false,
    "photosAvant" TEXT NOT NULL DEFAULT '[]',
    "photosApres" TEXT NOT NULL DEFAULT '[]',
    "leadId" TEXT NOT NULL,
    CONSTRAINT "Chantier_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Commande" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reference" TEXT NOT NULL,
    "quantiteML" REAL NOT NULL,
    "prixMatiere" REAL NOT NULL,
    "fournisseur" TEXT NOT NULL DEFAULT 'Tego France',
    "emailFournisseur" TEXT NOT NULL DEFAULT 'France@tego.eu',
    "statut" TEXT NOT NULL DEFAULT 'A_COMMANDER',
    "dateCommande" DATETIME,
    "dateReceptionEstimee" DATETIME,
    "dateReceptionReelle" DATETIME,
    "chantierId" TEXT NOT NULL,
    CONSTRAINT "Commande_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Objectif" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periode" TEXT NOT NULL,
    "caMensuel" REAL NOT NULL,
    "nombreChantiers" INTEGER NOT NULL,
    "tauxConversion" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Devis_numero_key" ON "Devis"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_numero_key" ON "Facture"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Facture_devisId_key" ON "Facture"("devisId");

-- CreateIndex
CREATE UNIQUE INDEX "Chantier_leadId_key" ON "Chantier"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Objectif_periode_key" ON "Objectif"("periode");

