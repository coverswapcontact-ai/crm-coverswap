-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN "perteCommentaire" TEXT;
ALTER TABLE "Dossier" ADD COLUMN "perteConcurrent" TEXT;
ALTER TABLE "Dossier" ADD COLUMN "perteEtape" TEXT;
ALTER TABLE "Dossier" ADD COLUMN "perteLe" DATETIME;
ALTER TABLE "Dossier" ADD COLUMN "perteMontantConcurrent" REAL;
ALTER TABLE "Dossier" ADD COLUMN "perteMontantPropose" REAL;

