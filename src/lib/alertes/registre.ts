import { CANAUX_PUSH, type ResultatCanal } from "./configuration";

/**
 * Registre des alertes envoyées : une ligne par envoi, avec l'état de chaque
 * canal. Jamais bloquant — l'alerte est déjà partie quand on écrit ici, seule
 * la trace manquerait. Prisma est chargé à la demande : les modules d'alerte
 * restent utilisables sans base (sonde de santé, essais unitaires).
 */
export async function consignerAlerte(origine: string, resultats: ResultatCanal[]): Promise<void> {
  try {
    const { default: prisma } = await import("@/lib/prisma");
    await prisma.alerteEnvoi.create({
      data: {
        origine,
        abouti: resultats.some((r) => r.ok),
        pousse: resultats.some((r) => r.ok && CANAUX_PUSH.includes(r.canal)),
        resultats: JSON.stringify(resultats),
      },
    });
  } catch (erreur) {
    console.error("[alertes] trace de l'alerte non écrite :", erreur);
  }
}

export type DerniereAlerte = { quand: Date; origine: string; pousse: boolean; abouti: boolean; resultats: ResultatCanal[] };

/** La dernière alerte consignée, toutes origines confondues. */
export async function derniereAlerte(): Promise<DerniereAlerte | null> {
  const { default: prisma } = await import("@/lib/prisma");
  const ligne = await prisma.alerteEnvoi.findFirst({ orderBy: { createdAt: "desc" } });
  if (!ligne) return null;
  let resultats: ResultatCanal[] = [];
  try {
    resultats = JSON.parse(ligne.resultats) as ResultatCanal[];
  } catch {
    resultats = [];
  }
  return { quand: ligne.createdAt, origine: ligne.origine, pousse: ligne.pousse, abouti: ligne.abouti, resultats };
}
