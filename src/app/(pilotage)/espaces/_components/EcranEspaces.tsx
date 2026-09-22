"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Eye, FileText, FolderOpen, MessageSquare, Phone, PlusCircle, RefreshCw, Send, ShieldOff, Smartphone, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { appelApi, envoyerJson, messageErreur } from "@/components/pilotage/client";
import { Bouton, EnTetePage, EtatVide, Pastille, TRANS } from "@/components/pilotage/ui";
import { NouveauLien } from "@/components/pilotage/espace/NouveauLien";
import { LIBELLES_ETAPE_ESPACE, type EtapeEspace } from "@/lib/espace/etapes";
import type { ClientEspace, LigneEspace } from "@/lib/espace/suivi-types";
import { texteNouveauLien } from "@/lib/espace/textes";
import { cn } from "@/lib/utils";

/**
 * Espaces clients, PAR CLIENT (mission 5) : un client, son lien (un seul, pour
 * toujours), ses visites, et chacun de ses projets — où il en est, ce qu'il y a
 * fait, qui a la main. Ce qui attend un geste de Lucas d'abord ; les signaux
 * (nouveau projet ouvert par le client, projet de plus demandé, photos sans
 * simulation, devis relu sans signature…) sautent aux yeux.
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
const BOUTON_LIEN = cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#2A2D34] px-2.5 text-[12px] font-medium text-[#F2F3F5] hover:border-[#3A3E47] sm:h-7", TRANS);

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

const aDesSignaux = (c: ClientEspace) => c.signaux.some((s) => s.ton !== "gris");

export default function EcranEspaces({ initial }: { initial: ClientEspace[] }) {
  const [clients, setClients] = useState(initial);
  const [filtre, setFiltre] = useState<Filtre>("TOUS");
  const [etape, setEtape] = useState<EtapeEspace | "TOUTES">("TOUTES");
  const [tri, setTri] = useState<Tri>("MAIN");
  const [charge, setCharge] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const rafraichir = useCallback(async () => {
    setCharge(true);
    try {
      setClients((await appelApi<{ clients: ClientEspace[] }>("/api/espaces")).clients);
      setMaintenant(Date.now());
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setCharge(false);
    }
  }, []);

  const compteurs = useMemo(
    () => ({
      MOI: clients.filter((c) => !c.revoque && c.attente.qui === "MOI").length,
      CLIENT: clients.filter((c) => !c.revoque && c.attente.qui === "CLIENT").length,
      SIGNAUX: clients.filter((c) => !c.revoque && aDesSignaux(c)).length,
      TOUS: clients.filter((c) => !c.revoque).length,
      DESACTIVES: clients.filter((c) => c.revoque).length,
    }),
    [clients]
  );

  const visibles = useMemo(() => {
    const filtres = clients.filter((c) => {
      if (filtre === "DESACTIVES") return c.revoque;
      if (c.revoque) return false;
      if (filtre === "MOI" && c.attente.qui !== "MOI") return false;
      if (filtre === "CLIENT" && c.attente.qui !== "CLIENT") return false;
      if (filtre === "SIGNAUX" && !aDesSignaux(c)) return false;
      return etape === "TOUTES" || c.projets.some((p) => p.etape === etape);
    });
    if (tri === "ACTIVITE") return [...filtres].sort((a, b) => (b.derniereActivite ?? b.lienEmisLe).localeCompare(a.derniereActivite ?? a.lienEmisLe));
    if (tri === "CREATION") return [...filtres].sort((a, b) => b.lienEmisLe.localeCompare(a.lienEmisLe));
    return filtres; // déjà rangés : ce qui m'attend d'abord, puis la dernière activité
  }, [clients, filtre, etape, tri]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Espaces clients"
        sousTitre="Un client, son espace, ses projets. Ce qui attend un geste de ma part d'abord."
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
          <EtatVide icone={<Smartphone size={20} aria-hidden />} titre={clients.length === 0 ? "Aucun espace client pour l'instant" : "Rien ici"} texte={clients.length === 0 ? "Un espace s'ouvre depuis un lead ou un dossier : « Ouvrir l'espace client », puis le lien part par SMS. Un client n'en a qu'un, pour tous ses projets." : "Aucun client ne correspond à ce filtre."} />
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {visibles.map((client) => (
            <CarteClient key={client.permanentId} client={client} maintenant={maintenant} onRecharger={rafraichir} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un client : son lien, ses visites, ses signaux d'espace, puis chacun de ses projets. */
