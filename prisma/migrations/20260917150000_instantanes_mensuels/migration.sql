-- CreateTable
CREATE TABLE "InstantaneMensuel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mois" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contenu" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "ecriture" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "InstantaneMensuel_mois_key" ON "InstantaneMensuel"("mois");

