-- CreateTable
CREATE TABLE "Tache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "charge" TEXT NOT NULL DEFAULT '{}',
    "statut" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
    "priorite" INTEGER NOT NULL DEFAULT 0,
    "tentatives" INTEGER NOT NULL DEFAULT 0,
    "tentativesMax" INTEGER NOT NULL DEFAULT 8,
    "prochainEssaiLe" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verrouJusqua" DATETIME,
    "aRejouer" BOOLEAN NOT NULL DEFAULT false,
    "commenceLe" DATETIME,
    "termineLe" DATETIME,
    "derniereErreur" TEXT,
    "resultat" TEXT,
    "demandeePar" TEXT NOT NULL,
    "ecriture" TEXT
);

-- CreateTable
CREATE TABLE "Planification" (
    "nom" TEXT NOT NULL PRIMARY KEY,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "dernierDebut" DATETIME,
    "dernierFin" DATETIME,
    "dernierStatut" TEXT,
    "derniereErreur" TEXT,
    "echecsConsecutifs" INTEGER NOT NULL DEFAULT 0,
    "prochainPassage" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ecriture" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "Tache_cle_key" ON "Tache"("cle");

-- CreateIndex
CREATE INDEX "Tache_statut_prochainEssaiLe_idx" ON "Tache"("statut", "prochainEssaiLe");

-- CreateIndex
CREATE INDEX "Tache_type_statut_idx" ON "Tache"("type", "statut");

