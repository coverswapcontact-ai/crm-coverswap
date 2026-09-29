"use client";

import { useState } from "react";
import { toast } from "sonner";
import { jourParis } from "@/lib/dossiers/dates";
import type { DossierDetail } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { ProchaineActionResume } from "./CarteDossier";
import { Bouton, CLASSE_SAISIE, TRANS, TitreSection } from "@/components/pilotage/ui";
import { envoyerJson, messageErreur } from "@/components/pilotage/client";

/** Mission 13 (lot 7) — la prochaine action du dossier et sa date, avec les raccourcis ; extrait de PanneauDossier. */

const RACCOURCIS_DATE = [
  { libelle: "Aujourd'hui", jours: 0 },
  { libelle: "Demain", jours: 1 },
  { libelle: "Dans 3 j", jours: 3 },
  { libelle: "Dans 1 sem.", jours: 7 },
] as const;

export function ProchaineActionEditeur({
  detail,
  maintenant,
  onMisAJour,
}: {
  detail: DossierDetail;
  maintenant: Date;
  onMisAJour: (detail: DossierDetail) => void;
}) {
  const actionInitiale = detail.prochaineAction ?? "";
  const dateInitiale = detail.prochaineActionDate ? jourParis(detail.prochaineActionDate) : "";
  const [action, setAction] = useState(actionInitiale);
  const [date, setDate] = useState(dateInitiale);
  const [envoi, setEnvoi] = useState(false);
  const modifie = action.trim() !== actionInitiale || date !== dateInitiale;

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    try {
      const nouveau = await envoyerJson<DossierDetail>(`/api/dossiers/${detail.id}`, "PATCH", {
        prochaineAction: action.trim() || null,
        prochaineActionDate: date || null,
      });
      onMisAJour(nouveau);
      toast.success("Prochaine action enregistrée");
    } catch (probleme) {
      toast.error("Prochaine action non enregistrée", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section>
      <TitreSection>Prochaine action</TitreSection>
      <ProchaineActionResume dossier={detail} maintenant={maintenant} className="mb-3" />
      <form onSubmit={enregistrer} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
        <input
          aria-label="Prochaine action"
          value={action}
          maxLength={140}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Ex. Relancer par téléphone"
          className={cn(CLASSE_SAISIE, "h-11 sm:h-9")}
        />
        <input
          type="date"
          aria-label="Date de la prochaine action"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(CLASSE_SAISIE, "h-11 sm:h-9")}
        />
        <Bouton type="submit" variante={modifie ? "primaire" : "secondaire"} disabled={!modifie} chargement={envoi}>
          Enregistrer
        </Bouton>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RACCOURCIS_DATE.map((raccourci) => (
          <button
            key={raccourci.jours}
            type="button"
            onClick={() => setDate(jourParis(new Date(Date.now() + raccourci.jours * 86_400_000)))}
            className={cn(
              "h-11 rounded-full border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] text-[#9CA3AF] hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-6 sm:text-[11px]",
              TRANS
            )}
          >
            {raccourci.libelle}
          </button>
        ))}
      </div>
    </section>
  );
}
