-- AlterTable
ALTER TABLE "DossierEvenement" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "DossierEvenement" ADD COLUMN "archiveMotif" TEXT;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "canal" TEXT NOT NULL,
    "compte" TEXT NOT NULL,
    "identifiantCanal" TEXT NOT NULL,
    "filCanal" TEXT,
    "sens" TEXT NOT NULL,
    "de" TEXT NOT NULL,
    "deNom" TEXT,
    "a" TEXT NOT NULL DEFAULT '[]',
    "objet" TEXT,
    "extrait" TEXT,
    "recuLe" DATETIME NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'A_ANALYSER',
    "categorie" TEXT,
    "clientId" TEXT,
    "dossierId" TEXT,
    "trieLe" DATETIME,
    "triePar" TEXT,
    "boiteArchiveLe" DATETIME,
    "bruitAnnuleLe" DATETIME,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContenuMessage" (
    "messageId" TEXT NOT NULL PRIMARY KEY,
    "texte" TEXT,
    "entetes" TEXT NOT NULL DEFAULT '{}',
    "anonymiseLe" DATETIME,
    "ecriture" TEXT,
    CONSTRAINT "ContenuMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PieceMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,
    "rang" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "typeMime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "partie" TEXT NOT NULL,
    "enLigne" BOOLEAN NOT NULL DEFAULT false,
    "statut" TEXT NOT NULL DEFAULT 'A_CONSERVER',
    "raison" TEXT,
    "fichierId" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "PieceMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PieceMessage_fichierId_fkey" FOREIGN KEY ("fichierId") REFERENCES "Fichier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyseMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,
    "methode" TEXT NOT NULL,
    "categorie" TEXT,
    "confiance" REAL,
    "raisonnement" TEXT,
    "resultat" TEXT NOT NULL DEFAULT '{}',
    "erreur" TEXT,
    "appelIaId" TEXT,
    "anonymiseLe" DATETIME,
    "ecriture" TEXT,
    CONSTRAINT "AnalyseMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnalyseMessage_appelIaId_fkey" FOREIGN KEY ("appelIaId") REFERENCES "AppelIa" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppelIa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usage" TEXT NOT NULL,
    "modele" TEXT NOT NULL,
    "jetonsEntree" INTEGER NOT NULL DEFAULT 0,
    "jetonsSortie" INTEGER NOT NULL DEFAULT 0,
    "coutEuros" REAL,
    "dureeMs" INTEGER NOT NULL,
    "statut" TEXT NOT NULL,
    "erreur" TEXT,
    "ecriture" TEXT
);

-- CreateIndex
CREATE INDEX "Message_statut_recuLe_idx" ON "Message"("statut", "recuLe");

-- CreateIndex
CREATE INDEX "Message_clientId_idx" ON "Message"("clientId");

-- CreateIndex
CREATE INDEX "Message_dossierId_idx" ON "Message"("dossierId");

-- CreateIndex
CREATE INDEX "Message_filCanal_idx" ON "Message"("filCanal");

-- CreateIndex
CREATE INDEX "Message_de_idx" ON "Message"("de");

-- CreateIndex
CREATE UNIQUE INDEX "Message_canal_identifiantCanal_key" ON "Message"("canal", "identifiantCanal");

-- CreateIndex
CREATE UNIQUE INDEX "PieceMessage_messageId_rang_key" ON "PieceMessage"("messageId", "rang");

-- CreateIndex
CREATE INDEX "AnalyseMessage_messageId_createdAt_idx" ON "AnalyseMessage"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "AppelIa_createdAt_idx" ON "AppelIa"("createdAt");

