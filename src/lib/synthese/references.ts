import prisma from "@/lib/prisma";
import { AVEC_ARCHIVES } from "@/lib/journal/extension";
import type { References, Synthese } from "./types";

/** Pseudonyme stable d'un identifiant (FNV-1a 32 bits) : « 3K7Q ». Sert au partage, pas à la sécurité. */
export function pseudonyme(identifiant: string): string {
  let empreinte = 0x811c9dc5;
  for (let index = 0; index < identifiant.length; index++) {
    empreinte ^= identifiant.charCodeAt(index);
    empreinte = Math.imul(empreinte, 0x01000193) >>> 0;
  }
  return empreinte.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

/** Noms des clients et dossiers cités par la synthèse, lus aujourd'hui (ou pseudonymes). */
export async function referencesDe(synthese: Synthese, anonyme: boolean): Promise<References> {
  const clientIds = [
    ...synthese.finances.margesDossiers.map((marge) => marge.clientId),
    ...synthese.clients.recommandeurs.map((ligne) => ligne.clientId),
    ...synthese.clients.inactifs.clientIds,
  ].filter((id): id is string => Boolean(id));
  const dossierIds = synthese.finances.margesDossiers.map((marge) => marge.dossierId);

  if (anonyme) {
    return {
      clients: Object.fromEntries(clientIds.map((id) => [id, `Client ${pseudonyme(id)}`])),
      dossiers: Object.fromEntries(dossierIds.map((id) => [id, `Dossier ${pseudonyme(id)}`])),
    };
  }
  const [clients, dossiers] = await Promise.all([
    prisma.client.findMany({ where: { ...AVEC_ARCHIVES, id: { in: [...new Set(clientIds)] } }, select: { id: true, nom: true } }),
    prisma.dossier.findMany({ where: { ...AVEC_ARCHIVES, id: { in: dossierIds } }, select: { id: true, clientNom: true, objet: true } }),
  ]);
  return {
    clients: Object.fromEntries(clients.map((client) => [client.id, client.nom])),
    dossiers: Object.fromEntries(dossiers.map((dossier) => [dossier.id, `${dossier.clientNom} · ${dossier.objet}`])),
  };
}