function CarteClient({ client, maintenant, onRecharger }: { client: ClientEspace; maintenant: number; onRecharger: () => Promise<void> }) {
  const [copie, setCopie] = useState(false);
  const [occupe, setOccupe] = useState<string | null>(null);
  const prenom = client.clientNom.trim().split(/\s+/)[0] ?? "";

  async function copier() {
    if (!client.lien) return;
    try {
      await navigator.clipboard.writeText(client.lien);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      toast.error("Copie impossible : ouvrez le dossier pour sélectionner le lien.");
    }
  }

  async function agir(corps: Record<string, unknown>, succes: string) {
    setOccupe(String(corps.action));
    try {
      await envoyerJson(`/api/espaces/${client.permanentId}`, "POST", corps);
      toast.success(succes);
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(null);
    }
  }

  const signauxClient = client.signaux.filter((s) => ["NOUVEAU_PROJET", "PROJET_DEMANDE", "CONFIRMATION_DEMANDEE"].includes(s.code));
  const lienPermanent = !client.permanentId.startsWith("projet:");

  return (
    <li className={cn("rounded-[14px] border-[0.5px] bg-[#1C1F25] p-3.5 sm:p-4", client.attente.qui === "MOI" ? "border-[#1D9E75]/40" : "border-[#2A2D34]", client.revoque && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-[#F2F3F5]">
            {client.clientNom}
            {client.ville ? <span className="font-normal text-[#9CA3AF]"> · {client.ville}</span> : null}
          </p>
          <p className="mt-0.5 text-[12px] text-[#8B919C]">
            {client.dernierAccesLe ? `Espace vu ${ilYa(client.dernierAccesLe, maintenant)}` : "Espace jamais ouvert"}
            {client.nbAcces > 1 ? ` · ${client.nbAcces} visites` : ""} · {client.projets.length} projet{client.projets.length > 1 ? "s" : ""} ({client.projetsEnCours} en cours sur {client.limite} permis)
          </p>
        </div>
        <Pastille ton={client.attente.qui === "MOI" ? "vert" : client.attente.qui === "CLIENT" ? "bleu" : "neutre"}>
          {client.attente.qui === "MOI" ? "À moi" : client.attente.qui === "CLIENT" ? "Client" : "—"} : {client.attente.libelle}
        </Pastille>
      </div>

      {signauxClient.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signauxClient.map((s) => (
            <Pastille key={s.code} ton={s.ton === "rouge" ? "rouge" : s.ton === "ambre" ? "ambre" : "neutre"}>
              {s.libelle}
            </Pastille>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {client.projetDemandeLe && lienPermanent ? (
          <Bouton taille="sm" variante="primaire" icone={<PlusCircle size={13} aria-hidden />} chargement={occupe === "accorder-projet"} onClick={() => void agir({ action: "accorder-projet", nombre: 1 }, "Un projet de plus accordé : il peut l'ouvrir")}>
            Accorder un projet de plus
          </Bouton>
        ) : null}
        {client.apercu ? (
          <a href={client.apercu} target="_blank" rel="noopener noreferrer" className={BOUTON_LIEN}>
            <Eye size={13} aria-hidden /> Voir comme le client
          </a>
        ) : null}
        {client.lien ? (
          <Bouton taille="sm" icone={copie ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copier()}>
            {copie ? "Copié" : "Copier son lien"}
          </Bouton>
        ) : null}
        {lienPermanent ? <NouveauLien permanentId={client.permanentId} texteSms={texteNouveauLien(prenom)} numero={client.telephone || null} onFait={onRecharger} /> : null}
        {!client.revoque && lienPermanent ? (
          <Bouton taille="sm" variante="fantome" icone={<ShieldOff size={13} aria-hidden />} chargement={occupe === "desactiver"} onClick={() => void agir({ action: "desactiver" }, "Lien désactivé (tous ses projets)")}>
            Désactiver
          </Bouton>
        ) : null}
      </div>

      <ul className="mt-3 space-y-2">
        {client.projets.map((projet) => (
          <CarteProjet key={projet.espaceId} ligne={projet} plusieurs={client.projets.length > 1} onRecharger={onRecharger} />
        ))}
      </ul>
    </li>
  );
}

/** Le geste qui fait avancer ce projet, quand c'est à Lucas de jouer : un bouton, pas un détour. */
function GesteDuMoment({ ligne, onAccorder, accordEnCours }: { ligne: LigneEspace; onAccorder: () => void; accordEnCours: boolean }) {
  const classe = cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#1D9E75] px-2.5 text-[12px] font-medium text-[#0B1612] hover:bg-[#5DCAA5] sm:h-7", TRANS);
  switch (ligne.attente.geste) {
    case "ACCORDER":
      return (
        <button type="button" disabled={accordEnCours} onClick={onAccorder} className={cn(classe, "disabled:opacity-60")}>
          <WandSparkles size={13} aria-hidden /> {accordEnCours ? "Un instant…" : "Accorder 3 simulations"}
        </button>
      );
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

/** Un projet du client : où il en est, ce qu'il y a fait, ce qu'il attend. */
function CarteProjet({ ligne, plusieurs, onRecharger }: { ligne: LigneEspace; plusieurs: boolean; onRecharger: () => Promise<void> }) {
  const [occupe, setOccupe] = useState(false);
  const f = ligne.faits;

  async function accorder() {
    setOccupe(true);
    try {
      await envoyerJson(`/api/dossiers/${ligne.dossierId}/espace`, "POST", { action: "accorder", nombre: 3 });
      toast.success("3 simulations accordées : le client peut en refaire");
      await onRecharger();
    } catch (erreur) {
      toast.error(messageErreur(erreur));
    } finally {
      setOccupe(false);
    }
  }

  const faits: { libelle: string; fait: boolean }[] = [
    { libelle: f.photos ? `${f.photos} photo${f.photos > 1 ? "s" : ""}` : "Photos", fait: f.photos > 0 },
    { libelle: f.projetValideLe ? "Projet validé" : f.projet ? "Projet saisi, pas validé" : "Projet", fait: Boolean(f.projetValideLe) },
    { libelle: f.simulationsPubliees ? `${f.simulationsPubliees} publiée${f.simulationsPubliees > 1 ? "s" : ""} par moi` : "Rien de publié", fait: f.simulationsPubliees > 0 },
    { libelle: `${f.simulationsClient + f.simulationsSite} faite${f.simulationsClient + f.simulationsSite > 1 ? "s" : ""} par le client${f.simulationsSite ? ` (dont ${f.simulationsSite} sur le site)` : ""} · ${f.simulationsRestantes} restante${f.simulationsRestantes > 1 ? "s" : ""}`, fait: f.simulationsClient + f.simulationsSite > 0 },
    { libelle: f.choix ? "Simulation validée" : "Pas encore validée", fait: Boolean(f.choix) },
    { libelle: !f.devis ? "Devis" : f.devis.consultations > 0 ? `Devis lu ${f.devis.consultations} fois` : "Devis pas encore ouvert", fait: Boolean(f.devis && f.devis.consultations > 0) },
    { libelle: f.accord ? (f.accordSource === "CRM" ? "Signé (hors espace)" : "Bon pour accord") : "Accord", fait: Boolean(f.accord) },
    { libelle: !f.paiement ? "Paiement" : f.paiement.regle ? "Réglé" : f.paiement.recu > 0 ? `${f.paiement.recu.toLocaleString("fr-FR")} € reçus, reste ${f.paiement.reste.toLocaleString("fr-FR")} €` : "Acompte attendu", fait: Boolean(f.paiement?.regle || (f.acompte && f.acompte.recu >= f.acompte.montant - 0.5)) },
  ];
  const signaux = ligne.signaux;

  return (
    <li className={cn("rounded-[11px] border-[0.5px] bg-[#16181D] p-3", ligne.attente.qui === "MOI" ? "border-[#1D9E75]/30" : "border-[#2A2D34]", ligne.fige && "opacity-80")}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-[#F2F3F5]">
            {ligne.nomProjet}
            {ligne.creeParLeClient ? <span className="ml-1.5 text-[11.5px] font-normal text-[#5DCAA5]">ouvert par le client</span> : null}
          </p>
          <p className="text-[12px] text-[#8B919C]">{ligne.familles.map((x) => x.libelle).join(", ") || "Familles à préciser"}</p>
        </div>
        {ligne.fige ? (
          <Pastille ton={ligne.fige === "TERMINE" ? "vert" : "neutre"}>{ligne.fige === "TERMINE" ? "Terminé" : "Non réalisé"}</Pastille>
        ) : plusieurs ? (
          <Pastille ton={ligne.attente.qui === "MOI" ? "vert" : ligne.attente.qui === "CLIENT" ? "bleu" : "neutre"}>
            {ligne.attente.qui === "MOI" ? "À moi" : ligne.attente.qui === "CLIENT" ? "Client" : "—"} : {ligne.attente.libelle}
          </Pastille>
        ) : null}
      </div>

      {ligne.fige ? null : (
        <>
          <ol className="mt-2.5 grid max-w-[420px] grid-cols-5 gap-1" aria-label={`Étape : ${ligne.etapeLibelle}`}>
            {ligne.etapes.map((e) => (
              <li key={e.cle}>
                <span className={cn("block h-1 rounded-full", e.fait ? "bg-[#5DCAA5]" : e.courante ? "bg-[#F5B454]" : "bg-[#2A2D34]")} />
                <span className={cn("mt-1 block text-[10.5px]", e.courante ? "text-[#F5B454]" : e.fait ? "text-[#9CA3AF]" : "text-[#6B7280]")}>{e.libelle}</span>
              </li>
            ))}
          </ol>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {faits.map((fait) => (
              <li key={fait.libelle} className={cn("flex items-center gap-1 rounded-[6px] px-2 py-[3px] text-[11.5px]", fait.fait ? "bg-[#112B22] text-[#5DCAA5]" : "bg-[#22262D] text-[#8B919C]")}>
                {fait.fait ? <Check size={11} aria-hidden /> : null}
                {fait.libelle}
              </li>
            ))}
          </ul>
        </>
      )}

      {f.projet ? <p className="mt-2 line-clamp-2 text-[12.5px] text-[#9CA3AF]">{f.projet}</p> : null}
      {f.choixTeintes ? <p className="mt-1 line-clamp-2 text-[12.5px] text-[#5DCAA5]">Validé : {f.choixTeintes}</p> : null}
      {f.proposition ? (
        <p className="mt-1.5 rounded-[8px] border-[0.5px] border-[#F5B454]/40 bg-[#F5B454]/10 px-2.5 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-[#F2F3F5]">
          <span className="font-medium text-[#F5B454]">Il demande autre chose : </span>
          {f.proposition.message ? `« ${f.proposition.message} »` : "sans message."}
        </p>
      ) : null}

      {signaux.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signaux.map((s) => (
            <Pastille key={s.code} ton={s.ton === "rouge" ? "rouge" : s.ton === "ambre" ? "ambre" : "neutre"}>
              {s.libelle}
            </Pastille>
          ))}
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t-[0.5px] border-[#2A2D34] pt-2.5">
        {ligne.attente.qui === "MOI" && ligne.attente.geste ? <GesteDuMoment ligne={ligne} accordEnCours={occupe} onAccorder={() => void accorder()} /> : null}
        {ligne.attente.geste !== "ACCORDER" && f.simulationsRestantes === 0 && f.simulationsClient > 0 && !ligne.revoque && !ligne.fige ? (
          <Bouton taille="sm" icone={<WandSparkles size={13} aria-hidden />} chargement={occupe} onClick={() => void accorder()}>
            Accorder 3 simulations
          </Bouton>
        ) : null}
        <Link href={`/dossiers?dossier=${ligne.dossierId}`} className={BOUTON_LIEN}>
          <FolderOpen size={13} aria-hidden /> Dossier
        </Link>
        {ligne.apercu && plusieurs ? (
          <a href={ligne.apercu} target="_blank" rel="noopener noreferrer" className={BOUTON_LIEN}>
            <Eye size={13} aria-hidden /> Ce projet, comme lui
          </a>
        ) : null}
        {ligne.lien && !ligne.fige ? (
          <Link href={`/sms?dossier=${ligne.dossierId}&proposer=${ligne.etape === "PHOTOS" ? "LIEN_ESPACE" : "LIEN_ESPACE_RAPPEL"}`} className={BOUTON_LIEN}>
            <MessageSquare size={13} aria-hidden /> Relancer par SMS
          </Link>
        ) : null}
        {ligne.attente.geste === "SIMULATEUR" || ligne.fige ? null : (
          <Link href={`/simulateur?dossier=${ligne.dossierId}`} className={BOUTON_LIEN}>
            <WandSparkles size={13} aria-hidden /> Simulateur
          </Link>
        )}
      </div>
    </li>
  );
}
