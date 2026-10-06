"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCheck, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import { CarteProposition, ModaleCorrection, ModaleRejet } from "@/components/pilotage/Propositions";
import { Bouton, EnTetePage, EtatVide, Modale, TRANS } from "@/components/pilotage/ui";
import { cn } from "@/lib/utils";
import type { PropositionVue, StatutProposition } from "@/lib/validation/types";
import { pluriel } from "@/lib/commun/format";

type Onglet = "attente" | "echec" | "historique";

const STATUTS_ONGLET: Record<Onglet, StatutProposition[]> = {
  attente: ["EN_ATTENTE"],
  echec: ["ECHEC", "VALIDEE"],
  historique: ["EXECUTEE", "AUTOMATIQUE", "REJETEE", "EXPIREE", "ANNULEE"],
};

/* ── Écran ─────────────────────────────────────────────────────────── */

/**
 * `cible` (mission 17, partie A, relecture) : la proposition demandée par `?proposition=<id>` (« Relire et valider »
 * depuis Tâches) : seule à l'écran, en tête, avec son aperçu et ses boutons ; « Voir toutes » revient à la file.
 * `cibleDemandee` sans `cible` : l'identifiant ne correspond à rien (message, puis la file).
 */
export default function FileValidation({ initiales, totalEnAttente, cible = null, cibleDemandee = false }: { initiales: PropositionVue[]; totalEnAttente: number; cible?: PropositionVue | null; cibleDemandee?: boolean }) {
  const routeur = useRouter();
  const [onglet, setOnglet] = useState<Onglet>("attente");
  const [propositions, setPropositions] = useState(() => (cible && cible.statut === "EN_ATTENTE" && !initiales.some((p) => p.id === cible.id) ? [cible, ...initiales] : initiales));
  // La proposition ouverte depuis Tâches : seule à l'écran tant qu'on ne demande pas « Voir toutes ».
  const [seule, setSeule] = useState<PropositionVue | null>(cible);
  // La liste ne charge que les 200 plus récentes : le total vient du serveur.
  const [total, setTotal] = useState(totalEnAttente);
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
      if (nouvelOnglet === "attente") {
        const { aValider } = await appelApi<{ aValider: number }>("/api/pilotage/compteurs");
        setTotal(aValider);
      }
    } catch (erreur) {
      toast.error("Lecture impossible", { description: messageErreur(erreur) });
    } finally {
      setChargement(false);
    }
  }, []);

  const changerOnglet = (nouvelOnglet: Onglet) => {
    if (seule) voirToutes();
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

  useEffect(() => {
    if (cibleDemandee && !cible) toast.info("Cette proposition n'existe plus", { description: "Voici ce qui attend encore ta validation." });
  }, [cible, cibleDemandee]);

  // La carte ouverte suit la file : décidée ici, elle en sort (et l'écran le dit).
  const cibleEnFile = seule ? (propositions.find((p) => p.id === seule.id) ?? null) : null;
  const cibleVue = seule ? (seule.statut === "EN_ATTENTE" ? cibleEnFile : seule) : null;
  const voirToutes = () => {
    setSeule(null);
    routeur.replace("/validation", { scroll: false });
  };

  const visibles = cibleVue ? [cibleVue] : filtreType ? propositions.filter((proposition) => proposition.type === filtreType) : propositions;
  const groupables = onglet === "attente" ? visibles.filter((proposition) => proposition.validationGroupee) : [];

  const retirer = (id: string) => {
    setPropositions((actuelles) => actuelles.filter((proposition) => proposition.id !== id));
    if (onglet === "attente") setTotal((actuel) => Math.max(0, actuel - 1));
  };
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
      setTotal((actuel) => Math.max(0, actuel - bilan.validees.length));
      toast.success(`${bilan.validees.length} proposition${bilan.validees.length > 1 ? "s" : ""} validée${bilan.validees.length > 1 ? "s" : ""}`, {
        description: bilan.ignorees.length > 0 ? `${pluriel(bilan.ignorees.length, "laissée")} de côté : ${bilan.ignorees[0].raison}` : undefined,
      });
      rafraichirCompteurs();
    } catch (erreur) {
      toast.error("Validation en lot impossible", { description: messageErreur(erreur) });
    }
  }

  const enAttente = onglet === "attente" ? Math.max(total, propositions.length) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="À valider"
        sousTitre={
          onglet === "attente"
            ? enAttente === 0
              ? "Rien en attente."
              : `${enAttente} proposition${enAttente && enAttente > 1 ? "s" : ""} de l'agent ou du système. Rien ne part sans toi.${enAttente && enAttente > propositions.length ? ` Les ${propositions.length} plus récentes sont affichées.` : ""}`
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

      {seule ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-[11px] border-[0.5px] border-action/35 bg-action-fond/60 px-3.5 py-2.5 text-[13px] text-texte-2">
          <span className="min-w-0 flex-1">
            {cibleVue
              ? cibleVue.statut === "EN_ATTENTE"
                ? "La proposition ouverte depuis Tâches : relis-la, puis valide, corrige ou rejette."
                : "Cette proposition a déjà été décidée : la voici telle quelle."
              : "Proposition décidée. Voici le reste de la file."}
          </span>
          <Link href="/taches" className={cn("inline-flex h-11 items-center gap-1.5 rounded-[8px] px-3 text-texte-3 hover:bg-surface-2 hover:text-texte pointer-fine:h-8", TRANS)}>
            <ArrowLeft size={14} aria-hidden /> Tâches
          </Link>
          <button type="button" onClick={voirToutes} className={cn("inline-flex h-11 items-center rounded-[8px] px-3 text-action-clair hover:bg-action/10 pointer-fine:h-8", TRANS)}>
            Voir toutes
          </button>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Propositions"
        className="mt-5 flex w-fit items-center rounded-[9px] border-[0.5px] border-trait bg-surface p-[3px]"
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
              "flex h-11 items-center rounded-[7px] px-3 text-[13px] font-medium sm:h-7",
              onglet === valeur ? "bg-surface-2 text-texte" : "text-texte-3 hover:text-texte",
              TRANS
            )}
          >
            {libelle}
          </button>
        ))}
      </div>

      {types.length > 1 && !seule ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setFiltreType(null)}
            className={cn(
              "min-h-8 rounded-full border-[0.5px] px-3 text-[12px]",
              filtreType === null ? "border-trait-2 bg-surface-2 text-texte" : "border-trait text-texte-3",
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
                filtreType === type.type ? "border-trait-2 bg-surface-2 text-texte" : "border-trait text-texte-3",
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
            icone={<CircleCheck size={18} className="text-action" aria-hidden />}
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
        <ul className="flex flex-col gap-1.5 text-[13px] text-texte-2">
          {groupables.map((proposition) => (
            <li key={proposition.id} className="flex gap-2">
              <span aria-hidden className="text-texte-3">
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
