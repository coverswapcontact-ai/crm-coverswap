"use client";

import { createContext, use, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronDown, X } from "lucide-react";
import { Bouton, TRANS } from "@/components/pilotage/ui";
import { FAMILLES, LIBELLES_FAMILLE, LIBELLES_ONGLET, ONGLETS_ANALYTIQUE, type ClePeriode, type EtatSource, type Famille, type OngletAnalytique, type Periode } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import { GRIS_ABSENT, momentSynchro } from "./format";
import { BoutonRelancer } from "./Relancer";
import { adresseAnalytique, type RequeteAnalytique } from "./requete";

/**
 * Mission 17 (partie B) — l'en-tête de l'Analytique : titre, état des synchronisations (et « Relancer »), période
 * commune (7 j, 30 j, 90 j, mois en cours, 12 mois, dates libres), onglets, filtre par source de la Vue d'ensemble.
 * Chaque choix change l'adresse (`?onglet=`, `?p=`, `?du=&au=`, `?source=`) : la page serveur recalcule l'écran ;
 * pendant ce temps, l'écran précédent reste affiché, estompé (pas d'écran blanc, pas de saut).
 */

const Navigation = createContext<{
  enCours: boolean;
  aller: (href: string) => void;
}>({ enCours: false, aller: () => undefined });

