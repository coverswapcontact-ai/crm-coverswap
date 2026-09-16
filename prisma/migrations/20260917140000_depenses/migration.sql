-- CreateTable
CREATE TABLE "Fichier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chemin" TEXT NOT NULL,
    "nomOriginal" TEXT,
    "typeMime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "empreinte" TEXT NOT NULL,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT
);

-- CreateTable
CREATE TABLE "Depense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "payeeLe" DATETIME NOT NULL,
    "montant" REAL NOT NULL,
    "fournisseur" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "libelle" TEXT,
    "moyen" TEXT,
    "dossierId" TEXT,
    "horsChantier" BOOLEAN NOT NULL DEFAULT false,
    "justificatifId" TEXT,
    "identifiantHorsLigne" TEXT,
    "note" TEXT,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Depense_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Depense_justificatifId_fkey" FOREIGN KEY ("justificatifId") REFERENCES "Fichier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Fichier_empreinte_idx" ON "Fichier"("empreinte");

-- CreateIndex
CREATE UNIQUE INDEX "Depense_identifiantHorsLigne_key" ON "Depense"("identifiantHorsLigne");

-- CreateIndex
CREATE INDEX "Depense_payeeLe_idx" ON "Depense"("payeeLe");

-- CreateIndex
CREATE INDEX "Depense_dossierId_idx" ON "Depense"("dossierId");

