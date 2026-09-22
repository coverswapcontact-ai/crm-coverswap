"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LIBELLES_UNITE, UNITES, type Unite } from "@/lib/dossiers/constants";
import { formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import type { PresetVue } from "@/lib/dossiers/types";
import type { LigneTarifPrestation } from "@/lib/prestations/tarifs";
import { cn } from "@/lib/utils";
import { appelApi, envoyerJson, messageErreur } from "./client";
import { Bouton, CLASSE_SAISIE } from "./ui";

type SaisiePreset = { designation: string; unite: Unite; prix: string };

const prixSaisi = (prixUnitaire: number | null) => (prixUnitaire === null ? "" : formatQuantite(prixUnitaire));

/** Prix saisi → nombre, null (à saisir sur chaque devis) ou undefined si illisible. */
function lirePrix(prix: string): number | null | undefined {
  if (!prix.trim()) return null;
  const valeur = lireNombre(prix);
  return valeur === null || valeur < 0 ? undefined : valeur;
}

function ChampsPreset({
  saisie,
  onChange,
  invalide,
}: {
  saisie: SaisiePreset;
  onChange: (saisie: SaisiePreset) => void;
  invalide: boolean;
}) {
  return (
    <>
      <input
        aria-label="Désignation"
        value={saisie.designation}
        onChange={(e) => onChange({ ...saisie, designation: e.target.value })}
        placeholder="Désignation"
        className={cn(CLASSE_SAISIE, "h-10 sm:h-8")}
      />
      <select
        aria-label="Unité"
        value={saisie.unite}
        onChange={(e) => onChange({ ...saisie, unite: e.target.value as Unite })}
        className={cn(CLASSE_SAISIE, "h-10 px-2 sm:h-8")}
      >
        {UNITES.map((unite) => (
          <option key={unite} value={unite}>
            {LIBELLES_UNITE[unite]}
          </option>
        ))}
      </select>
      <input
        aria-label="Prix unitaire HT"
        inputMode="decimal"
        value={saisie.prix}
        onChange={(e) => onChange({ ...saisie, prix: e.target.value })}
        placeholder="À saisir"
        aria-invalid={invalide || undefined}
        className={cn(CLASSE_SAISIE, "h-10 text-right sm:h-8")}
      />
    </>
  );
}

function LignePreset({
  preset,
  setPresets,
}: {
  preset: PresetVue;
  setPresets: React.Dispatch<React.SetStateAction<PresetVue[]>>;
}) {
  const initiale: SaisiePreset = { designation: preset.designation, unite: preset.unite, prix: prixSaisi(preset.prixUnitaire) };
  const [saisie, setSaisie] = useState(initiale);
  const [envoi, setEnvoi] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const modifie =
    saisie.designation !== initiale.designation || saisie.unite !== initiale.unite || saisie.prix !== initiale.prix;
  const prix = lirePrix(saisie.prix);

  async function enregistrer() {
    if (prix === undefined || !saisie.designation.trim()) return;
    setEnvoi(true);
    try {
      const maj = await envoyerJson<PresetVue>(`/api/dossiers/presets/${preset.id}`, "PATCH", {
        designation: saisie.designation,
        unite: saisie.unite,
        prixUnitaire: prix,
      });
      setPresets((actuels) => actuels.map((p) => (p.id === maj.id ? maj : p)));
      toast.success("Tarif enregistré");
    } catch (probleme) {
      toast.error("Tarif non enregistré", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  async function retirer() {
    setEnvoi(true);
    try {
      await envoyerJson(`/api/dossiers/presets/${preset.id}`, "DELETE");
      setPresets((actuels) => actuels.filter((p) => p.id !== preset.id));
    } catch (probleme) {
      toast.error("Tarif non retiré", { description: messageErreur(probleme) });
      setEnvoi(false);
    }
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_88px] gap-2 rounded-[9px] border-[0.5px] border-[#2A2D34] bg-[#16181D] p-2 sm:grid-cols-[minmax(0,1fr)_96px_104px_auto] sm:items-center">
      <div className="col-span-2 sm:contents">
        <ChampsPreset saisie={saisie} onChange={setSaisie} invalide={prix === undefined} />
      </div>
      <div className="col-span-2 flex justify-end gap-1.5 sm:col-span-1">
        {modifie ? (
          <Bouton
            variante="primaire"
            taille="icone"
            aria-label="Enregistrer le tarif"
            chargement={envoi}
            disabled={prix === undefined || !saisie.designation.trim()}
            onClick={() => void enregistrer()}
          >
            <Check size={14} />
          </Bouton>
        ) : null}
        {confirmation ? (
          <Bouton variante="danger" taille="sm" chargement={envoi} onClick={() => void retirer()}>
            Retirer
          </Bouton>
        ) : (
          <Bouton variante="fantome" taille="icone" aria-label="Retirer le tarif" onClick={() => setConfirmation(true)}>
            <Trash2 size={14} />
          </Bouton>
        )}
      </div>
    </li>
  );
}

/** Presets de tarifs, éditables depuis le générateur. */
export function GestionTarifs({
  presets,
  setPresets,
  onRetour,
}: {
  presets: PresetVue[];
  setPresets: React.Dispatch<React.SetStateAction<PresetVue[]>>;
  onRetour: () => void;
}) {
  const vide: SaisiePreset = { designation: "", unite: "ml", prix: "" };
  const [nouveau, setNouveau] = useState<SaisiePreset>(vide);
  const [envoi, setEnvoi] = useState(false);
  const prix = lirePrix(nouveau.prix);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nouveau.designation.trim() || prix === undefined) return;
    setEnvoi(true);
    try {
      const cree = await envoyerJson<PresetVue>("/api/dossiers/presets", "POST", {
        designation: nouveau.designation,
        unite: nouveau.unite,
        prixUnitaire: prix,
      });
      setPresets((actuels) => [...actuels, cree]);
      setNouveau(vide);
    } catch (probleme) {
      toast.error("Tarif non ajouté", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#9CA3AF]">
          Prix HT. Un prix vide se saisit à chaque document (carburant, péage…).
        </p>
        <Bouton variante="secondaire" taille="sm" icone={<ArrowLeft size={13} aria-hidden />} onClick={onRetour}>
          Retour au document
        </Bouton>
      </div>
      <ul className="space-y-2">
        {presets.map((preset) => (
          <LignePreset key={preset.id} preset={preset} setPresets={setPresets} />
        ))}
      </ul>
      <form
        onSubmit={ajouter}
        className="mt-4 grid grid-cols-[minmax(0,1fr)_88px] gap-2 rounded-[9px] border-[0.5px] border-dashed border-[#3A3E47] p-2 sm:grid-cols-[minmax(0,1fr)_96px_104px_auto] sm:items-center"
      >
        <div className="col-span-2 sm:contents">
          <ChampsPreset saisie={nouveau} onChange={setNouveau} invalide={prix === undefined} />
        </div>
        <Bouton
          type="submit"
          variante="primaire"
          taille="sm"
          icone={<Plus size={13} aria-hidden />}
          chargement={envoi}
          disabled={!nouveau.designation.trim() || prix === undefined}
          className="col-span-2 sm:col-span-1"
        >
          Ajouter
        </Bouton>
      </form>
      <TarifsParPrestation presets={presets} />
    </div>
  );
}

/**
 * Le tarif de chaque prestation (fichier des prestations) : celui qui chiffre la
 * sous-partie dans le devis prérempli. « Automatique » : le premier tarif dont la
 * désignation la nomme ; sinon aucun, et le prix se saisit sur le devis.
 */
function TarifsParPrestation({ presets }: { presets: PresetVue[] }) {
  const [lignes, setLignes] = useState<LigneTarifPrestation[] | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<{ lignes: LigneTarifPrestation[] }>("/api/prestations/tarifs")
      .then((r) => actif && setLignes(r.lignes))
      .catch(() => actif && setLignes([]));
    return () => {
      actif = false;
    };
  }, [presets]);

  async function attribuer(cle: string, presetId: string | null) {
    setEnvoi(cle);
    try {
      setLignes((await envoyerJson<{ lignes: LigneTarifPrestation[] }>("/api/prestations/tarifs", "POST", { cle, presetId })).lignes);
    } catch (probleme) {
      toast.error("Tarif non attribué", { description: messageErreur(probleme) });
    } finally {
      setEnvoi(null);
    }
  }

  if (!lignes || lignes.length === 0) return null;
  const familles = [...new Set(lignes.map((l) => l.familleLibelle))];
  return (
    <section className="mt-6">
      <h3 className="text-[13px] font-medium text-[#F2F3F5]">Tarif de chaque prestation</h3>
      <p className="mt-0.5 text-[12.5px] text-[#9CA3AF]">Le devis prérempli chiffre chaque partie cochée par le client (ou par toi) avec ce tarif. Sans tarif, le prix se saisit sur le devis.</p>
      <div className="mt-3 space-y-3">
        {familles.map((nom) => (
          <div key={nom}>
            <p className="mb-1 text-[11px] font-medium tracking-[0.06em] text-[#8B919C] uppercase">{nom}</p>
            <ul className="space-y-1">
              {lignes
                .filter((l) => l.familleLibelle === nom)
                .map((l) => (
                  <li key={l.cle} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2">
                    <span className="truncate text-[13px] text-[#D1D5DB]">{l.libelle}</span>
                    <select
                      aria-label={`Tarif : ${l.libelle}`}
                      value={l.explicite ? (l.presetId ?? "") : ""}
                      disabled={envoi === l.cle}
                      onChange={(e) => void attribuer(l.cle, e.target.value || null)}
                      className={cn(CLASSE_SAISIE, "h-10 px-2 text-[12.5px] sm:h-8", !l.presetId && "text-[#8B919C]")}
                    >
                      <option value="">{l.explicite ? "Automatique" : l.presetId ? `Automatique : ${l.designation} (${l.prixUnitaire ?? "?"} €/${l.unite})` : "Automatique : aucun (prix à saisir)"}</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.designation} ({p.prixUnitaire ?? "à saisir"}{p.prixUnitaire !== null ? ` €/${p.unite}` : ""})
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
