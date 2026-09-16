"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ErreurApi, envoyerJson, messageErreur } from "./client";
import { Bouton, Champ, ListeDeroulante, Modale } from "./ui";
import { jourParis } from "@/lib/dossiers/dates";
import {
  DEFINITIONS_PARAMETRES,
  type CleParametre,
  type DefinitionParametre,
} from "@/lib/parametres/definitions";

type Saisie = { valeur: string; valableDu: string; source: string };

const UNITES: Record<string, string> = { euros: "€", pourcentage: "%", jours: "jours" };

/** Formulaire d'une valeur de paramètre : valeur, date d'effet, source. */
export function ChampsParametre({
  cle,
  saisie,
  onChange,
}: {
  cle: CleParametre;
  saisie: Saisie;
  onChange: (saisie: Saisie) => void;
}) {
  const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
  return (
    <div className="flex flex-col gap-2.5 rounded-[9px] border-[0.5px] border-[#2A2D34] p-3">
      <p className="text-[13px] font-medium text-[#F2F3F5]">{definition.libelle}</p>
      <p className="text-[12px] leading-relaxed text-[#9CA3AF]">{definition.aide}</p>
      {definition.nature === "choix" ? (
        <ListeDeroulante
          libelle="Valeur"
          obligatoire
          value={saisie.valeur}
          onChange={(evenement) => onChange({ ...saisie, valeur: evenement.target.value })}
          options={[{ valeur: "", libelle: "Choisir…" }, ...(definition.options ?? [])]}
        />
      ) : (
        <Champ
          libelle={`Valeur${UNITES[definition.nature] ? ` (${UNITES[definition.nature]})` : ""}`}
          obligatoire
          inputMode={definition.nature === "texte" ? "text" : "decimal"}
          value={saisie.valeur}
          onChange={(evenement) => onChange({ ...saisie, valeur: evenement.target.value })}
        />
      )}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Champ
          libelle="Valable à partir du"
          type="date"
          obligatoire
          value={saisie.valableDu}
          onChange={(evenement) => onChange({ ...saisie, valableDu: evenement.target.value })}
        />
        <Champ
          libelle="Source"
          placeholder="URSSAF 2026, comptable…"
          maxLength={300}
          value={saisie.source}
          onChange={(evenement) => onChange({ ...saisie, source: evenement.target.value })}
        />
      </div>
    </div>
  );
}

export function saisieVide(): Saisie {
  return { valeur: "", valableDu: `${new Date().getFullYear()}-01-01`, source: "" };
}

export function versCorps(cle: CleParametre, saisie: Saisie) {
  const definition: DefinitionParametre = DEFINITIONS_PARAMETRES[cle];
  return {
    cle,
    valeur: definition.nature === "choix" || definition.nature === "texte" ? saisie.valeur : saisie.valeur.replace(/\s/g, "").replace(",", "."),
    valableDu: saisie.valableDu || jourParis(new Date()),
    source: saisie.source || null,
  };
}

/**
 * Quand une action répond « paramètres à renseigner » (428), la fenêtre les
 * demande tous d'un coup, puis relance l'action. Aucune valeur n'est proposée :
 * elle se lit à la source indiquée.
 */
export function useParametresExiges() {
  const [manquants, setManquants] = useState<CleParametre[] | null>(null);
  const [reprise, setReprise] = useState<(() => Promise<void>) | null>(null);
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({});
  const [envoi, setEnvoi] = useState(false);

  const executer = useCallback(async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (erreur) {
      const corps = erreur instanceof ErreurApi ? (erreur.corps as { parametresManquants?: CleParametre[] } | null) : null;
      if (erreur instanceof ErreurApi && erreur.status === 428 && corps?.parametresManquants?.length) {
        setManquants(corps.parametresManquants);
        setSaisies(Object.fromEntries(corps.parametresManquants.map((cle) => [cle, saisieVide()])));
        setReprise(() => action);
        return;
      }
      throw erreur;
    }
  }, []);

  async function enregistrer() {
    if (!manquants) return;
    setEnvoi(true);
    try {
      await envoyerJson("/api/parametres", "POST", { saisies: manquants.map((cle) => versCorps(cle, saisies[cle] ?? saisieVide())) });
      const relancer = reprise;
      setManquants(null);
      setReprise(null);
      toast.success("Paramètres enregistrés");
      if (relancer) await executer(relancer);
    } catch (erreur) {
      toast.error("Enregistrement impossible", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  const complet = (manquants ?? []).every((cle) => (saisies[cle]?.valeur ?? "").trim() !== "");

  const modale = (
    <Modale
      ouverte={manquants !== null}
      onFermer={() => setManquants(null)}
      titre="À renseigner avant de continuer"
      description="Aucune valeur n'est préremplie : un taux ou un seuil faux fausserait tout sans que personne ne le voie."
      pied={
        <div className="flex justify-end gap-2">
          <Bouton variante="fantome" onClick={() => setManquants(null)}>
            Plus tard
          </Bouton>
          <Bouton variante="primaire" disabled={!complet} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer et continuer
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {(manquants ?? []).map((cle) => (
          <ChampsParametre
            key={cle}
            cle={cle}
            saisie={saisies[cle] ?? saisieVide()}
            onChange={(saisie) => setSaisies((actuelles) => ({ ...actuelles, [cle]: saisie }))}
          />
        ))}
      </div>
    </Modale>
  );

  return { executer, modale };
}
