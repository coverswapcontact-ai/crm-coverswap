-- CreateTable
CREATE TABLE "NumeroDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cle" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "famille" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "rang" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "origine" TEXT NOT NULL,
    "documentId" TEXT,
    "emisLe" DATETIME,
    "destinataire" TEXT,
    "montant" REAL,
    "note" TEXT,
    "ecriture" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
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
    "clientId" TEXT,
    "destinataire" TEXT,
    "categorieClient" TEXT,
    "mentions" TEXT,
    "echeanceLe" DATETIME,
    "documentOrigineId" TEXT,
    "motifAvoir" TEXT,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Document_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Document_documentOrigineId_fkey" FOREIGN KEY ("documentOrigineId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("acomptePct", "archiveLe", "archiveMotif", "createdAt", "dateEmission", "dossierId", "ecriture", "id", "lignes", "noteMl", "numero", "objet", "pdfPath", "statut", "totalHt", "type", "updatedAt") SELECT "acomptePct", "archiveLe", "archiveMotif", "createdAt", "dateEmission", "dossierId", "ecriture", "id", "lignes", "noteMl", "numero", "objet", "pdfPath", "statut", "totalHt", "type", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_dossierId_idx" ON "Document"("dossierId");
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");
CREATE UNIQUE INDEX "Document_type_numero_key" ON "Document"("type", "numero");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "NumeroDocument_cle_key" ON "NumeroDocument"("cle");

-- CreateIndex
CREATE UNIQUE INDEX "NumeroDocument_documentId_key" ON "NumeroDocument"("documentId");

-- CreateIndex
CREATE INDEX "NumeroDocument_famille_annee_rang_idx" ON "NumeroDocument"("famille", "annee", "rang");

