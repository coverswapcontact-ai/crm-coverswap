"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, CloudOff, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, Champ, CLASSE_SAISIE, EnTetePage, Modale, Pastille, Puces, TRANS, TitreSection, ZoneTexte } from "@/components/pilotage/ui";
import { envoisEnAttente, envoyerFile, retirerEnvoi, type EnvoiEnAttente } from "@/lib/depenses/boite-envoi";
import {
  CATEGORIES_DEPENSE,
  LIBELLES_MOYEN_DEPENSE,
  MOYENS_DEPENSE,
  libelleCategorie,
  type CategorieDepense,
  type ChantierPropose,
  type DepenseVue,
} from "@/lib/depenses/constantes";
import type { ListeDepenses as Liste } from "@/lib/depenses/service";
import { formatDateCourte, jourParis } from "@/lib/dossiers/dates";
import { formatMontant, lireNombre } from "@/lib/dossiers/montants";
import { libelleMois } from "@/lib/finances/periodes";
import { cn } from "@/lib/utils";

const CARTE = "rounded-[11px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25]";

function ModaleDepense({
  depense,
  chantiers,
  onFermer,
  onFait,
}: {
  depense: DepenseVue;
  chantiers: ChantierPropose[];
  onFermer: () => void;
  onFait: () => void;
}) {
  const [montant, setMontant] = useState(String(depense.montant).replace(".", ","));
  const [fournisseur, setFournisseur] = useState(depense.fournisseur);
  const [categorie, setCategorie] = useState<CategorieDepense>(depense.categorie);
  const [payeeLe, setPayeeLe] = useState(jourParis(depense.payeeLe));
  const [moyen, setMoyen] = useState(depense.moyen);
  const [libelle, setLibelle] = useState(depense.libelle ?? "");
  const [note, setNote] = useState(depense.note ?? "");
  const [rattachement, setRattachement] = useState(depense.dossier ? depense.dossier.id : depense.horsChantier ? "HORS" : "");
  const [retrait, setRetrait] = useState(false);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  // Le chantier actuel reste choisissable même s'il n'est plus dans les chantiers en cours.
  const options = depense.dossier && !chantiers.some((chantier) => chantier.id === depense.dossier?.id) ? [{ ...depense.dossier, etape: "", dateChantier: null }, ...chantiers] : chantiers;
  const montantLu = lireNombre(montant);

  async function enregistrer() {
    if (montantLu === null || montantLu <= 0) return;
    setEnvoi(true);
    try {
      await envoyerJson(`/api/depenses/${depense.id}`, "PATCH", {
        montant: montantLu,
        fournisseur: fournisseur.trim(),
        categorie,
        payeeLe,
        moyen,
        libelle: libelle.trim() || null,
        note: note.trim() || null,
        dossierId: rattachement && rattachement !== "HORS" ? rattachement : null,
        horsChantier: rattachement === "HORS",
      });
      toast.success("Dépense modifiée");
      onFait();
      onFermer();
    } catch (erreur) {
      toast.error("Modification refusée", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer() {
    setEnvoi(true);
    try {
      await envoyerJson(`/api/depenses/${depense.id}/archive`, "POST", { motif: motif.trim() });
      toast.success("Dépense retirée", { description: "Elle reste dans l'historique." });
      onFait();
      onFermer();
    } catch (erreur) {
      toast.error("Retrait refusé", { description: messageErreur(erreur) });
    } finally {
      setEnvoi(false);
    }
  }

  async function remplacerJustificatif(fichier: File) {
    const formulaire = new FormData();
    formulaire.set("justificatif", fichier);
    try {
      await appelApi(`/api/depenses/${depense.id}/justificatif`, { method: "POST", body: formulaire });
      toast.success("Justificatif enregistré");
      onFait();
    } catch (erreur) {
      toast.error("Justificatif refusé", { description: messageErreur(erreur) });
    }
  }

  return (
    <Modale
      ouverte
      onFermer={onFermer}
      largeur="sm"
      titre={retrait ? "Retirer cette dépense" : "Dépense"}
      description={retrait ? "Saisie par erreur ou en double : elle ne compte plus, mais reste dans l'historique." : `${depense.fournisseur} · ${formatDateCourte(depense.payeeLe)}`}
      pied={
        retrait ? (
          <div className="flex justify-end gap-2">
            <Bouton variante="fantome" onClick={() => setRetrait(false)}>
              Retour
            </Bouton>
            <Bouton variante="danger" disabled={motif.trim().length < 3} chargement={envoi} onClick={() => void retirer()}>
              Retirer la dépense
            </Bouton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Bouton variante="fantome" icone={<Trash2 size={14} aria-hidden />} onClick={() => setRetrait(true)}>
              Retirer
            </Bouton>
            <div className="flex gap-2">
              <Bouton variante="fantome" onClick={onFermer}>
                Annuler
              </Bouton>
              <Bouton variante="primaire" disabled={montantLu === null || montantLu <= 0 || !fournisseur.trim()} chargement={envoi} onClick={() => void enregistrer()}>
                Enregistrer
              </Bouton>
            </div>
          </div>
        )
      }
    >
      {retrait ? (
        <ZoneTexte libelle="Pourquoi" obligatoire rows={2} maxLength={300} value={motif} onChange={(evenement) => setMotif(evenement.target.value)} />
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="rattachement" className="mb-1.5 block text-[12px] font-medium text-[#9CA3AF]">
              Chantier
            </label>
            <select id="rattachement" value={rattachement} onChange={(evenement) => setRattachement(evenement.target.value)} className={cn(CLASSE_SAISIE, "h-11 sm:h-9")}>
              <option value="">À rattacher</option>
              <option value="HORS">Hors chantier (frais généraux)</option>
              {options.map((chantier) => (
                <option key={chantier.id} value={chantier.id}>
                  {chantier.clientNom} · {chantier.objet}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Champ libelle="Montant (€)" obligatoire inputMode="decimal" value={montant} onChange={(evenement) => setMontant(evenement.target.value)} />
            <Champ libelle="Payée le" obligatoire type="date" max={jourParis(new Date())} value={payeeLe} onChange={(evenement) => setPayeeLe(evenement.target.value)} />
          </div>
          <Champ libelle="Fournisseur" obligatoire maxLength={120} value={fournisseur} onChange={(evenement) => setFournisseur(evenement.target.value)} />
          <Puces libelle="Catégorie" options={CATEGORIES_DEPENSE.map((option) => ({ valeur: option.code, libelle: option.libelle }))} valeur={categorie} onChange={setCategorie} />
          <Puces libelle="Payée par" options={MOYENS_DEPENSE.map((option) => ({ valeur: option, libelle: LIBELLES_MOYEN_DEPENSE[option] }))} valeur={moyen} onChange={setMoyen} />
          <Champ libelle="Libellé" maxLength={200} value={libelle} onChange={(evenement) => setLibelle(evenement.target.value)} />
          <ZoneTexte libelle="Note" rows={2} maxLength={1000} value={note} onChange={(evenement) => setNote(evenement.target.value)} />
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {depense.justificatif ? (
              <a href={depense.justificatif.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[#5DCAA5] hover:underline">
                <FileText size={14} aria-hidden /> Voir le justificatif
              </a>
            ) : (
              <span className="text-[#F5B454]">Sans justificatif</span>
            )}
            <label className={cn("flex cursor-pointer items-center gap-1.5 text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}>
              <Paperclip size={14} aria-hidden />
              {depense.justificatif ? "Remplacer" : "Ajouter"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(evenement) => {
                  const fichier = evenement.target.files?.[0];
                  if (fichier) void remplacerJustificatif(fichier);
                }}
              />
            </label>
          </div>
        </div>
      )}
    </Modale>
  );
}

export default function ListeDepenses({ initiale, chantiers }: { initiale: Liste; chantiers: ChantierPropose[] }) {
  const [liste, setListe] = useState(initiale);
  const [ouverte, setOuverte] = useState<DepenseVue | null>(null);
  const [attente, setAttente] = useState<EnvoiEnAttente[]>([]);
  const { annee, depenses, total, parCategorie, aRattacher, sansJustificatif } = liste;

  async function recharger() {
    try {
      setListe(await appelApi<Liste>(`/api/depenses?annee=${annee}`));
    } catch (erreur) {
      toast.error("Actualisation impossible", { description: messageErreur(erreur) });
    }
  }

  // Les saisies restées sur le téléphone partent d'ici aussi.
  useEffect(() => {
    const vider = () => {
      void envoyerFile().then(async ({ envoyes }) => {
        setAttente(await envoisEnAttente());
        if (envoyes > 0) {
          toast.success(`${envoyes} dépense${envoyes > 1 ? "s" : ""} en attente envoyée${envoyes > 1 ? "s" : ""}`);
          setListe(await appelApi<Liste>(`/api/depenses?annee=${annee}`));
        }
      });
    };
    vider();
    window.addEventListener("online", vider);
    return () => window.removeEventListener("online", vider);
  }, [annee]);

  const max = Math.max(...parCategorie.map((ligne) => ligne.total), 1);
  const mois = [...new Set(depenses.map((depense) => Number(jourParis(depense.payeeLe).slice(5, 7))))];

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Dépenses"
        sousTitre="Rattachées au chantier qu'elles servent, pour connaître la marge de chaque dossier."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/depenses?annee=${annee - 1}`} aria-label={`Année ${annee - 1}`} className={cn("rounded-[8px] p-2 text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <ChevronLeft size={16} aria-hidden />
            </Link>
            <span className="text-[14px] font-medium text-[#F2F3F5] tabular-nums">{annee}</span>
            <Link href={`/depenses?annee=${annee + 1}`} aria-label={`Année ${annee + 1}`} className={cn("rounded-[8px] p-2 text-[#9CA3AF] hover:bg-[#22262D] hover:text-[#F2F3F5]", TRANS)}>
              <ChevronRight size={16} aria-hidden />
            </Link>
            <Link href="/depenses/nouvelle" className={cn("ml-1 flex h-11 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-3.5 text-[13px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:h-8", TRANS)}>
              <Plus size={15} aria-hidden /> Nouvelle dépense
            </Link>
          </div>
        }
      />

      {attente.length > 0 ? (
        <div className={cn(CARTE, "mt-5 p-3.5")}>
          <p className="flex items-center gap-2 text-[13px] text-[#F5B454]">
            <CloudOff size={15} aria-hidden /> {`${attente.length} dépense${attente.length > 1 ? "s" : ""} en attente d'envoi sur ce téléphone`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {attente.map((envoi) => (
              <li key={envoi.identifiant} className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#9CA3AF]">
                <span>
                  {String(envoi.donnees.fournisseur ?? "")} · {formatMontant(Number(envoi.donnees.montant ?? 0))}
                </span>
                {envoi.derniereErreur ? <span className="text-[#F87171]">Refusée : {envoi.derniereErreur}</span> : null}
                {envoi.derniereErreur ? (
                  <Bouton
                    taille="sm"
                    variante="fantome"
                    onClick={() =>
                      void retirerEnvoi(envoi.identifiant).then(async () => setAttente(await envoisEnAttente()))
                    }
                  >
                    Abandonner cette saisie
                  </Bouton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <div className={cn(CARTE, "p-3.5")}>
          <p className="text-[12px] text-[#9CA3AF]">Dépensé en {annee}</p>
          <p className="mt-1 text-[20px] font-semibold text-[#F2F3F5] tabular-nums">{formatMontant(total)}</p>
        </div>
        <div className={cn(CARTE, "p-3.5")}>
          <p className="text-[12px] text-[#9CA3AF]">À rattacher</p>
          <p className={cn("mt-1 text-[20px] font-semibold tabular-nums", aRattacher > 0 ? "text-[#F5B454]" : "text-[#F2F3F5]")}>{aRattacher}</p>
        </div>
        <div className={cn(CARTE, "p-3.5")}>
          <p className="text-[12px] text-[#9CA3AF]">Sans justificatif</p>
          <p className={cn("mt-1 text-[20px] font-semibold tabular-nums", sansJustificatif > 0 ? "text-[#F5B454]" : "text-[#F2F3F5]")}>{sansJustificatif}</p>
        </div>
      </div>

      {parCategorie.length > 0 ? (
        <section className="mt-8">
          <TitreSection>Par catégorie</TitreSection>
          <div className={cn(CARTE, "space-y-2.5 p-4")}>
            {parCategorie.map((ligne) => (
              <div key={ligne.categorie}>
                <div className="flex justify-between gap-3 text-[13px]">
                  <span className="text-[#D1D5DB]">{ligne.libelle}</span>
                  <span className="text-[#9CA3AF] tabular-nums">{formatMontant(ligne.total)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#2A2D34]">
                  <div className="h-full rounded-full bg-[#1D9E75]/70" style={{ width: `${(ligne.total / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <TitreSection>Dépenses {annee}</TitreSection>
        {depenses.length === 0 ? (
          <p className="text-[13px] text-[#6B7280]">Aucune dépense en {annee}.</p>
        ) : (
          <div className={cn(CARTE, "overflow-hidden")}>
            {mois.map((numero) => (
              <div key={numero}>
                <p className="border-t-[0.5px] border-[#2A2D34] bg-[#191B20] px-4 py-2 text-[12px] font-medium text-[#9CA3AF] first:border-t-0 first-letter:uppercase">{libelleMois(numero)}</p>
                <ul>
                  {depenses
                    .filter((depense) => Number(jourParis(depense.payeeLe).slice(5, 7)) === numero)
                    .map((depense) => (
                      <li key={depense.id} className="border-t-[0.5px] border-[#2A2D34]">
                        <button type="button" onClick={() => setOuverte(depense)} className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#23262D]", TRANS)}>
                          <span className="w-[74px] shrink-0 text-[12px] text-[#9CA3AF] tabular-nums">{formatDateCourte(depense.payeeLe)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-[#F2F3F5]">
                              {depense.fournisseur} <span className="text-[#9CA3AF]">· {libelleCategorie(depense.categorie)}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#6B7280]">
                              {depense.dossier ? (
                                <span className="truncate">{depense.dossier.clientNom}</span>
                              ) : depense.horsChantier ? (
                                <span>Hors chantier</span>
                              ) : (
                                <Pastille ton="ambre">
                                  <AlertTriangle size={11} aria-hidden /> À rattacher
                                </Pastille>
                              )}
                              {depense.justificatif ? <Paperclip size={11} aria-label="Justificatif joint" /> : <span className="text-[#F5B454]">sans justificatif</span>}
                            </span>
                          </span>
                          <span className="shrink-0 text-[13px] text-[#F2F3F5] tabular-nums">{formatMontant(depense.montant)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {ouverte ? <ModaleDepense key={ouverte.id} depense={ouverte} chantiers={chantiers} onFermer={() => setOuverte(null)} onFait={() => void recharger()} /> : null}
    </div>
  );
}
