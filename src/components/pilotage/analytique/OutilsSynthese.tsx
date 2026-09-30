"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Copy, Download, EyeOff, FileText, Lock } from "lucide-react";
import { toast } from "sonner";
import { appelApi, messageErreur } from "@/components/pilotage/client";
import { Bouton } from "@/components/pilotage/ui";
import { formatDateCourte } from "@/lib/dossiers/dates";
import type { Ecart, InstantaneResume } from "@/lib/synthese/instantanes";
import { GUIDE_LECTURE, libelleAuteur } from "@/lib/synthese/redaction";
import type { SyntheseLue } from "@/lib/synthese/requete";
import type { Alerte as AlerteSynthese } from "@/lib/synthese/types";
import { cn } from "@/lib/utils";
import { Carte, ENCADRE, LBL, NUM, Tableau } from "./base";
import { euros, formaterValeur, moisLong } from "./format";

/**
 * Mission 17 (partie B, relecture) — les outils de l'ancien écran Synthèse, repris dans l'Analytique en appelant les
 * routes /api/synthese existantes (rien n'est recalculé ici) :
 * - onglet Argent, « Mois figés et export » : export Texte et Données de la période choisie, version rédigée à copier,
 *   anonymisation (pseudonymes), mois figés (instantanés : chiffres gelés, empreinte d'intégrité, écarts avec un
 *   recalcul d'aujourd'hui) et le guide de lecture ;
 * - bas de la Vue d'ensemble, « Agent et qualité des données » (ancre #agent-qualite) : alertes de la synthèse,
 *   propositions de l'agent par auteur (acceptation, délai de décision, motifs de rejet, agent mail) et points de
 *   qualité des données.
 * Les pourcentages de la synthèse sont déjà en « pour cent » (12,5 = 12,5 %), pas en ratio.
 */

const pct = (valeur: number | null) => (valeur === null ? "—" : `${String(valeur).replace(".", ",")} %`);
const nombre = (valeur: number) => formaterValeur(valeur, "nombre");

function adresseSynthese(chemin: string, parametres: Record<string, string | null>): string {
  const recherche = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(parametres)) if (valeur !== null) recherche.set(cle, valeur);
  const texte = recherche.toString();
  return texte ? `${chemin}?${texte}` : chemin;
}

/** Les adresses des routes /api/synthese (pures : testées). */
export const routesSynthese = {
  lecture: (du: string, au: string, anonyme: boolean) => adresseSynthese("/api/synthese", { du, au, anonyme: anonyme ? "1" : null }),
  export: (du: string, au: string, format: "texte" | "json", anonyme: boolean) => adresseSynthese("/api/synthese/export", { du, au, format, anonyme: anonyme ? "1" : null }),
  instantanes: () => "/api/synthese/instantanes",
  instantane: (mois: string, anonyme: boolean) => adresseSynthese(`/api/synthese/instantanes/${mois}`, { anonyme: anonyme ? "1" : null }),
};

function copier(texte: string) {
  void navigator.clipboard.writeText(texte).then(
    () => toast.success("Synthèse copiée"),
    () => toast.error("Copie impossible")
  );
}

const BOUTON_LIEN = "inline-flex h-11 items-center gap-1.5 rounded-[8px] border border-[#2A2D34] px-3 text-[13px] font-medium text-[#D1D5DB] transition-colors duration-150 hover:border-[#3A3E47] hover:text-[#F2F3F5] sm:h-8";

type InstantaneOuvert = { mois: string; figeLe: string; integre: boolean; ecarts: Ecart[]; synthese: SyntheseLue["synthese"]; redaction: string };

/* ── Mois figés et export (onglet Argent) ─────────────────────────────── */

