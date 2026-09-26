"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { EnTetePage, TRANS } from "@/components/pilotage/ui";
import type { VueAccesAssistant, VueConsignesAssistant } from "@/lib/assistant/vues-parametres";
import type { CompteurVue } from "@/lib/dossiers/compteurs";
import type { ReglagesMailVue } from "@/lib/mail/reglages-vue";
import type { GroupeParametre, ParametreVue } from "@/lib/parametres/definitions";
import { cn } from "@/lib/utils";
import AssistantClaude from "./AssistantClaude";
import Connexions, { type EtatConnexions } from "./Connexions";
import GroupesParametres from "./EcranParametres";
import MarqueEspace from "./MarqueEspace";
import MessagerieSms, { type ReponseSms } from "./MessagerieSms";
import Numerotation from "./Numerotation";
import ReglagesMail from "./ReglagesMail";

/**
 * Mission 13 (lot 3) — Paramètres en cinq onglets : Activité (pilotage,
 * suivi commercial, campagne, simulateur, RGPD, connexions, marque de
 * l'espace), Facturation (encaissements, factures, numérotation ; seuils
 * fiscaux et cotisations derrière « Avancé »), Mail, SMS, Assistant. Tout est
 * rendu par le serveur avec la page : plus de « Chargement… ». Les ancres
 * d'avant (#mail, #sms, #assistant) ouvrent l'onglet correspondant.
 */

type Onglet = "activite" | "facturation" | "mail" | "sms" | "assistant";
const ONGLETS: { valeur: Onglet; libelle: string }[] = [
  { valeur: "activite", libelle: "Activité" },
  { valeur: "facturation", libelle: "Facturation" },
  { valeur: "mail", libelle: "Mail" },
  { valeur: "sms", libelle: "SMS" },
  { valeur: "assistant", libelle: "Assistant" },
];
const CLE_MEMOIRE = "parametres-onglet";
const ANCRES: Record<string, Onglet> = { activite: "activite", connexions: "activite", facturation: "facturation", numerotation: "facturation", mail: "mail", sms: "sms", assistant: "assistant" };
const GROUPES_ACTIVITE: readonly GroupeParametre[] = ["PILOTAGE", "COMMERCIAL", "PUBLICITE", "SIMULATEUR", "RGPD"];
const GROUPES_FACTURATION: readonly GroupeParametre[] = ["ENCAISSEMENT", "FACTURATION"];
const GROUPES_AVANCES: readonly GroupeParametre[] = ["FISCAL", "SOCIAL"];

/** L'onglet mémorisé (client seulement : le serveur rend « Activité », l'hydratation reste juste). */
function lireMemoire(): Onglet {
  try {
    const memorise = window.localStorage.getItem(CLE_MEMOIRE);
    if (memorise && ONGLETS.some((o) => o.valeur === memorise)) return memorise as Onglet;
  } catch {
    // stockage indisponible : premier onglet
  }
  return "activite";
}
const rien = () => () => {};
const lireAncre = () => window.location.hash.replace("#", "");
const surChangementAncre = (rappel: () => void) => {
  window.addEventListener("hashchange", rappel);
  return () => window.removeEventListener("hashchange", rappel);
};

