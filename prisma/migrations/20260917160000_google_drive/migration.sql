-- CreateTable
CREATE TABLE "ConnexionGoogle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "compte" TEXT NOT NULL,
    "portees" TEXT NOT NULL,
    "jetonChiffre" TEXT NOT NULL,
    "deconnecteLe" DATETIME,
    "derniereErreur" TEXT,
    "ecriture" TEXT
);

-- CreateTable
CREATE TABLE "MiroirDrive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cle" TEXT NOT NULL,
    "driveId" TEXT,
    "nom" TEXT NOT NULL,
    "parentCle" TEXT,
    "empreinte" TEXT,
    "etat" TEXT NOT NULL DEFAULT 'A_CREER',
    "synchroniseLe" DATETIME,
    "derniereErreur" TEXT,
    "ecriture" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "MiroirDrive_cle_key" ON "MiroirDrive"("cle");

-- CreateIndex
CREATE INDEX "MiroirDrive_etat_idx" ON "MiroirDrive"("etat");

