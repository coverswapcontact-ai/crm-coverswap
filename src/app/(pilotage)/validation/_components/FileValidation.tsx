"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCheck, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { CarteProposition, ModaleCorrection, ModaleRejet } from "@/components/pilotage/Propositions";
import { Bouton, EnTetePage, EtatVide, Modale, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import type { PropositionVue, StatutProposition } from "@/lib/validation/types";

type Onglet = "attente" | "echec" | "historique";

const STATUTS_ONGLET: Record<Onglet, StatutProposition[]> = {
  attente: ["EN_ATTENTE"],
  echec: ["ECHEC", "VALIDEE"],
  historique: ["EXECUTEE", "AUTOMATIQUE", "REJETEE", "EXPIREE", "ANNULEE"],
};

/* ── Écran ─────────────────────────────────────────────────────────── */

export default function FileValidation({ initiales }: { initiales: PropositionVue[] }) {
  const [onglet, setOnglet] = useState<Onglet>("attente");
  const [propositions, setPropositions] = useState(initiales);
  const [chargement, setChargement] = useState(false);
  const [filtreType, setFiltreType] = useState<string | null>(null);
  const [occupees, setOccupees] = useState<string[]>([]);
  const [enCorrection, setEnCorrection] = useState<PropositionVue | null>(null);
  const [enRejet, setEnRejet] = useState<PropositionVue | null>(null);
  const [confirmationLot, setConfirmationLot] = useState(false);

  const charger = useCallback(async (nouvelOnglet: Onglet) => {
    setChargement(true);
    try {
      const { propositions: lues } = await appelApi<{ propositions: PropositionVue[] }>(
        `/api/validation?statut=${STATUTS_ONGLET[nouvelOnglet].join(",")}&limite=200`
      );
      setPropositions(lues);
    } catch (erreur) {
      toast.error("Lecture impossible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }, []);

  const changerOnglet = (nouvelOnglet: Onglet) => {
    setOnglet(nouvelOnglet);
    setFiltreType(null);
    void charger(nouvelOnglet);
  };

  const types = useMemo(() => {
    const vus = new Map<string, { libelle: string; nombre: number }>();
    for (const proposition of propositions) {
      const actuel = vus.get(proposition.type);
      vus.set(proposition.type, { libelle: proposition.libelleType, nombre: (actuel?.nombre ?? 0) + 1 });
    }
    return [...vus.entries()].map(([type, { libelle, nombre }]) => ({ type, libelle, nombre }));
  }, [propositions]);

  const visibles = filtreType ? propositions.filter((proposition) => proposition.type === filtreType) : propositions;
  const groupables = onglet === "attente" ? visibles.filter((proposition) => proposition.validationGroupee) : [];

  const retirer = (id: string) => setPropositions((actuelles) => actuelles.filter((proposition) => proposition.id !== id));
  const occuper = (id: string, occupee: boolean) =>
    setOccupees((actuelles) => (occupee ? [...actuelles, id] : actuelles.filter((autre) => autre !== id)));

  async function valider(proposition: PropositionVue, corrections?: Record<string, unknown>) {
    occuper(proposition.id, true);
    try {
      const { proposition: resultat } = await envoyerJson<{ proposition: PropositionVue }>(
        `/api/validation/${proposition.id}/valider`,
        "POST",
        { corrections }
      );
      retirer(proposition.id);
      setEnCorrection(null);
      toast.success(resultat.statut === "VALIDEE" ? "Validée : exécution en cours" : "Validée et exécutée", {
        description: proposition.titre,
      });
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Validation impossible", { description: messageErreur(erreur) });
      void charger(onglet);
    } finally {
      occuper(proposition.id, false);
    }
  }

  async function rejeter(proposition: PropositionVue, motif: string, commentaire: string) {
    occuper(proposition.id, true);
    try {
      await envoyerJson(`/api/validation/${proposition.id}/rejeter`, "POST", { motif, commentaire: commentaire || null });
      retirer(proposition.id);
      setEnRejet(null);
      toast("Proposition rejetée", { description: proposition.titre });
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Rejet impossible", { description: messageErreur(erreur) });
    } finally {
      occuper(proposition.id, false);
    }
  }

  async function reessayer(proposition: PropositionVue) {
    occuper(proposition.id, true);
    try {
      await envoyerJson(`/api/validation/${proposition.id}/reessayer`, "POST");
      toast.success("Exécution relancée");
      void charger(onglet);
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Relance impossible", { description: messageErreur(erreur) });
    } finally {
      occuper(proposition.id, false);
    }
  }

  async function validerLot() {
    const ids = groupables.map((proposition) => proposition.id);
    setConfirmationLot(false);
    try {
      const bilan = await envoyerJson<{ validees: string[]; ignorees: { id: string; raison: string }[] }>(
        "/api/validation/lot",
        "POST",
        { ids }
      );
      setPropositions((actuelles) => actuelles.filter((proposition) => !bilan.validees.includes(proposition.id)));
      toast.success(`${bilan.validees.length} proposition${bilan.validees.length > 1 ? "s" : ""} validée${bilan.validees.length > 1 ? "s" : ""}`, {
        description: bilan.ignorees.length > 0 ? `${bilan.ignorees.length} laissée(s) de côté : ${bilan.ignorees[0].raison}` : undefined,
      });
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Validation en lot impossible", { description: messageErreur(erreur) });
    }
  }

  const enAttente = onglet === "attente" ? propositions.length : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="À valider"
        sousTitre={
          onglet === "attente"
            ? enAttente === 0
              ? "Rien en attente."
              : `${enAttente} proposition${enAttente && enAttente > 1 ? "s" : ""} de l'agent ou du système. Rien ne part sans toi.`
            : onglet === "echec"
              ? "Propositions validées dont l'exécution n'a pas abouti."
              : "Décisions récentes, validées, rejetées ou devenues sans objet."
        }
        actions={
          groupables.length > 1 ? (
            <Bouton icone={<CheckCheck size={15} aria-hidden />} onClick={() => setConfirmationLot(true)}>
              Tout valider ({groupables.length})
            </Bouton>
          ) : null
        }
      />

      <div
        role="tablist"
        aria-label="Propositions"
        className="mt-5 flex w-fit items-center rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-[3px]"
      >
        {(
          [
            { valeur: "attente", libelle: "À valider" },
            { valeur: "echec", libelle: "En cours ou en échec" },
            { valeur: "historique", libelle: "Historique" },
          ] as const
        ).map(({ valeur, libelle }) => (
          <button
            key={valeur}
            type="button"
            role="tab"
            aria-selected={onglet === valeur}
            onClick={() => changerOnglet(valeur)}
            className={cn(
              "flex h-9 items-center rounded-[7px] px-3 text-[13px] font-medium sm:h-7",
              onglet === valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]",
              TRANS
            )}
          >
            {libelle}
          </button>
        ))}
      </div>

      {types.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFiltreType(null)}
            className={cn(
              "min-h-8 rounded-full border-[0.5px] px-3 text-[12px]",
              filtreType === null ? "border-[#3A3E47] bg-[#272B33] text-[#F2F3F5]" : "border-[#2A2D34] text-[#9CA3AF]",
              TRANS
            )}
          >
            Toutes
          </button>
          {types.map((type) => (
            <button
              key={type.type}
              type="button"
              onClick={() => setFiltreType(type.type)}
              className={cn(
                "min-h-8 rounded-full border-[0.5px] px-3 text-[12px]",
                filtreType === type.type ? "border-[#3A3E47] bg-[#272B33] text-[#F2F3F5]" : "border-[#2A2D34] text-[#9CA3AF]",
                TRANS
              )}
            >
              {type.libelle} · {type.nombre}
            </button>
          ))}
        </div>
      ) : null}

      <section aria-busy={chargement} className={cn("mt-4 flex flex-col gap-2.5", chargement && "opacity-60")}>
        {visibles.length === 0 ? (
          <EtatVide
            icone={<CircleCheck size={18} className="text-[#1D9E75]" aria-hidden />}
            titre={onglet === "attente" ? "Rien à valider" : "Aucune proposition"}
            texte={
              onglet === "attente"
                ? "Les propositions de l'agent mail et du système arrivent ici : rattachements, notes, relances, envois."
                : undefined
            }
          />
        ) : (
          visibles.map((proposition) => (
            <CarteProposition
              key={proposition.id}
              proposition={proposition}
              occupee={occupees.includes(proposition.id)}
              onValider={() => void valider(proposition)}
              onCorriger={() => setEnCorrection(proposition)}
              onRejeter={() => setEnRejet(proposition)}
              onReessayer={() => void reessayer(proposition)}
            />
          ))
        )}
      </section>

      {enCorrection ? (
        <ModaleCorrection
          proposition={enCorrection}
          onFermer={() => setEnCorrection(null)}
          onValider={(corrections) => valider(enCorrection, corrections)}
        />
      ) : null}
      {enRejet ? (
        <ModaleRejet
          proposition={enRejet}
          onFermer={() => setEnRejet(null)}
          onRejeter={(motif, commentaire) => rejeter(enRejet, motif, commentaire)}
        />
      ) : null}
      <Modale
        ouverte={confirmationLot}
        onFermer={() => setConfirmationLot(false)}
        titre={`Valider ${groupables.length} propositions ?`}
        description="Seules les propositions sans argent ni envoi au client se valident en lot."
        largeur="sm"
        pied={
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setConfirmationLot(false)}>
              Annuler
            </Bouton>
            <Bouton variante="primaire" icone={<CheckCheck size={15} aria-hidden />} onClick={() => void validerLot()}>
              Tout valider
            </Bouton>
          </div>
        }
      >
        <ul className="flex flex-col gap-1.5 text-[13px] text-[#D1D5DB]">
          {groupables.map((proposition) => (
            <li key={proposition.id} className="flex gap-2">
              <span aria-hidden className="text-[#6B7280]">
                •
              </span>
              {proposition.titre}
            </li>
          ))}
        </ul>
      </Modale>
    </div>
  );
}