export default function OngletsParametres({
  parametres: initiaux,
  connexions,
  retour,
  mail,
  sms,
  acces,
  consignes,
  compteurs,
}: {
  parametres: ParametreVue[];
  connexions: EtatConnexions;
  retour: { google: string | null; compte: string | null; message: string | null };
  mail: ReglagesMailVue;
  sms: ReponseSms;
  acces: VueAccesAssistant;
  consignes: VueConsignesAssistant;
  compteurs: CompteurVue[];
}) {
  const [parametres, setParametres] = useState(initiaux);
  // L'ancre (#mail, #sms…) l'emporte quand elle change ; un onglet choisi à la main l'emporte tant que l'ancre ne bouge pas ; sinon la mémoire.
  const ancre = useSyncExternalStore(surChangementAncre, lireAncre, () => "");
  const memorise = useSyncExternalStore(rien, lireMemoire, () => "activite" as Onglet);
  const [choix, setChoix] = useState<{ valeur: Onglet; ancre: string } | null>(null);
  const onglet: Onglet = choix && choix.ancre === ancre ? choix.valeur : ancre in ANCRES ? ANCRES[ancre] : memorise;
  const [avance, setAvance] = useState(false);

  function choisir(valeur: Onglet) {
    setChoix({ valeur, ancre });
    try {
      window.localStorage.setItem(CLE_MEMOIRE, valeur);
    } catch {
      // stockage indisponible : l'onglet ne survivra pas au rechargement
    }
  }

  const aRenseigner = parametres.filter((p) => !p.courante && p.groupe !== "AGENT" && !GROUPES_AVANCES.includes(p.groupe)).length;
  const avancesARenseigner = parametres.filter((p) => !p.courante && GROUPES_AVANCES.includes(p.groupe)).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <EnTetePage
        titre="Paramètres"
        sousTitre={aRenseigner > 0 ? <span className="text-[#F5B454]">{aRenseigner} à renseigner : {aRenseigner > 1 ? "ils seront demandés" : "il sera demandé"} à la première utilisation.</span> : "Seuils, taux et règles datés. Une nouvelle valeur ne réécrit jamais le passé."}
      />

      <div role="tablist" aria-label="Rubriques des paramètres" className="mt-4 flex gap-1 overflow-x-auto rounded-[12px] border-[0.5px] border-[#2A2D34] bg-[#1C1F25] p-1">
        {ONGLETS.map((o) => (
          <button
            key={o.valeur}
            type="button"
            role="tab"
            aria-selected={onglet === o.valeur}
            onClick={() => choisir(o.valeur)}
            className={cn("min-h-[44px] shrink-0 rounded-[9px] px-3.5 text-[13.5px] font-medium", onglet === o.valeur ? "bg-[#272B33] text-[#F2F3F5]" : "text-[#9CA3AF] hover:text-[#F2F3F5]", TRANS)}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      {onglet === "activite" ? (
        <>
          <GroupesParametres parametres={parametres} groupes={GROUPES_ACTIVITE} onMisAJour={setParametres} />
          <Connexions retour={retour} initial={connexions} />
          <MarqueEspace />
        </>
      ) : null}

      {onglet === "facturation" ? (
        <>
          <GroupesParametres parametres={parametres} groupes={GROUPES_FACTURATION} onMisAJour={setParametres} />
          <Numerotation initial={compteurs} />
          <section className="mt-8">
            <button type="button" aria-expanded={avance} onClick={() => setAvance((a) => !a)} className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-[10px] px-1 text-left hover:bg-[#1C1F25]", TRANS)}>
              <span className="flex-1 text-[12px] font-medium tracking-wide text-[#9CA3AF] uppercase">Avancé : seuils fiscaux et cotisations</span>
              {avancesARenseigner > 0 ? <span className="text-[12px] text-[#F5B454] tabular-nums">{avancesARenseigner} à renseigner</span> : null}
              <ChevronDown size={16} aria-hidden className={cn("text-[#6B7280] transition-transform", avance && "rotate-180")} />
            </button>
            {avance ? (
              <>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B7280]">Aucune valeur n&apos;est fournie par défaut : chacune se lit à la source indiquée et se fait confirmer par le comptable au besoin.</p>
                <GroupesParametres parametres={parametres} groupes={GROUPES_AVANCES} onMisAJour={setParametres} />
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {onglet === "mail" ? <ReglagesMail initial={mail} /> : null}
      {onglet === "sms" ? <MessagerieSms initial={sms} /> : null}
      {onglet === "assistant" ? (
        <>
          <AssistantClaude initialAcces={acces} initialConsignes={consignes} />
          <GroupesParametres parametres={parametres} groupes={["AGENT"]} onMisAJour={setParametres} />
        </>
      ) : null}
    </div>
  );
}
