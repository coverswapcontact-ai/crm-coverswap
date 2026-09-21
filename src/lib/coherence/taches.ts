import { enregistrerTravailPeriodique } from "@/lib/taches/registre";
import { controleAutomatique } from "./controle";

/** Une fois par jour (et au démarrage : src/instrumentation.ts) : dossiers, espaces, documents, encaissements et leads disent-ils la même chose ? */
export function enregistrerTachesCoherence(): void {
  enregistrerTravailPeriodique({
    nom: "controle-coherence",
    libelle: "Contrôle de cohérence : dossiers, espaces clients, documents, encaissements, leads",
    acteur: "SYSTEME:coherence",
    intervalleMs: 24 * 3_600_000,
    executer: async () => {
      await controleAutomatique();
    },
  });
}
