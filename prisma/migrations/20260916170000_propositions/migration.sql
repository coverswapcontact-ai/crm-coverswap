-- CreateTable
CREATE TABLE "Proposition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    "auteur" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "resume" TEXT,
    "raisonnement" TEXT,
    "confiance" REAL,
    "contenu" TEXT NOT NULL,
    "contenuValide" TEXT,
    "modifiee" BOOLEAN NOT NULL DEFAULT false,
    "cleUnicite" TEXT,
    "clientId" TEXT,
    "dossierId" TEXT,
    "messageId" TEXT,
    "expireLe" DATETIME,
    "decideLe" DATETIME,
    "decidePar" TEXT,
    "motifRejet" TEXT,
    "commentaireRejet" TEXT,
    "executeLe" DATETIME,
    "resultat" TEXT,
    "erreurExecution" TEXT,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposition_cleUnicite_key" ON "Proposition"("cleUnicite");

-- CreateIndex
CREATE INDEX "Proposition_statut_type_idx" ON "Proposition"("statut", "type");

-- CreateIndex
CREATE INDEX "Proposition_dossierId_idx" ON "Proposition"("dossierId");

-- CreateIndex
CREATE INDEX "Proposition_clientId_idx" ON "Proposition"("clientId");

-- CreateIndex
CREATE INDEX "Proposition_messageId_idx" ON "Proposition"("messageId");