export function MoisFigesEtExport({ du, au, libellePeriode }: { du: string; au: string; libellePeriode: string }) {
  const [anonyme, setAnonyme] = useState(false);
  const [redaction, setRedaction] = useState<string | null>(null);
  const [chargement, setChargement] = useState<string | null>(null);
  const [instantanes, setInstantanes] = useState<InstantaneResume[] | null>(null);
  const [erreurListe, setErreurListe] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<InstantaneOuvert | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<InstantaneResume[]>(routesSynthese.instantanes())
      .then((liste) => actif && setInstantanes(liste))
      .catch((erreur) => actif && setErreurListe(messageErreur(erreur)));
    return () => {
      actif = false;
    };
  }, []);

  async function lireRedaction(pseudonymes: boolean) {
    setChargement("redaction");
    try {
      const lue = await appelApi<SyntheseLue>(routesSynthese.lecture(du, au, pseudonymes));
      setRedaction(lue.redaction);
    } catch (erreur) {
      toast.error("Synthèse indisponible", { description: messageErreur(erreur) });
    } finally {
      setChargement(null);
    }
  }

  async function ouvrirInstantane(mois: string, pseudonymes: boolean) {
    setChargement(mois);
    try {
      const lu = await appelApi<Omit<InstantaneOuvert, "mois">>(routesSynthese.instantane(mois, pseudonymes));
      setOuvert({ mois, figeLe: lu.figeLe, integre: lu.integre, ecarts: lu.ecarts, synthese: lu.synthese, redaction: lu.redaction });
    } catch (erreur) {
      toast.error("Instantané indisponible", { description: messageErreur(erreur) });
    } finally {
      setChargement(null);
    }
  }

  function basculerAnonyme() {
    const suivant = !anonyme;
    setAnonyme(suivant);
    if (redaction !== null) void lireRedaction(suivant);
    if (ouvert) void ouvrirInstantane(ouvert.mois, suivant);
  }

  return (
    <Carte id="mois-figes" titre="Mois figés et export" sousTitre={`Synthèse ${libellePeriode.toLowerCase()} à emporter ; chaque mois écoulé est figé, jamais recalculé.`} gap="gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Bouton variante={anonyme ? "primaire" : "secondaire"} taille="sm" icone={<EyeOff size={13} aria-hidden />} onClick={basculerAnonyme} aria-pressed={anonyme}>
          {anonyme ? "Anonymisée" : "Anonymiser"}
        </Bouton>
        <a href={routesSynthese.export(du, au, "texte", anonyme)} className={BOUTON_LIEN}>
          <Download size={13} aria-hidden /> Texte
        </a>
        <a href={routesSynthese.export(du, au, "json", anonyme)} className={BOUTON_LIEN}>
          <Download size={13} aria-hidden /> Données
        </a>
        <Bouton
          taille="sm"
          variante="fantome"
          icone={<FileText size={13} aria-hidden />}
          chargement={chargement === "redaction"}
          aria-expanded={redaction !== null}
          onClick={() => (redaction === null ? void lireRedaction(anonyme) : setRedaction(null))}
        >
          {redaction === null ? "Version rédigée" : "Masquer la version rédigée"}
        </Bouton>
      </div>
      {anonyme ? <p className="text-[12px] text-[#9CA3AF]">Noms remplacés par des pseudonymes stables, dans l&apos;export comme dans la version rédigée.</p> : null}

      {redaction !== null ? <TexteRedige texte={redaction} titre={`Version rédigée, ${libellePeriode.toLowerCase()}`} /> : null}

      <div className="flex flex-col gap-2">
        <p className={LBL}>Mois figés</p>
        {erreurListe ? (
          <p className="text-[13px] text-[#F5B454]">Mois figés illisibles&nbsp;: {erreurListe}</p>
        ) : instantanes === null ? (
          <p className="text-[13px] text-[#6B7280]">Chargement…</p>
        ) : instantanes.length === 0 ? (
          <p className="text-[13px] text-[#6B7280]">Aucun mois figé pour l&apos;instant&nbsp;: chaque mois écoulé l&apos;est automatiquement.</p>
        ) : (
          <ul className="flex flex-col">
            {instantanes.map((ligne) => (
              <li key={ligne.mois} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#2A2D34] py-2.5 text-[13px] last:border-b-0" data-mois-fige={ligne.mois}>
                <span className="min-w-[124px] font-medium text-[#F2F3F5]">{moisLong(ligne.mois)}</span>
                <span className="text-[#9CA3AF]">
                  encaissé <span className={cn(NUM, "text-[#D1D5DB]")}>{ligne.encaisse === null ? "—" : euros(ligne.encaisse)}</span>
                </span>
                <span className="text-[#9CA3AF]">
                  {nombre(ligne.dossiersOuverts)} dossiers · {nombre(ligne.signatures)} signatures
                </span>
                <span className="text-[12px] text-[#6B7280]">figé le {formatDateCourte(ligne.figeLe)}</span>
                <Bouton
                  taille="sm"
                  variante="fantome"
                  className="ml-auto"
                  chargement={chargement === ligne.mois}
                  aria-expanded={ouvert?.mois === ligne.mois}
                  onClick={() => (ouvert?.mois === ligne.mois ? setOuvert(null) : void ouvrirInstantane(ligne.mois, anonyme))}
                >
                  {ouvert?.mois === ligne.mois ? "Fermer" : "Voir"}
                </Bouton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {ouvert ? <InstantaneDetail instantane={ouvert} /> : null}

      <details className="group rounded-[10px] border border-[#2A2D34] px-3.5 py-2.5">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-[13px] text-[#D1D5DB] [&::-webkit-details-marker]:hidden">
          <BookOpen size={14} aria-hidden /> Guide de lecture de la synthèse
        </summary>
        <dl className="mt-2 flex flex-col gap-2.5">
          {GUIDE_LECTURE.map((entree) => (
            <div key={entree.titre}>
              <dt className="text-[13px] font-medium text-[#F2F3F5]">{entree.titre}</dt>
              <dd className="mt-0.5 text-[12px] leading-[1.45] text-[#9CA3AF]">{entree.texte}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Carte>
  );
}

function TexteRedige({ texte, titre }: { texte: string; titre: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[#16181D] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className={LBL}>{titre}</p>
        <Bouton taille="sm" variante="fantome" icone={<Copy size={13} aria-hidden />} onClick={() => copier(texte)}>
          Copier
        </Bouton>
      </div>
      <pre className="max-h-[420px] overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap text-[#D1D5DB]">{texte}</pre>
    </div>
  );
}

function InstantaneDetail({ instantane }: { instantane: InstantaneOuvert }) {
  const { synthese } = instantane;
  const chiffres: [string, string][] = [
    ["Encaissé", synthese.finances.encaisse === null ? "—" : euros(synthese.finances.encaisse)],
    ["Dépenses", euros(synthese.finances.depenses)],
    ["Marge brute", synthese.finances.margeBrute === null ? "—" : euros(synthese.finances.margeBrute)],
    ["Devis émis", nombre(synthese.commercial.activite.devisEmis)],
    ["Signatures", `${nombre(synthese.commercial.activite.signatures)} · ${euros(synthese.commercial.activite.montantSigne)}`],
    ["Dossiers ouverts", nombre(synthese.commercial.cohorte.ouverts)],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-[#2A2D34] p-3.5" data-instantane={instantane.mois}>
      <p className="flex items-start gap-2 text-[13px] text-[#D1D5DB]">
        <Lock size={15} aria-hidden className="mt-0.5 shrink-0 text-[#93C5FD]" />
        <span>
          {moisLong(instantane.mois)}, figé le {formatDateCourte(instantane.figeLe)}&nbsp;: ces chiffres ne se recalculent pas.{" "}
          {instantane.integre ? (
            <span className="text-[#5DCAA5]">Empreinte conforme.</span>
          ) : (
            <span className="font-medium text-[#F5B454]">Empreinte non conforme&nbsp;: contenu altéré hors de l&apos;application.</span>
          )}
        </span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
        {chiffres.map(([libelle, valeur]) => (
          <div key={libelle} className="flex flex-col gap-0.5">
            <dt className={LBL}>{libelle}</dt>
            <dd className={cn(NUM, "text-[16px] text-[#F2F3F5]")}>{valeur}</dd>
          </div>
        ))}
      </dl>
      {instantane.ecarts.length === 0 ? (
        <p className="text-[12px] text-[#6B7280]">Aucun écart avec un recalcul d&apos;aujourd&apos;hui.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-[12px] text-[#9CA3AF]">Écarts avec un recalcul d&apos;aujourd&apos;hui (saisie tardive ou correction)&nbsp;:</p>
          <ul className="flex flex-col gap-0.5 text-[12px] text-[#F5B454]">
            {instantane.ecarts.map((ecart) => (
              <li key={ecart.indicateur}>
                {ecart.indicateur}&nbsp;: figé {ecart.fige ?? "—"}, aujourd&apos;hui {ecart.recalcule ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      )}
      <TexteRedige texte={instantane.redaction} titre={`Version rédigée, ${moisLong(instantane.mois).toLowerCase()} (figé)`} />
    </div>
  );
}

/* ── Agent et qualité des données (bas de la Vue d'ensemble) ───────────── */

const COULEURS_ALERTE: Record<AlerteSynthese["gravite"], string> = { URGENT: "#F5B454", ATTENTION: "#F5B454", INFO: "#9CA3AF" };

export function AgentEtQualite({ du, au }: { du: string; au: string }) {
  const [lue, setLue] = useState<SyntheseLue | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    appelApi<SyntheseLue>(routesSynthese.lecture(du, au, false))
      .then((resultat) => actif && setLue(resultat))
      .catch((raison) => actif && setErreur(messageErreur(raison)));
    return () => {
      actif = false;
    };
  }, [du, au]);

  return (
    <Carte id="agent-qualite" titre="Agent et qualité des données" sousTitre="Propositions de l'agent, points à corriger dans les données, alertes de la synthèse" gap="gap-4">
      {erreur ? (
        <p className="text-[13px] text-[#F5B454]">Synthèse illisible&nbsp;: {erreur}</p>
      ) : !lue ? (
        <p className="text-[13px] text-[#6B7280]">Chargement…</p>
      ) : (
        <ContenuAgent lue={lue} />
      )}
    </Carte>
  );
}

function ContenuAgent({ lue }: { lue: SyntheseLue }) {
  const { agent, qualite } = lue.synthese;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-3">
        <p className={LBL}>Agent et propositions</p>
        <Tableau
          largeurMin={620}
          lignes={agent.parAuteur}
          cle={(ligne) => ligne.auteur}
          vide="Aucune proposition sur la période."
          colonnes={[
            { cle: "auteur", titre: "Auteur", rendu: (ligne) => <span className="text-[#F2F3F5]">{libelleAuteur(ligne.auteur)}</span> },
            { cle: "proposees", titre: "Proposées", nombre: true, rendu: (ligne) => nombre(ligne.proposees) },
            { cle: "validees", titre: "Validées", nombre: true, rendu: (ligne) => nombre(ligne.validees) },
            { cle: "modifiees", titre: "Corrigées", nombre: true, rendu: (ligne) => nombre(ligne.modifiees) },
            { cle: "rejetees", titre: "Rejetées", nombre: true, rendu: (ligne) => nombre(ligne.rejetees) },
            { cle: "expirees", titre: "Expirées", nombre: true, rendu: (ligne) => nombre(ligne.expirees) },
            { cle: "attente", titre: "En attente", nombre: true, rendu: (ligne) => nombre(ligne.enAttente) },
            { cle: "taux", titre: "Acceptation", nombre: true, rendu: (ligne) => pct(ligne.tauxAcceptation) },
            {
              cle: "delai",
              titre: "Décision",
              nombre: true,
              rendu: (ligne) => (ligne.delaiDecisionMedianHeures === null ? "—" : `${String(ligne.delaiDecisionMedianHeures).replace(".", ",")} h`),
            },
          ]}
        />
        {agent.motifsRejet.length ? <p className="text-[12px] leading-[1.45] text-[#9CA3AF]">Motifs de rejet&nbsp;: {agent.motifsRejet.map((motif) => `${motif.libelle} (${motif.valeur})`).join(", ")}</p> : null}
        {agent.mails && agent.mails.recus > 0 ? (
          <p className="text-[12px] leading-[1.45] text-[#9CA3AF]">
            Mails&nbsp;: {agent.mails.recus} reçus · {agent.mails.rangesSeuls} rangés seuls chez un client ({agent.mails.rangementsCorriges} rangés ailleurs ensuite) · {agent.mails.bruitArchiveSeul}{" "}
            publicités archivées seules ({agent.mails.bruitAnnule} remises dans la boîte) · {agent.mails.restantATrier} encore à trier · {agent.mails.lecturesIa} lectures par l&apos;IA (
            {euros(agent.mails.coutIa, { decimales: 2 })})
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className={LBL}>Qualité des données</p>
          {qualite.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Rien à signaler.</p>
          ) : (
            <ul className="flex flex-col">
              {qualite.map((point) => (
                <li key={point.cle} className="flex items-baseline justify-between gap-3 border-b border-[#2A2D34] py-2 text-[13px] last:border-b-0">
                  <span className="text-[#D1D5DB]">{point.libelle}</span>
                  <span className={cn(NUM, "text-[#F5B454]")}>{nombre(point.valeur)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lue.alertes.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className={LBL}>Alertes de la synthèse</p>
            <ul className="flex flex-col gap-2">
              {lue.alertes.map((alerte) => (
                <li key={alerte.code} className={cn(ENCADRE, "flex items-start gap-2")} style={{ color: COULEURS_ALERTE[alerte.gravite] }} data-gravite={alerte.gravite}>
                  <span aria-hidden>●</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{alerte.titre}</span>
                    <span className="block text-[12px] text-[#9CA3AF]">{alerte.detail}</span>
                  </span>
                  {alerte.lien ? (
                    <Link href={alerte.lien} className="shrink-0 text-[12px] text-[#5DCAA5] hover:text-[#8FE0C3]">
                      Voir
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
