"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, Check, ChevronDown, FolderOpen, Pencil, RotateCw, ShieldAlert, X } from "lucide-react";
import { Bouton, Champ, ListeDeroulante, Modale, Pastille, Puces, TRANS, ZoneTexte } from "@/components/pilotage/ui";
import { formatHorodatage } from "@/lib/dossiers/dates";
import { cn } from "@/lib/utils";
import { LIBELLES_STATUT_PROPOSITION, type PropositionVue } from "@/lib/validation/types";

// Carte d'une proposition et ses fenêtres (corriger, rejeter) : partagées par
// « À valider » et par la file des messages.

export function libelleAuteur(auteur: string): string {
  const [type, ...reste] = auteur.split(":");
  const nom = reste.join(":");
  if (type === "AGENT") return nom === "mail" ? "Agent mail" : `Agent ${nom}`;
  if (type === "SYSTEME") return nom === "doublons" ? "Recherche des doublons" : "Système";
  if (type === "MIGRATION") return "Reprise des données";
  if (type === "HUMAIN") return nom === "poste-local" ? "Moi" : nom;
  return auteur;
}

/* ── Carte d'une proposition ───────────────────────────────────────── */

export function CarteProposition({
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
        {proposition.liens.map((lien) => (
          <span key={lien.href} className="contents">
            <span aria-hidden>·</span>
            <Link href={lien.href} className={cn("inline-flex min-h-6 items-center text-[#9CA3AF] underline-offset-2 hover:text-[#F2F3F5] hover:underline", TRANS)}>
              {lien.libelle}
            </Link>
          </span>
        ))}
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

export function ModaleCorrection({
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

export function ModaleRejet({
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
