"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Eye, FileText, FolderOpen, MessageSquare, Phone, RefreshCw, Send, ShieldOff, Smartphone, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, EnTetePage, EtatVide, Pastille, TRANS } from "@/components/pilotage/ui";
import { LIBELLES_ETAPE_ESPACE, type EtapeEspace } from "@/lib/espace/etapes";
import type { LigneEspace } from "@/lib/espace/suivi-types";
import { cn } from "@/lib/utils";

/**
 * Espaces clients : ce que chaque client fait DE SON CÔTÉ, sans ouvrir les
 * dossiers. Par défaut, ce qui attend un geste de Lucas en premier ; les
 * signaux (photos sans simulation, devis relu sans signature, lien jamais
 * ouvert, lien qui expire) sautent aux yeux. Dossiers montre l'affaire ;
 * ici, le client.
 */

type Filtre = "TOUS" | "MOI" | "CLIENT" | "SIGNAUX" | "DESACTIVES";
type Tri = "MAIN" | "ACTIVITE" | "CREATION";

const FILTRES: { valeur: Filtre; libelle: string }[] = [
  { valeur: "MOI", libelle: "À moi" },
  { valeur: "CLIENT", libelle: "Chez le client" },
  { valeur: "SIGNAUX", libelle: "Signaux" },
  { valeur: "TOUS", libelle: "Tous" },
  { valeur: "DESACTIVES", libelle: "Désactivés" },
];

const ETAPES: EtapeEspace[] = ["PHOTOS", "PROJET", "ATTENTE_SIMULATION", "SIMULATIONS", "ATTENTE_DEVIS", "DEVIS", "ACOMPTE", "CHANTIER", "TERMINE"];

