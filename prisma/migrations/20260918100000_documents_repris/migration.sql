-- Documents émis avant le CRM : rattachés avec leur numéro du registre, sans être générés.
ALTER TABLE "Document" ADD COLUMN "origine" TEXT NOT NULL DEFAULT 'CRM';
