"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  FolderOpen,
  Pencil,
  RotateCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { rafraichirCompteurs } from "@/components/pilotage/Navigation";
import {
  Bouton,
  Champ,
  EnTetePage,
  EtatVide,
  ListeDeroulante,
  Modale,
  Pastille,
  Puces,
  TRANS,
  ZoneTexte,
} from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { cn } from "@/lib/utils";
import { LIBELLES_STATUT_PROPOSITION, type PropositionVue, type StatutProposition } from "@/lib/validation/types";

type Onglet = "attente" | "echec" | "historique";

const STATUTS_ONGLET: Record<Onglet, StatutProposition[]> = {
  attente: ["EN_ATTENTE"],
  echec: ["ECHEC", "VALIDEE"],
  historique: ["EXECUTEE", "AUTOMATIQUE", "REJETEE", "EXPIREE", "ANNULEE"],
};

function libelleAuteur(auteur: string): string {
  const [type, ...reste] = auteur.split(":");
  const nom = reste.join(":");
  if (type === "AGENT") return nom === "mail" ? "Agent mail" : `Agent ${nom}`;
  if (type === "SYSTEME") return "Système";
  if (type === "HUMAIN") return nom;
  return auteur;
}

/* ── Carte d'une proposition ───────────────────────────────────────── */

