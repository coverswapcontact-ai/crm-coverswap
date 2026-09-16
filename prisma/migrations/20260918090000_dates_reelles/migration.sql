-- Dates réelles : un dossier repris garde sa date d'ouverture, un événement sa date réelle (null : date de saisie).
ALTER TABLE "Dossier" ADD COLUMN "ouvertLe" DATETIME;
ALTER TABLE "DossierEvenement" ADD COLUMN "survenuLe" DATETIME;