function ilYa(iso: string | null, maintenant: number): string {
  if (!iso) return "jamais";
  const minutes = Math.round((maintenant - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return jours === 1 ? "hier" : `il y a ${jours} j`;
}

const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

export default function EcranEspaces({ initial }: { initial: LigneEspace[] }) {
  const [lignes, setLignes] = useState(initial);
  const [filtre, setFiltre] = useState<Filtre>("TOUS");
  const [etape, setEtape] = useState<EtapeEspace | "TOUTES">("TOUTES");
  const [tri, setTri] = useState<Tri>("MAIN");
  const [charge, setCharge] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const rafraichir = useCallback(async () => {
    setCharge(true);
    try {
      setLignes((await appelApi<{ espaces: LigneEspace[] }>("/api/espaces")).espaces);
      setMaintenant(Date.now());
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setCharge(false);
    }
  }, []);

  const compteurs = useMemo(
    () => ({
      MOI: lignes.filter((l) => !l.revoque && l.attente.qui === "MOI").length,
      CLIENT: lignes.filter((l) => !l.revoque && l.attente.qui === "CLIENT").length,
      SIGNAUX: lignes.filter((l) => !l.revoque && l.signaux.some((s) => s.ton !== "gris")).length,
      TOUS: lignes.filter((l) => !l.revoque).length,
      DESACTIVES: lignes.filter((l) => l.revoque).length,
    }),
    [lignes]
  );

  const visibles = useMemo(() => {
    const filtrees = lignes.filter((l) => {
      if (filtre === "DESACTIVES") return l.revoque;
      if (l.revoque) return false;
      if (filtre === "MOI" && l.attente.qui !== "MOI") return false;
      if (filtre === "CLIENT" && l.attente.qui !== "CLIENT") return false;
      if (filtre === "SIGNAUX" && !l.signaux.some((s) => s.ton !== "gris")) return false;
      return etape === "TOUTES" || l.etape === etape;
    });
    const activite = (l: LigneEspace) => l.derniereActivite ?? l.creeLe;
    if (tri === "ACTIVITE") return [...filtrees].sort((a, b) => activite(b).localeCompare(activite(a)));
    if (tri === "CREATION") return [...filtrees].sort((a, b) => b.creeLe.localeCompare(a.creeLe));
    return filtrees; // déjà rangées : ce qui m'attend d'abord, puis la dernière activité
  }, [lignes, filtre, etape, tri]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Espaces clients"
        sousTitre="Ce que chaque client fait dans son espace. Ce qui attend un geste de ma part d'abord."
        actions={
          <Bouton variante="fantome" taille="icone" aria-label="Rafraîchir" chargement={charge} onClick={() => void rafraichir()}>
            <RefreshCw size={15} aria-hidden />
          </Bouton>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtre">
          {FILTRES.map((f) => (
            <button
              key={f.valeur}
              type="button"
              role="tab"
              aria-selected={filtre === f.valeur}
              onClick={() => setFiltre(f.valeur)}
              className={cn(
                "h-9 rounded-full border-[0.5px] px-3 text-[13px] sm:h-8 sm:text-[12.5px]",
                filtre === f.valeur ? "border-[#1D9E75]/60 bg-[#112B22] text-[#5DCAA5]" : "border-[#2A2D34] bg-[#16181D] text-[#D1D5DB] hover:border-[#3A3E47]",
                TRANS
              )}
            >
              {f.libelle}
              <span className="ml-1.5 text-[11.5px] opacity-70 tabular-nums">{compteurs[f.valeur]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select aria-label="Étape" value={etape} onChange={(e) => setEtape(e.target.value as EtapeEspace | "TOUTES")} className="h-9 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 text-[13px] text-[#D1D5DB] [color-scheme:dark] sm:h-8">
            <option value="TOUTES">Toutes les étapes</option>
            {ETAPES.map((e) => (
              <option key={e} value={e}>
                {LIBELLES_ETAPE_ESPACE[e]}
              </option>
            ))}
          </select>
          <select aria-label="Tri" value={tri} onChange={(e) => setTri(e.target.value as Tri)} className="h-9 rounded-[8px] border-[0.5px] border-[#2A2D34] bg-[#16181D] px-2 text-[13px] text-[#D1D5DB] [color-scheme:dark] sm:h-8">
            <option value="MAIN">À moi d&apos;abord</option>
            <option value="ACTIVITE">Dernière activité</option>
            <option value="CREATION">Lien le plus récent</option>
          </select>
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="mt-8">
          <EtatVide icone={<Smartphone size={20} aria-hidden />} titre={lignes.length === 0 ? "Aucun espace client pour l'instant" : "Rien ici"} texte={lignes.length === 0 ? "Un espace s'ouvre depuis un lead ou un dossier : « Ouvrir l'espace client », puis le lien part par SMS." : "Aucun espace ne correspond à ce filtre."} />
        </div>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {visibles.map((ligne) => (
            <CarteEspace key={ligne.espaceId} ligne={ligne} maintenant={maintenant} onRecharger={rafraichir} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Le geste qui fait avancer ce client, quand c'est à Lucas de jouer : un bouton, pas un détour. */
function GesteDuMoment({ ligne }: { ligne: LigneEspace }) {
  const classe = cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-2.5 text-[12px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:h-7", TRANS);
  switch (ligne.attente.geste) {
    case "DEVIS":
      return (
        <Link href={`/dossiers?dossier=${ligne.dossierId}&devis=nouveau`} className={classe}>
          <FileText size={13} aria-hidden /> Faire le devis
        </Link>
      );
    case "SIMULATEUR":
      return (
        <Link href={`/simulateur?dossier=${ligne.dossierId}`} className={classe}>
          <WandSparkles size={13} aria-hidden /> {ligne.attente.libelle}
        </Link>
      );
    case "PUBLIER":
      return (
        <Link href={`/dossiers?dossier=${ligne.dossierId}`} className={classe}>
          <Send size={13} aria-hidden /> {ligne.attente.libelle}
        </Link>
      );
    case "APPELER":
      return (
        <a href={`tel:${ligne.telephone.replace(/[^\d+]/g, "")}`} className={classe}>
          <Phone size={13} aria-hidden /> Appeler pour la date
        </a>
      );
    default:
      return null;
  }
}

function CarteEspace({ ligne, maintenant, onRecharger }: { ligne: LigneEspace; maintenant: number; onRecharger: () => Promise<void> }) {
  const [copie, setCopie] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const f = ligne.faits;

  async function copier() {
    if (!ligne.lien) return;
    try {
      await navigator.clipboard.writeText(ligne.lien);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("Copie impossible : ouvrez le dossier pour sélectionner le lien.");
    }
  }

  async function agir(action: "renouveler" | "revoquer" | "ouvrir", succes: string) {
    setOccupe(action);
    try {
      await envoyerJson(`/api/dossiers/${ligne.dossierId}/espace`, "POST", { action });
      toast.success(succes);
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const faits: { libelle: string; fait: boolean }[] = [
    { libelle: f.photos ? `${f.photos} photo${f.photos > 1 ? "s" : ""}` : "Photos", fait: f.photos > 0 },
    { libelle: "Projet", fait: Boolean(f.projet) },
    { libelle: f.simulationsPubliees ? `${f.simulationsPubliees} simulation${f.simulationsPubliees > 1 ? "s" : ""}` : "Simulation", fait: f.simulationsPubliees > 0 },
    { libelle: "Choix", fait: Boolean(f.choix) },
    { libelle: !f.devis ? "Devis" : f.devis.consultations > 0 ? `Devis lu ${f.devis.consultations} fois` : "Devis pas encore ouvert", fait: Boolean(f.devis && f.devis.consultations > 0) },
    { libelle: "Accord", fait: Boolean(f.accord) },
    { libelle: "Acompte", fait: Boolean(f.acompte && f.acompte.recu >= f.acompte.montant - 0.5) },
  ];

  return (
    <li className={cn("rounded-[14px] border-[0.5px] bg-[#1C1F25] p-3.5 sm:p-4", ligne.attente.qui === "MOI" ? "border-[#1D9E75]/40" : "border-[#2A2D34]", ligne.revoque && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-[#F2F3F5]">
            {ligne.clientNom}
            {ligne.ville ? <span className="font-normal text-[#9CA3AF]"> · {ligne.ville}</span> : null}
          </p>
          <p className="mt-0.5 text-[12px] text-[#8B919C]">
            {ligne.lienEnvoyeLe ? `Lien envoyé le ${jour(ligne.lienEnvoyeLe)}` : `Espace ouvert le ${jour(ligne.creeLe)}`} · {ligne.dernierAccesLe ? `vu ${ilYa(ligne.dernierAccesLe, maintenant)}` : "jamais ouvert"}
            {ligne.nbAcces > 1 ? ` · ${ligne.nbAcces} visites` : ""}
          </p>
        </div>
        <Pastille ton={ligne.attente.qui === "MOI" ? "vert" : ligne.attente.qui === "CLIENT" ? "bleu" : "neutre"}>
          {ligne.attente.qui === "MOI" ? "À moi" : ligne.attente.qui === "CLIENT" ? "Client" : "—"} : {ligne.attente.libelle}
        </Pastille>
      </div>

      <ol className="mt-3 grid max-w-[420px] grid-cols-5 gap-1" aria-label={`Étape : ${ligne.etapeLibelle}`}>
        {ligne.etapes.map((e) => (
          <li key={e.cle}>
            <span className={cn("block h-1 rounded-full", e.fait ? "bg-[#5DCAA5]" : e.courante ? "bg-[#F5B454]" : "bg-[#2A2D34]")} />
            <span className={cn("mt-1 block text-[10.5px]", e.courante ? "text-[#F5B454]" : e.fait ? "text-[#9CA3AF]" : "text-[#6B7280]")}>{e.libelle}</span>
          </li>
        ))}
      </ol>

      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {faits.map((fait) => (
          <li key={fait.libelle} className={cn("flex items-center gap-1 rounded-[6px] px-2 py-[3px] text-[11.5px]", fait.fait ? "bg-[#112B22] text-[#5DCAA5]" : "bg-[#22262D] text-[#8B919C]")}>
            {fait.fait ? <Check size={11} aria-hidden /> : null}
            {fait.libelle}
          </li>
        ))}
      </ul>

      {f.projet ? <p className="mt-2 line-clamp-2 text-[12.5px] text-[#9CA3AF]">{f.projet}</p> : null}

      {ligne.signaux.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ligne.signaux.map((s) => (
            <Pastille key={s.code} ton={s.ton === "rouge" ? "rouge" : s.ton === "ambre" ? "ambre" : "neutre"}>
              {s.libelle}
            </Pastille>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t-[0.5px] border-[#2A2D34] pt-3">
        {ligne.attente.qui === "MOI" && ligne.attente.geste ? <GesteDuMoment ligne={ligne} /> : null}
        <Link href={`/dossiers?dossier=${ligne.dossierId}`} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS)}>
          <FolderOpen size={13} aria-hidden /> Dossier
        </Link>
        {ligne.apercu ? (
          <a href={ligne.apercu} target="_blank" rel="noopener noreferrer" className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS)}>
            <Eye size={13} aria-hidden /> Voir comme le client
          </a>
        ) : null}
        {ligne.lien ? (
          <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier()}>
            {copie ? "Copié" : "Copier le lien"}
          </Bouton>
        ) : null}
        {ligne.lien ? (
          <Link href={`/sms?dossier=${ligne.dossierId}&proposer=${ligne.etape === "PHOTOS" ? "LIEN_ESPACE" : "LIEN_ESPACE_RAPPEL"}`} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS)}>
            <MessageSquare size={13} aria-hidden /> Renvoyer par SMS
          </Link>
        ) : null}
        {ligne.attente.geste === "SIMULATEUR" ? null : (
          <Link href={`/simulateur?dossier=${ligne.dossierId}`} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS)}>
            <WandSparkles size={13} aria-hidden /> Simulateur
          </Link>
        )}
        <Bouton taille="sm" variante="fantome" icone={<RefreshCw size={13} aria-hidden />} chargement={occupe === "renouveler"} onClick={() => void agir("renouveler", ligne.revoque ? "Espace réactivé : nouveau lien, à renvoyer au client" : "Nouveau lien émis : l'ancien ne fonctionne plus")}>
          {ligne.revoque ? "Réactiver" : ligne.expire ? "Renouveler" : "Nouveau lien"}
        </Bouton>
        {!ligne.revoque ? (
          <Bouton taille="sm" variante="fantome" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "revoquer"} onClick={() => void agir("revoquer", "Lien désactivé")}>
            Désactiver
          </Bouton>
        ) : null}
      </div>
    </li>
  );
}
