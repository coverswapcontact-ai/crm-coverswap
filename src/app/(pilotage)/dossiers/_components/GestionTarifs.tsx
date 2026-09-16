"use client";

import { useState } from "react";
import { ArrowLeft, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LIBELLES_UNITE, UNITES, type Unite } from "@/lib/dossiers/constants";
import { formatQuantite, lireNombre } from "@/lib/dossiers/montants";
import type { PresetVue } from "@/lib/dossiers/types";
import { cn } from "@/lib/utils";
import { envoyerJson, messageErreur } from "./client";
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
    </div>
  );
}
