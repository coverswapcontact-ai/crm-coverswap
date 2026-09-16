-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "categorie" TEXT NOT NULL DEFAULT 'PARTICULIER',
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "nomFamille" TEXT,
    "raisonSociale" TEXT,
    "siret" TEXT,
    "adresse" TEXT,
    "codePostal" TEXT,
    "ville" TEXT,
    "source" TEXT NOT NULL,
    "sourceDetail" TEXT,
    "campagne" TEXT,
    "publicite" TEXT,
    "formulaire" TEXT,
    "premierContactLe" DATETIME NOT NULL,
    "recommandeParId" TEXT,
    "recommandeParTexte" TEXT,
    "fusionneDansId" TEXT,
    "notes" TEXT,
    "anonymiseLe" DATETIME,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Client_recommandeParId_fkey" FOREIGN KEY ("recommandeParId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientEmail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "libelle" TEXT,
    "principale" BOOLEAN NOT NULL DEFAULT false,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "ClientEmail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientTelephone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "saisi" TEXT NOT NULL,
    "libelle" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "ClientTelephone_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentementMail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "recueilliLe" DATETIME NOT NULL,
    "moyen" TEXT NOT NULL,
    "preuve" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "ConsentementMail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
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
    "notes" TEXT,
    "clientId" TEXT,
    "campagne" TEXT,
    "publicite" TEXT,
    "formulaire" TEXT,
    "metaLeadgenId" TEXT,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("archiveLe", "archiveMotif", "codePostal", "createdAt", "ecriture", "email", "id", "lienSimulation", "mlEstimes", "nom", "notes", "prenom", "prixDevis", "referenceChoisie", "scoreSignature", "source", "statut", "telephone", "typeProjet", "updatedAt", "ville") SELECT "archiveLe", "archiveMotif", "codePostal", "createdAt", "ecriture", "email", "id", "lienSimulation", "mlEstimes", "nom", "notes", "prenom", "prixDevis", "referenceChoisie", "scoreSignature", "source", "statut", "telephone", "typeProjet", "updatedAt", "ville" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE INDEX "Lead_clientId_idx" ON "Lead"("clientId");
CREATE TABLE "new_Prospect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "adresse" TEXT,
    "ville" TEXT,
    "codePostal" TEXT,
    "telephone" TEXT,
    "siteWeb" TEXT,
    "email" TEXT,
    "emailType" TEXT NOT NULL DEFAULT 'INCONNU',
    "noteGoogle" REAL,
    "nbAvis" INTEGER,
    "siret" TEXT,
    "anneeCreation" INTEGER,
    "statut" TEXT NOT NULL DEFAULT 'SOURCE',
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreDetails" TEXT,
    "signalPrincipal" TEXT,
    "angleSuggere" TEXT,
    "avisBruts" TEXT,
    "fermetureHebdo" TEXT,
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutAt" DATETIME,
    "clientId" TEXT,
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Prospect_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prospect_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Prospect" ("adresse", "agentProfileId", "angleSuggere", "anneeCreation", "archiveLe", "archiveMotif", "avisBruts", "codePostal", "createdAt", "ecriture", "email", "emailType", "fermetureHebdo", "googlePlaceId", "id", "nbAvis", "nom", "noteGoogle", "optOut", "optOutAt", "score", "scoreDetails", "signalPrincipal", "siret", "siteWeb", "statut", "telephone", "updatedAt", "ville") SELECT "adresse", "agentProfileId", "angleSuggere", "anneeCreation", "archiveLe", "archiveMotif", "avisBruts", "codePostal", "createdAt", "ecriture", "email", "emailType", "fermetureHebdo", "googlePlaceId", "id", "nbAvis", "nom", "noteGoogle", "optOut", "optOutAt", "score", "scoreDetails", "signalPrincipal", "siret", "siteWeb", "statut", "telephone", "updatedAt", "ville" FROM "Prospect";
DROP TABLE "Prospect";
ALTER TABLE "new_Prospect" RENAME TO "Prospect";
CREATE UNIQUE INDEX "Prospect_googlePlaceId_key" ON "Prospect"("googlePlaceId");
CREATE INDEX "Prospect_agentProfileId_statut_idx" ON "Prospect"("agentProfileId", "statut");
CREATE INDEX "Prospect_score_idx" ON "Prospect"("score");
CREATE TABLE "new_Dossier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "leadId" TEXT,
    "prospectId" TEXT,
    "clientId" TEXT,
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
    "archiveLe" DATETIME,
    "archiveMotif" TEXT,
    "ecriture" TEXT,
    CONSTRAINT "Dossier_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dossier_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dossier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Dossier" ("archiveLe", "archiveMotif", "clientAdresse", "clientCp", "clientEmail", "clientNom", "clientTelephone", "clientVille", "createdAt", "dateChantier", "ecriture", "etape", "id", "leadId", "montantEstime", "motifPerte", "objet", "photos", "prochaineAction", "prochaineActionDate", "prospectId", "source", "updatedAt") SELECT "archiveLe", "archiveMotif", "clientAdresse", "clientCp", "clientEmail", "clientNom", "clientTelephone", "clientVille", "createdAt", "dateChantier", "ecriture", "etape", "id", "leadId", "montantEstime", "motifPerte", "objet", "photos", "prochaineAction", "prochaineActionDate", "prospectId", "source", "updatedAt" FROM "Dossier";
DROP TABLE "Dossier";
ALTER TABLE "new_Dossier" RENAME TO "Dossier";
CREATE INDEX "Dossier_etape_idx" ON "Dossier"("etape");
CREATE INDEX "Dossier_prochaineActionDate_idx" ON "Dossier"("prochaineActionDate");
CREATE INDEX "Dossier_clientId_idx" ON "Dossier"("clientId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Client_nom_idx" ON "Client"("nom");

-- CreateIndex
CREATE INDEX "Client_source_idx" ON "Client"("source");

-- CreateIndex
CREATE INDEX "Client_recommandeParId_idx" ON "Client"("recommandeParId");

-- CreateIndex
CREATE INDEX "ClientEmail_adresse_idx" ON "ClientEmail"("adresse");

-- CreateIndex
CREATE INDEX "ClientEmail_clientId_idx" ON "ClientEmail"("clientId");

-- CreateIndex
CREATE INDEX "ClientTelephone_numero_idx" ON "ClientTelephone"("numero");

-- CreateIndex
CREATE INDEX "ClientTelephone_clientId_idx" ON "ClientTelephone"("clientId");

-- CreateIndex
CREATE INDEX "ConsentementMail_clientId_recueilliLe_idx" ON "ConsentementMail"("clientId", "recueilliLe");

