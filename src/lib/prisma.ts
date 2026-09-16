import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { extensionJournal } from "@/lib/journal/extension";

function creerClientBrut(): PrismaClient {
  // Base distante Turso (libSQL) si elle est configurée
  if (process.env.TURSO_DATABASE_URL) {
    const adapter = new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter } as never);
  }
  // Sinon SQLite (fichier local en dev, volume /data en production Railway)
  return new PrismaClient();
}

/**
 * Le seul client de l'application. Toutes les écritures passent par la couche
 * du journal (src/lib/journal) : auteur tracé, suppression refusée.
 */
function creerClient() {
  return creerClientBrut().$extends(extensionJournal);
}

export type BaseDonnees = ReturnType<typeof creerClient>;
/** Client reçu dans prisma.$transaction(async (tx) => …). */
export type Transaction = Omit<BaseDonnees, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const globalForPrisma = globalThis as unknown as { prisma?: BaseDonnees };

export const prisma = globalForPrisma.prisma ?? creerClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