function CarteProposition({
  proposition,
  occupee,
  onValider,
  onCorriger,
  onRejeter,
  onReessayer,
}: {
  proposition: PropositionVue;
  occupee: boolean;
  onValider: () => void;
  onCorriger: () => void;
  onRejeter: () => void;
  onReessayer: () => void;
}) {
  const [pourquoiOuvert, setPourquoiOuvert] = useState(false);
  const enAttente = proposition.statut === "EN_ATTENTE";
  const confiance = proposition.confiance === null ? null : Math.round(proposition.confiance * 100);

  return (
    <article className="rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pastille>{proposition.libelleType}</Pastille>
        {proposition.sensible ? (
          <Pastille ton="ambre" titre="Engage de l'argent ou part chez un client : se valide une par une.">
            <ShieldAlert size={11} aria-hidden />
            Argent ou client
          </Pastille>
        ) : null}
        {!enAttente ? (
          <Pastille
            ton={
              proposition.statut === "ECHEC"
                ? "rouge"
                : proposition.statut === "EXECUTEE" || proposition.statut === "AUTOMATIQUE"
                  ? "vert"
                  : "neutre"
            }
          >
            {LIBELLES_STATUT_PROPOSITION[proposition.statut]}
          </Pastille>
        ) : null}
        {proposition.modifiee ? <Pastille ton="bleu">Corrigée avant validation</Pastille> : null}
      </div>

      <h3 className="mt-2.5 text-[14px] leading-snug font-medium text-[#F2F3F5]">{proposition.titre}</h3>
      {proposition.resume ? (
        <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-[#9CA3AF]">{proposition.resume}</p>
      ) : null}

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#6B7280]">
        <span className="inline-flex items-center gap-1">
          <Bot size={12} aria-hidden />
          {libelleAuteur(proposition.auteur)}
        </span>
        <span aria-hidden>·</span>
        <span>{formatHorodatage(proposition.createdAt)}</span>
        {confiance !== null ? (
          <>
            <span aria-hidden>·</span>
            <span title="Confiance calculée par le système">confiance {confiance} %</span>
          </>
        ) : null}
        {proposition.dossierId ? (
          <>
            <span aria-hidden>·</span>
            <Link
              href={`/dossiers?dossier=${proposition.dossierId}`}
              className={cn("inline-flex items-center gap-1 text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
            >
              <FolderOpen size={12} aria-hidden />
              Ouvrir le dossier
            </Link>
          </>
        ) : null}
      </p>

      {proposition.raisonnement ? (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={pourquoiOuvert}
            onClick={() => setPourquoiOuvert((ouvert) => !ouvert)}
            className={cn("inline-flex min-h-8 items-center gap-1 text-[12px] text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
          >
            Pourquoi ?
            <ChevronDown size={13} aria-hidden className={cn("transition-transform", pourquoiOuvert && "rotate-180")} />
          </button>
          {pourquoiOuvert ? (
            <p className="mt-1 rounded-[8px] bg-[#16181D] px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#D1D5DB]">
              {proposition.raisonnement}
            </p>
          ) : null}
        </div>
      ) : null}

      {proposition.erreurExecution ? (
        <p className="mt-2 flex items-start gap-2 rounded-[8px] bg-[#EF4444]/10 px-3 py-2 text-[12.5px] text-[#F87171]">
          <AlertTriangle size={14} aria-hidden className="mt-px shrink-0" />
          {proposition.erreurExecution}
        </p>
      ) : null}

      {proposition.statut === "REJETEE" && proposition.motifRejet ? (
        <p className="mt-2 text-[12px] text-[#9CA3AF]">
          Motif : {proposition.motifsRejet.find((motif) => motif.code === proposition.motifRejet)?.libelle ?? proposition.motifRejet}
          {proposition.commentaireRejet ? ` — ${proposition.commentaireRejet}` : ""}
        </p>
      ) : null}

      {enAttente ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Bouton variante="primaire" icone={<Check size={15} aria-hidden />} chargement={occupee} onClick={onValider}>
            Valider
          </Bouton>
          {proposition.champs.length > 0 ? (
            <Bouton icone={<Pencil size={14} aria-hidden />} disabled={occupee} onClick={onCorriger}>
              Corriger
            </Bouton>
          ) : null}
          <Bouton variante="fantome" icone={<X size={15} aria-hidden />} disabled={occupee} onClick={onRejeter}>
            Rejeter
          </Bouton>
        </div>
      ) : proposition.statut === "ECHEC" ? (
        <div className="mt-3">
          <Bouton icone={<RotateCw size={14} aria-hidden />} chargement={occupee} onClick={onReessayer}>
            Réessayer l’exécution
          </Bouton>
        </div>
      ) : null}
    </article>
  );
}

/* ── Correction avant validation ───────────────────────────────────── */

function ModaleCorrection({
  proposition,
  onFermer,
  onValider,
}: {
  proposition: PropositionVue;
  onFermer: () => void;
  onValider: (corrections: Record<string, unknown>) => Promise<void>;
}) {
  const [valeurs, setValeurs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      proposition.champs.map((champ) => {
        const valeur = proposition.contenu[champ.cle];
        return [champ.cle, typeof valeur === "string" || typeof valeur === "number" ? String(valeur) : ""];
      })
    )
  );
  const [envoi, setEnvoi] = useState(false);

  async function valider() {
    setEnvoi(true);
    try {
      const corrections = Object.fromEntries(
        proposition.champs.map((champ) => {
          const valeur = valeurs[champ.cle]?.trim() ?? "";
          // Un champ vidé garde la valeur proposée : pour l'écarter, rejeter la proposition.
          return [champ.cle, valeur === "" ? undefined : valeur];
        })
      );
      await onValider(corrections);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Corriger puis valider"
      description={proposition.titre}
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variante="primaire" icone={<Check size={15} aria-hidden />} chargement={envoi} onClick={() => void valider()}>
            Valider la version corrigée
          </Bouton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {proposition.champs.map((champ) => {
          const commun = {
            libelle: champ.libelle,
            obligatoire: champ.obligatoire,
            aide: champ.aide,
            value: valeurs[champ.cle] ?? "",
          };
          const changer = (valeur: string) => setValeurs((actuelles) => ({ ...actuelles, [champ.cle]: valeur }));
          if (champ.nature === "texteLong") {
            return <ZoneTexte key={champ.cle} {...commun} rows={6} onChange={(evenement) => changer(evenement.target.value)} />;
          }
          if (champ.nature === "choix") {
            return (
              <ListeDeroulante
                key={champ.cle}
                {...commun}
                options={[...(champ.obligatoire ? [] : [{ valeur: "", libelle: "—" }]), ...(champ.options ?? [])]}
                onChange={(evenement) => changer(evenement.target.value)}
              />
            );
          }
          return (
            <Champ
              key={champ.cle}
              {...commun}
              type={champ.nature === "jour" ? "date" : "text"}
              onChange={(evenement) => changer(evenement.target.value)}
            />
          );
        })}
      </div>
    </Modale>
  );
}

/* ── Rejet ─────────────────────────────────────────────────────────── */

function ModaleRejet({
  proposition,
  onFermer,
  onRejeter,
}: {
  proposition: PropositionVue;
  onFermer: () => void;
  onRejeter: (motif: string, commentaire: string) => Promise<void>;
}) {
  const [motif, setMotif] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const commentaireExige = motif === "AUTRE" && commentaire.trim().length < 3;

  async function rejeter() {
    if (!motif || commentaireExige) return;
    setEnvoi(true);
    try {
      await onRejeter(motif, commentaire);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      titre="Rejeter la proposition"
      description="Le motif sert à mesurer et corriger l'agent : un clic suffit."
      pied={
        <div className="flex flex-wrap justify-end gap-2">
          <Bouton variante="fantome" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton
            variante="danger"
            icone={<X size={15} aria-hidden />}
            disabled={!motif || commentaireExige}
            chargement={envoi}
            onClick={() => void rejeter()}
          >
            Rejeter
          </Bouton>
        </div>
      }
    >
      <p className="mb-4 text-[13px] text-[#D1D5DB]">{proposition.titre}</p>
      <Puces
        libelle="Motif"
        obligatoire
        options={proposition.motifsRejet.map((option) => ({ valeur: option.code, libelle: option.libelle }))}
        valeur={motif}
        onChange={setMotif}
      />
      <ZoneTexte
        classeConteneur="mt-4"
        libelle={motif === "AUTRE" ? "Précision" : "Précision (facultative)"}
        obligatoire={motif === "AUTRE"}
        rows={3}
        maxLength={1000}
        value={commentaire}
        onChange={(evenement) => setCommentaire(evenement.target.value)}
      />
    </Modale>
  );
}

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
