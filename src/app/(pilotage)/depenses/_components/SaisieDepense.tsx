"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CircleCheck, CloudOff, FileText, ImagePlus, Receipt, X } from "lucide-react";
import { toast } from "sonner";
import { Bouton, Champ, Puces, TRANS } from "@/components/pilotage/ui";
import {
  ADRESSE_DEPENSES,
  CATEGORIES_DEPENSE,
  LIBELLES_MOYEN_DEPENSE,
  MOYENS_DEPENSE,
  categorieDeChantier,
  type CategorieDepense,
  type ChantierPropose,
} from "@/lib/depenses/constantes";
import { envoisEnAttente, envoyerDepense, envoyerFile, mettreEnAttente } from "@/lib/depenses/boite-envoi";
import { LIBELLES_ETAPE, type EtapeDossier } from "@/lib/dossiers/constants";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant, lireNombre } from "@/lib/dossiers/montants";
import { cn } from "@/lib/utils";
import { preparerPhoto } from "@/components/pilotage/client";

type Rattachement = { type: "CHANTIER"; dossierId: string } | { type: "HORS" } | null;
type Resultat = { enAttente: boolean; montant: number; fournisseur: string; rattache: string };

const HORS_CHANTIER = "Hors chantier (frais généraux)";

function identifiantSaisie(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SaisieDepense({
  chantiers,
  propose,
  fournisseurs,
}: {
  chantiers: ChantierPropose[];
  propose: string | null;
  fournisseurs: string[];
}) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [montant, setMontant] = useState("");
  const [categorie, setCategorie] = useState<CategorieDepense | null>(null);
  const [rattachement, setRattachement] = useState<Rattachement>(propose ? { type: "CHANTIER", dossierId: propose } : null);
  const [rattachementChoisi, setRattachementChoisi] = useState(Boolean(propose));
  const [tousLesChantiers, setTousLesChantiers] = useState(false);
  const [fournisseur, setFournisseur] = useState("");
  const [payeeLe, setPayeeLe] = useState(jourParis(new Date()));
  const [moyen, setMoyen] = useState<(typeof MOYENS_DEPENSE)[number] | null>("CARTE");
  const [libelle, setLibelle] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [doublon, setDoublon] = useState<string | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [attente, setAttente] = useState(0);
  const camera = useRef<HTMLInputElement>(null);
  const galerie = useRef<HTMLInputElement>(null);

  // Ce qui attend sur le téléphone part dès que possible : à l'ouverture et au retour du réseau.
  useEffect(() => {
    const vider = () => {
      void envoyerFile().then(({ envoyes, restants }) => {
        setAttente(restants);
        if (envoyes > 0) toast.success(`${envoyes} dépense${envoyes > 1 ? "s" : ""} en attente envoyée${envoyes > 1 ? "s" : ""}`);
      });
    };
    vider();
    window.addEventListener("online", vider);
    return () => window.removeEventListener("online", vider);
  }, []);

  useEffect(() => {
    if (!fichier || !fichier.type.startsWith("image/")) return;
    const url = URL.createObjectURL(fichier);
    setApercu(url);
    return () => URL.revokeObjectURL(url);
  }, [fichier]);

  const montantLu = montant.trim() ? lireNombre(montant) : null;
  const montantInvalide = montant.trim() !== "" && (montantLu === null || montantLu <= 0);
  const complet = montantLu !== null && montantLu > 0 && categorie !== null && rattachement !== null && fournisseur.trim() !== "" && Boolean(payeeLe);
  const chantierChoisi = rattachement?.type === "CHANTIER" ? chantiers.find((chantier) => chantier.id === rattachement.dossierId) : undefined;
  const visibles = tousLesChantiers ? chantiers : chantiers.slice(0, 4);
  if (chantierChoisi && !visibles.includes(chantierChoisi)) visibles.push(chantierChoisi);

  function choisirCategorie(code: CategorieDepense) {
    setCategorie(code);
    // Tant que le rattachement n'a pas été choisi à la main, il suit la catégorie.
    if (!rattachementChoisi) {
      if (!categorieDeChantier(code)) setRattachement({ type: "HORS" });
      else setRattachement(propose ? { type: "CHANTIER", dossierId: propose } : null);
    }
  }

  function recommencer() {
    setFichier(null);
    setApercu(null);
    setMontant("");
    setFournisseur("");
    setLibelle("");
    setDoublon(null);
    setResultat(null);
  }

  async function enregistrer(forcer = false) {
    if (!complet || montantLu === null) return;
    setEnvoi(true);
    setDoublon(null);
    const donnees = {
      identifiantHorsLigne: identifiantSaisie(),
      payeeLe,
      montant: montantLu,
      fournisseur: fournisseur.trim(),
      categorie,
      libelle: libelle.trim() || null,
      moyen,
      dossierId: rattachement?.type === "CHANTIER" ? rattachement.dossierId : null,
      horsChantier: rattachement?.type === "HORS",
      forcer,
    };
    const rattache = rattachement?.type === "CHANTIER" ? (chantierChoisi?.clientNom ?? "Chantier") : HORS_CHANTIER;
    try {
      const justificatif = fichier ? await preparerPhoto(fichier) : null;
      const resultatEnvoi = await envoyerDepense({ donnees, justificatif, nomJustificatif: justificatif?.name ?? null });
      if (resultatEnvoi.etat === "ok") {
        setResultat({ enAttente: false, montant: montantLu, fournisseur: fournisseur.trim(), rattache });
      } else if (resultatEnvoi.etat === "reseau") {
        await mettreEnAttente({
          identifiant: donnees.identifiantHorsLigne,
          donnees,
          justificatif,
          nomJustificatif: justificatif?.name ?? null,
          creeLe: new Date().toISOString(),
          derniereErreur: null,
        });
        setAttente((await envoisEnAttente()).length);
        setResultat({ enAttente: true, montant: montantLu, fournisseur: fournisseur.trim(), rattache });
      } else if (resultatEnvoi.statut === 409 && (resultatEnvoi.corps as { doublonId?: string } | null)?.doublonId) {
        setDoublon(resultatEnvoi.message);
      } else {
        toast.error("Dépense non enregistrée", { description: resultatEnvoi.message });
      }
    } catch (erreur) {
      toast.error("Dépense non enregistrée", { description: erreur instanceof Error ? erreur.message : "Erreur inattendue." });
    } finally {
      setEnvoi(false);
    }
  }

  if (resultat) {
    return (
      <div className="mx-auto w-full max-w-lg px-5 py-8">
        <div className="rounded-[11px] border-[0.5px] border-trait bg-surface p-5 text-center">
          {resultat.enAttente ? (
            <CloudOff size={28} aria-hidden className="mx-auto text-attention-texte" />
          ) : (
            <CircleCheck size={28} aria-hidden className="mx-auto text-action-clair" />
          )}
          <p className="mt-3 text-[15px] font-medium text-texte">
            {resultat.enAttente ? "Enregistrée sur ce téléphone" : "Dépense enregistrée"}
          </p>
          <p className="mt-1 text-[13px] text-texte-3">
            {formatMontant(resultat.montant)} · {resultat.fournisseur} · {resultat.rattache}
          </p>
          {resultat.enAttente ? (
            <p className="mt-2 text-[12.5px] text-attention-texte">Pas de réseau : elle partira toute seule dès qu&apos;il revient (garder la page ouverte ou la rouvrir).</p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2">
            <Bouton variante="primaire" onClick={recommencer}>
              Saisir une autre dépense
            </Bouton>
            <Link href={ADRESSE_DEPENSES} className={cn("rounded-[8px] py-2 text-[13px] text-texte-3 hover:text-texte", TRANS)}>
              Voir les dépenses
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-6 pb-28 md:pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-texte">Nouvelle dépense</h1>
        <Link href={ADRESSE_DEPENSES} className={cn("text-[13px] text-texte-3 hover:text-texte", TRANS)}>
          Dépenses
        </Link>
      </div>
      {attente > 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-[8px] bg-attention/10 px-3 py-2 text-[12.5px] text-attention-texte">
          <CloudOff size={14} aria-hidden />
          {`${attente} dépense${attente > 1 ? "s" : ""} en attente d'envoi sur ce téléphone`}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <section aria-label="Justificatif">
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(evenement) => setFichier(evenement.target.files?.[0] ?? null)}
          />
          <input
            ref={galerie}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(evenement) => setFichier(evenement.target.files?.[0] ?? null)}
          />
          {fichier ? (
            <div className="relative overflow-hidden rounded-[11px] border-[0.5px] border-trait bg-surface">
              {apercu && fichier.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={apercu} alt="Justificatif" className="max-h-64 w-full object-contain" />
              ) : (
                <p className="flex items-center gap-2 p-4 text-[13px] text-texte-2">
                  <FileText size={16} aria-hidden /> {fichier.name}
                </p>
              )}
              <button
                type="button"
                aria-label="Retirer le justificatif"
                onClick={() => {
                  setFichier(null);
                  setApercu(null);
                }}
                className={cn("absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80", TRANS)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => camera.current?.click()}
                className={cn("flex h-24 flex-col items-center justify-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-trait-2 bg-surface text-[13px] text-texte-2 hover:border-action-clair", TRANS)}
              >
                <Camera size={22} aria-hidden /> Photo du ticket
              </button>
              <button
                type="button"
                onClick={() => galerie.current?.click()}
                className={cn("flex h-24 flex-col items-center justify-center gap-1.5 rounded-[11px] border-[0.5px] border-dashed border-trait-2 bg-surface text-[13px] text-texte-2 hover:border-action-clair", TRANS)}
              >
                <ImagePlus size={22} aria-hidden /> Fichier ou PDF
              </button>
            </div>
          )}
        </section>

        <Champ
          libelle="Montant payé (€)"
          obligatoire
          inputMode="decimal"
          placeholder="Ex. 54,20"
          value={montant}
          erreur={montantInvalide ? "Montant invalide." : null}
          onChange={(evenement) => setMontant(evenement.target.value)}
          className="text-[18px] sm:text-[16px]"
        />

        <Puces
          libelle="Catégorie"
          obligatoire
          options={CATEGORIES_DEPENSE.map((option) => ({ valeur: option.code, libelle: option.libelle }))}
          valeur={categorie}
          onChange={choisirCategorie}
        />

        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-texte-3">
            Pour quel chantier <span className="text-action-clair">*</span>
          </legend>
          <div className="flex flex-col gap-1.5">
            {visibles.map((chantier) => {
              const choisi = rattachement?.type === "CHANTIER" && rattachement.dossierId === chantier.id;
              return (
                <button
                  key={chantier.id}
                  type="button"
                  role="radio"
                  aria-checked={choisi}
                  onClick={() => {
                    setRattachement({ type: "CHANTIER", dossierId: chantier.id });
                    setRattachementChoisi(true);
                  }}
                  className={cn(
                    "rounded-[9px] border-[0.5px] px-3 py-2.5 text-left",
                    choisi ? "border-action/60 bg-action-fond" : "border-trait bg-fond hover:border-trait-2",
                    TRANS
                  )}
                >
                  <span className={cn("block text-[13.5px]", choisi ? "text-action-clair" : "text-texte")}>{chantier.clientNom}</span>
                  <span className="block text-[12px] text-texte-3">
                    {chantier.objet} · {LIBELLES_ETAPE[chantier.etape as EtapeDossier] ?? chantier.etape}
                    {chantier.dateChantier ? ` · ${formatDateCourte(chantier.dateChantier)}` : ""}
                  </span>
                </button>
              );
            })}
            {chantiers.length > visibles.length ? (
              <button type="button" onClick={() => setTousLesChantiers(true)} className="py-1 text-left text-[12.5px] text-texte-3 hover:text-texte">
                Voir les {chantiers.length} chantiers
              </button>
            ) : null}
            <button
              type="button"
              role="radio"
              aria-checked={rattachement?.type === "HORS"}
              onClick={() => {
                setRattachement({ type: "HORS" });
                setRattachementChoisi(true);
              }}
              className={cn(
                "rounded-[9px] border-[0.5px] px-3 py-2.5 text-left text-[13.5px]",
                rattachement?.type === "HORS" ? "border-action/60 bg-action-fond text-action-clair" : "border-trait bg-fond text-texte-2 hover:border-trait-2",
                TRANS
              )}
            >
              {HORS_CHANTIER}
            </button>
          </div>
        </fieldset>

        <div>
          <Champ
            libelle="Fournisseur"
            obligatoire
            list="fournisseurs-recents"
            maxLength={120}
            placeholder="Ex. Leroy Merlin"
            value={fournisseur}
            onChange={(evenement) => setFournisseur(evenement.target.value)}
          />
          <datalist id="fournisseurs-recents">
            {fournisseurs.map((nom) => (
              <option key={nom} value={nom} />
            ))}
          </datalist>
          {fournisseurs.length > 0 && !fournisseur ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {fournisseurs.slice(0, 5).map((nom) => (
                <button
                  key={nom}
                  type="button"
                  onClick={() => setFournisseur(nom)}
                  className={cn("rounded-full border-[0.5px] border-trait px-2.5 py-1 text-[12px] text-texte-3 hover:text-texte", TRANS)}
                >
                  {nom}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Champ libelle="Payée le" obligatoire type="date" max={jourParis(new Date())} value={payeeLe} onChange={(evenement) => setPayeeLe(evenement.target.value)} />
          <Champ libelle="Libellé (facultatif)" maxLength={200} value={libelle} onChange={(evenement) => setLibelle(evenement.target.value)} />
        </div>
        <Puces
          libelle="Payée par"
          options={MOYENS_DEPENSE.map((option) => ({ valeur: option, libelle: LIBELLES_MOYEN_DEPENSE[option] }))}
          valeur={moyen}
          onChange={setMoyen}
        />

        {doublon ? (
          <div className="rounded-[9px] border-[0.5px] border-attention/40 bg-attention/10 p-3 text-[13px] text-attention-texte">
            <p>{doublon}</p>
            <div className="mt-2 flex gap-2">
              <Bouton taille="sm" variante="secondaire" chargement={envoi} onClick={() => void enregistrer(true)}>
                Enregistrer quand même
              </Bouton>
              <Bouton taille="sm" variante="fantome" onClick={() => setDoublon(null)}>
                Annuler
              </Bouton>
            </div>
          </div>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 border-t-[0.5px] border-trait bg-fond/95 px-5 py-3 backdrop-blur md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto max-w-lg">
          <Bouton variante="primaire" className="w-full" icone={<Receipt size={15} aria-hidden />} disabled={!complet} chargement={envoi} onClick={() => void enregistrer()}>
            Enregistrer la dépense
          </Bouton>
          {!complet ? (
            <p className="mt-1.5 text-center text-[11.5px] text-texte-3">
              {[
                montantLu === null || montantLu <= 0 ? "montant" : null,
                categorie ? null : "catégorie",
                rattachement ? null : "chantier",
                fournisseur.trim() ? null : "fournisseur",
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              à renseigner
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
