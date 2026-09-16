-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Lead" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Simulation" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Simulation" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Interaction" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Interaction" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Devis" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Facture" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Chantier" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Chantier" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Chantier" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Commande" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Commande" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Commande" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Objectif" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Objectif" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Objectif" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "AgentProfile" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "AgentProfile" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Prospect" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Prospect" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "EmailDraft" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "EmailDraft" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "EmailDraft" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "ProspectActivity" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Dossier" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Dossier" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "DossierNote" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "DossierNote" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "DossierNote" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "DossierEvenement" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "Document" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "Document" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "CompteurNumerotation" ADD COLUMN "ecriture" TEXT;

-- AlterTable
ALTER TABLE "PresetTarif" ADD COLUMN "archiveLe" DATETIME;
ALTER TABLE "PresetTarif" ADD COLUMN "archiveMotif" TEXT;
ALTER TABLE "PresetTarif" ADD COLUMN "ecriture" TEXT;

-- CreateTable
CREATE TABLE "JournalModification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horodatage" DATETIME NOT NULL,
    "modele" TEXT NOT NULL,
    "enregistrementId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "acteur" TEXT NOT NULL,
    "jeton" TEXT,
    "origine" TEXT,
    "requete" TEXT,
    "avant" TEXT,
    "apres" TEXT NOT NULL,
    "caviardeLe" DATETIME
);

-- CreateTable
CREATE TABLE "MigrationDonnees" (
    "nom" TEXT NOT NULL PRIMARY KEY,
    "executeeLe" DATETIME NOT NULL,
    "dureeMs" INTEGER NOT NULL,
    "resume" TEXT NOT NULL,
    "ecriture" TEXT
);

-- CreateIndex
CREATE INDEX "JournalModification_modele_enregistrementId_horodatage_idx" ON "JournalModification"("modele", "enregistrementId", "horodatage");

-- CreateIndex
CREATE INDEX "JournalModification_horodatage_idx" ON "JournalModification"("horodatage");

-- CreateIndex
CREATE INDEX "JournalModification_acteur_idx" ON "JournalModification"("acteur");

-- CreateIndex
CREATE INDEX "JournalModification_requete_idx" ON "JournalModification"("requete");

