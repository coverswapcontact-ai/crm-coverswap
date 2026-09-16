-- CreateTable
CREATE TABLE "Dossier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "leadId" TEXT,
    "prospectId" TEXT,
    "clientNom" TEXT NOT NULL,
    "clientAdresse" TEXT NOT NULL,
    "clientCp" TEXT NOT NULL,
    "clientVille" TEXT NOT NULL,
    "clientEmail" TEXT,
    "clientTelephone" TEXT NOT NULL,
    "objet" TEXT NOT NULL,
    "etape" TEXT NOT NULL DEFAULT 'QUALIFICATION',
    "montantEstime" REAL,
    "source" TEXT NOT NULL,
    "motifPerte" TEXT,
    "prochaineAction" TEXT,
    "prochaineActionDate" DATETIME,
    "dateChantier" DATETIME,
    "photos" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Dossier_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dossier_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DossierNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dossierId" TEXT NOT NULL,
    "etape" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    CONSTRAINT "DossierNote_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DossierEvenement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dossierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "DossierEvenement_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dossierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "numero" TEXT,
    "dateEmission" DATETIME,
    "objet" TEXT NOT NULL,
    "lignes" TEXT NOT NULL,
    "totalHt" REAL NOT NULL,
    "acomptePct" INTEGER,
    "noteMl" BOOLEAN NOT NULL DEFAULT true,
    "pdfPath" TEXT,
    "statut" TEXT NOT NULL DEFAULT 'BROUILLON',
    CONSTRAINT "Document_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompteurNumerotation" (
    "serie" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "valeur" INTEGER NOT NULL,

    PRIMARY KEY ("serie", "annee")
);

-- CreateTable
CREATE TABLE "PresetTarif" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "designation" TEXT NOT NULL,
    "unite" TEXT NOT NULL,
    "prixUnitaire" REAL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE INDEX "Dossier_etape_idx" ON "Dossier"("etape");

-- CreateIndex
CREATE INDEX "Dossier_prochaineActionDate_idx" ON "Dossier"("prochaineActionDate");

-- CreateIndex
CREATE INDEX "DossierNote_dossierId_etape_idx" ON "DossierNote"("dossierId", "etape");

-- CreateIndex
CREATE INDEX "DossierEvenement_dossierId_createdAt_idx" ON "DossierEvenement"("dossierId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_dossierId_idx" ON "Document"("dossierId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_type_numero_key" ON "Document"("type", "numero");