export function FournisseurAnalytique({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const aller = (href: string) => demarrer(() => router.push(href, { scroll: false }));
  return <Navigation value={{ enCours, aller }}>{children}</Navigation>;
}

/** Le contenu de l'onglet : estompé pendant le recalcul. */
export function ZoneContenu({ children }: { children: React.ReactNode }) {
  const { enCours } = use(Navigation);
  return (
    <div className={cn("flex flex-col gap-3 transition-opacity duration-150 md:gap-6", enCours && "opacity-55")} aria-busy={enCours || undefined}>
      {children}
    </div>
  );
}

/** Un lien de l'en-tête : vraie adresse (nouvel onglet possible), navigation douce au clic simple. */
function LienNavigation({
  href,
  className,
  children,
  actif,
  ...props
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  actif?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { aller } = use(Navigation);
  return (
    <a
      href={href}
      aria-current={actif ? "page" : undefined}
      className={className}
      onClick={(evenement) => {
        if (evenement.metaKey || evenement.ctrlKey || evenement.shiftKey || evenement.altKey || evenement.button !== 0) return;
        evenement.preventDefault();
        aller(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

const PERIODES_BOUTONS: {
  cle: Exclude<ClePeriode, "libre">;
  long: string;
  court: string;
}[] = [
  { cle: "7j", long: "7 jours", court: "7 j" },
  { cle: "30j", long: "30 jours", court: "30 j" },
  { cle: "90j", long: "90 jours", court: "90 j" },
  { cle: "mois", long: "Mois en cours", court: "Mois" },
  { cle: "12m", long: "12 mois", court: "12 mois" },
];

const LIBELLES_ONGLET_COURT: Record<OngletAnalytique, string> = {
  ...LIBELLES_ONGLET,
  seo: "SEO",
};

/** Sources montrées dans l'en-tête : les synchronisations externes (le CRM se lit en direct). */
const SOURCES_ENTETE = ["META", "GOOGLE_ADS", "SEARCH_CONSOLE", "FICHE_GOOGLE", "SITE"] as const;
const NOMS_SOURCE: Record<string, string> = {
  META: "Meta",
  GOOGLE_ADS: "Google Ads",
  SEARCH_CONSOLE: "Search Console",
  FICHE_GOOGLE: "Fiche Google",
  SITE: "Mesure du site",
  CRM: "CRM",
};

function couleurEtat(etat: EtatSource): string {
  if (etat.etat === "A_JOUR") return "var(--color-action-clair)";
  if (etat.etat === "NON_BRANCHEE") return GRIS_ABSENT;
  return "var(--color-attention-texte)";
}

/** « Meta synchronisé à 07:02 », « Search Console à 06:40 », « Fiche Google : en attente d'accès ». */
function texteEtat(etat: EtatSource, maintenant: Date, premier: boolean): string {
  const nom = NOMS_SOURCE[etat.source] ?? etat.source;
  if (etat.etat === "EN_ATTENTE_ACCES") return `${nom} : en attente d'accès`;
  if (etat.etat === "NON_BRANCHEE") return `${nom} : pas encore branché`;
  if (etat.etat === "EN_ECHEC") return `${nom} : en échec${etat.derniereReussite ? `, dernière réussite ${momentSynchro(etat.derniereReussite, maintenant)}` : ""}`;
  if (!etat.derniereReussite) return `${nom} : à jour`;
  return `${nom}${premier ? " synchronisé" : ""} ${momentSynchro(etat.derniereReussite, maintenant)}`;
}

/** Les sources de l'en-tête : branchées, en échec ou en attente ; une source jamais branchée n'encombre pas la ligne. */
function sourcesVisibles(sources: EtatSource[]): EtatSource[] {
  return SOURCES_ENTETE.map((cle) => sources.find((etat) => etat.source === cle)).filter((etat): etat is EtatSource =>
    Boolean(etat && (etat.source === "SITE" ? etat.etat === "EN_ECHEC" : etat.etat !== "NON_BRANCHEE"))
  );
}

function PanneauSources({ sources, maintenant, onFermer }: { sources: EtatSource[]; maintenant: Date; onFermer: () => void }) {
  const liste = SOURCES_ENTETE.map((cle) => sources.find((etat) => etat.source === cle)).filter((etat): etat is EtatSource => Boolean(etat));
  return (
    <div id="panneau-sources" className="rounded-[14px] border border-trait bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium tracking-[0.08em] text-texte-3 uppercase md:text-[11px]">Synchronisations</p>
        <button type="button" onClick={onFermer} aria-label="Fermer" className={cn("rounded-[8px] p-1.5 text-texte-3 hover:bg-surface-2 hover:text-texte", TRANS)}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <ul className="flex flex-col">
        {liste.map((etat) => (
          <li key={etat.source} className="flex flex-col gap-2 border-t border-trait py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] text-texte">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: couleurEtat(etat) }} aria-hidden />
                {NOMS_SOURCE[etat.source]}
                <span className="text-texte-3">
                  · {etat.etat === "A_JOUR" ? "à jour" : etat.etat === "EN_ECHEC" ? "en échec" : etat.etat === "EN_ATTENTE_ACCES" ? "en attente d'accès" : "pas encore branché"}
                  {etat.estimation ? " (estimation)" : ""}
                </span>
              </p>
              <p className="mt-0.5 text-[12px] leading-[1.45] text-texte-3">
                {etat.derniereReussite
                  ? `Dernière synchronisation réussie ${momentSynchro(etat.derniereReussite, maintenant)}.`
                  : etat.source === "SITE"
                    ? "Mesure en direct."
                    : "Aucune synchronisation réussie pour l'instant."}
                {etat.erreur ? ` ${etat.erreur}` : ""}
              </p>
              {etat.aFaire ? <p className="mt-0.5 text-[12px] leading-[1.45] text-texte-3">{etat.aFaire}</p> : null}
            </div>
            {etat.source !== "SITE" && etat.etat !== "NON_BRANCHEE" ? <BoutonRelancer source={etat.source} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChoixDates({ periode, requete, onFermer }: { periode: Periode; requete: RequeteAnalytique; onFermer: () => void }) {
  const { aller } = use(Navigation);
  const [du, setDu] = useState(periode.du);
  const [au, setAu] = useState(periode.au);
  const valide = Boolean(du && au);
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-[14px] border border-trait bg-surface p-4"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        if (!valide) return;
        onFermer();
        aller(
          adresseAnalytique({
            ...requete,
            periode: "libre",
            du: du <= au ? du : au,
            au: du <= au ? au : du,
          })
        );
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-texte-3">
        Du
        <input
          type="date"
          value={du}
          max={au || undefined}
          onChange={(e) => setDu(e.target.value)}
          required
          className="h-11 rounded-[8px] border border-trait bg-fond px-3 text-[16px] text-texte [color-scheme:dark] sm:h-9 sm:text-[13px]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-texte-3">
        Au
        <input
          type="date"
          value={au}
          min={du || undefined}
          onChange={(e) => setAu(e.target.value)}
          required
          className="h-11 rounded-[8px] border border-trait bg-fond px-3 text-[16px] text-texte [color-scheme:dark] sm:h-9 sm:text-[13px]"
        />
      </label>
      <div className="flex gap-2">
        <Bouton type="submit" variante="primaire" disabled={!valide}>
          Afficher
        </Bouton>
        <Bouton variante="fantome" onClick={onFermer}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

export function EnTeteAnalytique({ requete, periode, sources, genereLe }: { requete: RequeteAnalytique; periode: Periode; sources: EtatSource[]; genereLe: string }) {
  const [panneau, setPanneau] = useState<"sources" | "dates" | null>(null);
  const { aller } = use(Navigation);
  const maintenant = new Date(genereLe);
  const visibles = sourcesVisibles(sources);
  const enEchec = sources.filter((etat) => etat.etat === "EN_ECHEC");
  const aJour = sources.filter((etat) => etat.etat === "A_JOUR" && etat.derniereReussite && etat.source !== "CRM" && etat.source !== "SITE");
  // Téléphone : une seule mention — la synchronisation la plus ancienne des sources à jour, ou le nombre d'échecs.
  const plusAncienne = aJour.map((etat) => etat.derniereReussite as string).sort()[0];
  const basculer = (quoi: "sources" | "dates") => setPanneau((ouvert) => (ouvert === quoi ? null : quoi));
  const periodeActive = requete.periode;

  return (
    <header className="flex flex-col gap-3.5 md:gap-6">
      {/* Titre, synchronisations, période */}
      <div className="flex flex-col gap-3.5 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:gap-1.5">
          <h1 className="font-heading text-[28px] leading-[normal] font-semibold tracking-[-0.02em] text-texte md:text-[34px]">Analytique</h1>
          {/* Ordinateur : l'état de chaque source */}
          <button
            type="button"
            onClick={() => basculer("sources")}
            aria-expanded={panneau === "sources"}
            aria-controls="panneau-sources"
            title="Voir les synchronisations et les relancer"
            className="hidden flex-wrap items-center gap-x-4 gap-y-1 rounded-[6px] text-left text-[13px] text-texte-3 hover:text-texte-2 md:flex"
          >
            {visibles.map((etat, index) => (
              <span key={etat.source} className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: couleurEtat(etat) }} aria-hidden />
                {texteEtat(etat, maintenant, index === 0)}
              </span>
            ))}
            {visibles.length === 0 ? <span>Synchronisations</span> : null}
          </button>
          {/* Téléphone : une mention */}
          <button
            type="button"
            onClick={() => basculer("sources")}
            aria-expanded={panneau === "sources"}
            aria-controls="panneau-sources"
            className="-my-2 flex min-h-11 items-center gap-1.5 text-[12px] text-texte-3 md:hidden"
          >
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: enEchec.length > 0 ? "var(--color-attention-texte)" : "var(--color-action-clair)" }} aria-hidden />
            {enEchec.length > 0 ? `${enEchec.length} en échec` : plusAncienne ? `à jour ${momentSynchro(plusAncienne, maintenant).replace(/^à /, "")}` : "à jour"}
          </button>
        </div>

        {/* Période : contrôle segmenté (ordinateur), pastilles (téléphone) */}
        <nav aria-label="Période" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:px-0">
          <ul className="flex gap-2 md:gap-1 md:rounded-[10px] md:border md:border-trait md:bg-surface md:p-1">
            {PERIODES_BOUTONS.map((bouton) => {
              const actif = periodeActive === bouton.cle;
              // Téléphone : « Mois en cours » n'est pas dans la maquette (7 j, 30 j, 90 j, 12 mois, Dates) ; il n'apparaît
              // que choisi, pour que « Dates » tienne dans les 358 px sans défiler.
              return (
                <li key={bouton.cle} className={cn("shrink-0", bouton.cle === "mois" && !actif && "max-md:hidden")}>
                  <LienNavigation
                    href={adresseAnalytique({
                      ...requete,
                      periode: bouton.cle,
                      du: null,
                      au: null,
                    })}
                    actif={actif}
                    className={cn(
                      "flex h-[34px] items-center rounded-[17px] border px-[13px] text-[13px] font-medium whitespace-nowrap md:h-8 md:rounded-[8px] md:border-0 md:px-3.5",
                      actif ? "border-texte bg-texte text-texte-inverse md:bg-surface-2 md:text-texte" : "border-trait bg-surface text-texte-3 hover:text-texte md:bg-transparent",
                      TRANS
                    )}
                  >
                    <span className="md:hidden">{bouton.court}</span>
                    <span className="hidden md:inline">{bouton.long}</span>
                  </LienNavigation>
                </li>
              );
            })}
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => basculer("dates")}
                aria-expanded={panneau === "dates"}
                className={cn(
                  "flex h-[34px] items-center gap-1.5 rounded-[17px] border px-[13px] text-[13px] font-medium whitespace-nowrap md:h-8 md:rounded-[8px] md:border-0 md:px-3.5",
                  periodeActive === "libre"
                    ? "border-texte bg-texte text-texte-inverse md:bg-surface-2 md:text-texte"
                    : "border-trait bg-surface text-texte-3 hover:text-texte md:bg-transparent",
                  TRANS
                )}
              >
                {periodeActive === "libre" ? (
                  <>
                    <CalendarRange size={14} aria-hidden />
                    {periode.libelle}
                  </>
                ) : (
                  <>
                    <span className="md:hidden">Dates</span>
                    <span className="hidden md:inline">Dates…</span>
                  </>
                )}
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {panneau === "sources" ? <PanneauSources sources={sources} maintenant={maintenant} onFermer={() => setPanneau(null)} /> : null}
      {panneau === "dates" ? <ChoixDates periode={periode} requete={requete} onFermer={() => setPanneau(null)} /> : null}

      {/* Onglets, et le filtre par source de la Vue d'ensemble */}
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4 md:border-b md:border-trait">
        <nav aria-label="Onglets de l'Analytique" className="-mx-4 overflow-x-auto border-b border-trait px-4 [scrollbar-width:none] md:mx-0 md:overflow-visible md:border-b-0 md:px-0">
          <ul className="flex gap-[18px] md:gap-1">
            {ONGLETS_ANALYTIQUE.map((onglet) => {
              const actif = requete.onglet === onglet;
              return (
                <li key={onglet} className="shrink-0">
                  <LienNavigation
                    href={adresseAnalytique({ ...requete, onglet })}
                    actif={actif}
                    className={cn(
                      "flex h-11 items-center text-[14px] whitespace-nowrap md:h-10 md:px-3.5 md:text-[13px] md:font-medium",
                      actif ? "text-texte shadow-[inset_0_-2px_0_var(--color-action-clair)]" : "text-texte-3 hover:text-texte",
                      TRANS
                    )}
                  >
                    <span className="md:hidden">{LIBELLES_ONGLET_COURT[onglet]}</span>
                    <span className="hidden md:inline">{LIBELLES_ONGLET[onglet]}</span>
                  </LienNavigation>
                </li>
              );
            })}
          </ul>
        </nav>
        {requete.onglet === "ensemble" ? (
          <label className="flex items-center gap-2 self-start text-[13px] text-texte-3 md:self-auto md:pb-1">
            <span>Source</span>
            <span className="relative">
              <select
                value={requete.source ?? ""}
                onChange={(evenement) =>
                  aller(
                    adresseAnalytique({
                      ...requete,
                      source: (evenement.target.value || null) as Famille | null,
                    })
                  )
                }
                className={cn(
                  "h-9 appearance-none rounded-[8px] border border-trait bg-surface pr-8 pl-3 text-[16px] md:h-8 md:text-[13px]",
                  requete.source ? "text-texte" : "text-texte-3"
                )}
                aria-label="Filtrer par source"
              >
                <option value="">Toutes les sources</option>
                {FAMILLES.map((famille) => (
                  <option key={famille} value={famille}>
                    {LIBELLES_FAMILLE[famille]}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-texte-3" />
            </span>
          </label>
        ) : null}
      </div>
    </header>
  );
}
