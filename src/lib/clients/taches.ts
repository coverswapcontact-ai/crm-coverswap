import prisma from "@/lib/prisma";
import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { proposerFusions } from "./doublons";
import { rattacherDossier, rattacherLead } from "./identification";

/**
 * Filet de sécurité : un lead ou un dossier resté sans client (webhook
 * interrompu, erreur passagère) est rattaché au passage suivant.
 */
export async function rattacherOrphelins(): Promise<{ leads: number; dossiers: number }> {
  const leads = await prisma.lead.findMany({ where: { clientId: null }, select: { id: true }, take: 200 });
  for (const lead of leads) await prisma.$transaction((tx) => rattacherLead(tx, lead.id));
  const dossiers = await prisma.dossier.findMany({ where: { clientId: null }, take: 200 });
  for (const dossier of dossiers) await prisma.$transaction((tx) => rattacherDossier(tx, dossier));
  return { leads: leads.length, dossiers: dossiers.length };
}

export function enregistrerTachesClients(): void {
  enregistrerTravailPeriodique({
    nom: "rattachement-clients",
    libelle: "Rattachement des leads et dossiers sans client",
    acteur: "SYSTEME:clients",
    intervalleMs: 60 * 60_000,
    executer: async () => {
      await rattacherOrphelins();
    },
  });
  enregistrerTravailPeriodique({
    nom: "doublons-clients",
    libelle: "Recherche des fiches client en double",
    acteur: "SYSTEME:doublons",
    intervalleMs: 24 * 60 * 60_000,
    executer: async () => {
      await proposerFusions();
    },
  });
}
