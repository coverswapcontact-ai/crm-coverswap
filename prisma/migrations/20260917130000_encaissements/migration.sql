-- CreateTable
CREATE TABLE "Encaissement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "clientId" TEXT,
    "dossierId" TEXT,
    "payeur" TEXT NOT NULL,
    "montant" REAL NOT NULL,
    "moyen" TEXT,
    "reference" TEXT,
    "recuLe" DATETIME NOT NULL,
    "crediteLe" DATETIME,
    "statut" TEXT NOT NULL DEFAULT 'VALIDE',
    "finLe" DATETIME,
    "motifFin" TEXT,
    "origine" TEXT NOT NULL DEFAULT 'SAISIE',
    "cleReprise" TEXT,
    "note" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Encaissement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Encaissement_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffectationEncaissement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encaissementId" TEXT NOT NULL,
    "numeroDocumentId" TEXT NOT NULL,
    "montant" REAL NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'ACTIVE',
    "finLe" DATETIME,
    "motifFin" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "AffectationEncaissement_encaissementId_fkey" FOREIGN KEY ("encaissementId") REFERENCES "Encaissement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AffectationEncaissement_numeroDocumentId_fkey" FOREIGN KEY ("numeroDocumentId") REFERENCES "NumeroDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Encaissement_cleReprise_key" ON "Encaissement"("cleReprise");

-- CreateIndex
CREATE INDEX "Encaissement_recuLe_idx" ON "Encaissement"("recuLe");

-- CreateIndex
CREATE INDEX "Encaissement_dossierId_idx" ON "Encaissement"("dossierId");

-- CreateIndex
CREATE INDEX "Encaissement_clientId_idx" ON "Encaissement"("clientId");

-- CreateIndex
CREATE INDEX "Encaissement_statut_idx" ON "Encaissement"("statut");

-- CreateIndex
CREATE INDEX "AffectationEncaissement_encaissementId_idx" ON "AffectationEncaissement"("encaissementId");

-- CreateIndex
CREATE INDEX "AffectationEncaissement_numeroDocumentId_statut_idx" ON "AffectationEncaissement"("numeroDocumentId", "statut");

