-- CreateTable
CREATE TABLE "Parametre" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "valableDu" DATETIME NOT NULL,
    "source" TEXT,
    "ecriture" TEXT
);

-- CreateIndex
CREATE INDEX "Parametre_cle_valableDu_idx" ON "Parametre"("cle", "valableDu");

