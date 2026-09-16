-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "slug" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "Prospect" (
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
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutAt" DATETIME,
    CONSTRAINT "Prospect_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "prospectId" TEXT NOT NULL,
    "sequencePosition" INTEGER NOT NULL DEFAULT 1,
    "sujet" TEXT NOT NULL,
    "corps" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'BROUILLON',
    "corpsOriginal" TEXT,
    "envoyeAt" DATETIME,
    "ouvertAt" DATETIME,
    "reponduAt" DATETIME,
    CONSTRAINT "EmailDraft_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProspectActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prospectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" TEXT,
    CONSTRAINT "ProspectActivity_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_slug_key" ON "AgentProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_googlePlaceId_key" ON "Prospect"("googlePlaceId");

-- CreateIndex
CREATE INDEX "Prospect_agentProfileId_statut_idx" ON "Prospect"("agentProfileId", "statut");

-- CreateIndex
CREATE INDEX "Prospect_score_idx" ON "Prospect"("score");

-- CreateIndex
CREATE INDEX "EmailDraft_statut_idx" ON "EmailDraft"("statut");

-- CreateIndex
CREATE INDEX "ProspectActivity_prospectId_createdAt_idx" ON "ProspectActivity"("prospectId", "createdAt");
