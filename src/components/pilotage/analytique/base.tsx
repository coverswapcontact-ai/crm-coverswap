/**
 * Mission 17 (partie B) — les briques de l'écran Analytique (maquettes docs/maquettes/analytique-*.html) : carte,
 * libellé, tuile avec sparkline, mini-indicateur, barres horizontales, tunnel en barres, tableau, badge de verdict,
 * état d'une source non branchée. Sans état ni effet : rendues par le serveur (premier affichage sans attente).
 * Charte : fond #16181D, cartes #1C1F25 bordure 1 px #2A2D34 rayon 14 ; Inter pour le texte, Space Grotesk
 * (`font-heading`) pour les chiffres et les titres ; vert favorable, ambre défavorable, gris neutre, jamais de rouge.
 */
import Link from "next/link";
import { LIBELLES_VERDICT, type EtapeTunnel, type EtatSource, type Indicateur, type SourceDonnees, type Tunnel, type Verdict } from "@/lib/analytique/types";
import { cn } from "@/lib/utils";
import { BoutonRelancer } from "./Relancer";
import { COULEURS_TON, GRIS_ABSENT, evolutionAffichee, formaterValeur, momentSynchro, pointsSparkline, serieVide, titreEvolution } from "./format";

/* ── Classes de la maquette ─────────────────────────────────────────── */

export const CARTE_A = "rounded-[14px] border border-[#2A2D34] bg-[#1C1F25]";
/** Padding des cartes : 16 px au téléphone, 24/26 px à l'ordinateur. */
export const PAD_CARTE = "p-4 md:px-[26px] md:py-6";
/** `.lbl` : 10 px au téléphone, 11 px à l'ordinateur, capitales espacées. */
export const LBL = "text-[10px] md:text-[11px] font-medium uppercase tracking-[0.08em] text-[#9CA3AF] leading-[normal]";
/** `.num` : Space Grotesk, chiffres tabulaires. */
export const NUM = "font-heading tabular-nums tracking-[-0.02em]";
export const TITRE_CARTE = "font-heading text-[16px] md:text-[17px] font-semibold leading-[normal] text-[#F2F3F5]";
export const ENCADRE = "rounded-[10px] bg-[#22262D] px-3 py-2.5 text-[13px] leading-[1.45] text-[#D1D5DB]";

export const LIBELLES_SOURCE_DONNEES: Record<SourceDonnees, string> = {
  CRM: "CRM",
  SITE: "Mesure du site",
  META: "Meta",
  GOOGLE_ADS: "Google Ads",
  SEARCH_CONSOLE: "Search Console",
  FICHE_GOOGLE: "Fiche Google",
};

export function etatDe(sources: EtatSource[], source: SourceDonnees): EtatSource | null {
  return sources.find((etat) => etat.source === source) ?? null;
}

/* ── Carte ──────────────────────────────────────────────────────────── */

export function Carte({
  titre,
  sousTitre,
  action,
  children,
  className,
  id,
  gap = "gap-3 md:gap-[18px]",
}: {
  titre?: React.ReactNode;
  sousTitre?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
  gap?: string;
}) {
  return (
    <section id={id} className={cn(CARTE_A, PAD_CARTE, "flex min-w-0 flex-col", gap, className)}>
      {titre || action ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {titre ? <h2 className={TITRE_CARTE}>{titre}</h2> : null}
            {sousTitre ? <p className="text-[12px] text-[#9CA3AF] md:text-[13px]">{sousTitre}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** « Détail → » vers un onglet. */
export function LienDetail({ href, children = "Détail →" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="text-[13px] text-[#5DCAA5] transition-colors duration-150 hover:text-[#8FE0C3]">
      {children}
    </Link>
  );
}

/* ── Tuiles ─────────────────────────────────────────────────────────── */

export function Sparkline({ serie, couleur, className }: { serie: readonly number[]; couleur: string; className?: string }) {
  if (serieVide(serie)) {
    return (
      <div className={cn("flex h-[22px] items-end md:h-7", className)} aria-hidden>
        <div className="h-1 flex-1 rounded-[2px] bg-[#22262D]" />
      </div>
    );
  }
  return (
    <svg className={cn("block h-[22px] w-full md:h-7", className)} viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden>
      <polyline points={pointsSparkline(serie)} fill="none" stroke={couleur} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** L'évolution à côté d'une valeur : « ▲ 12 % » dans la couleur du sens favorable. */
export function TexteEvolution({ indicateur, className }: { indicateur: Indicateur; className?: string }) {
  const evolution = evolutionAffichee(indicateur.evolution);
  if (!evolution.texte) return null;
  return (
    <span className={cn("text-[12px] whitespace-nowrap", className)} style={{ color: evolution.couleur }} title={titreEvolution(indicateur.evolution, indicateur.format)}>
      {evolution.texte}
    </span>
  );
}

/**
 * Une tuile : libellé, valeur (Space Grotesk 30/26 px), comparaison à la période précédente, phrase courte, sparkline
 * dans la couleur du sens favorable. Source non branchée : « — » et ce qu'il faut faire (jamais un zéro trompeur).
 * Maquette : la phrase courte se lit à côté de la valeur, dans la couleur du ton (vert favorable, ambre défavorable,
 * gris neutre) ; quand il y a aussi une comparaison, la comparaison reste à côté de la valeur et la phrase passe
 * dessous (deux lignes au plus, jamais coupée d'un « … » au téléphone). Au téléphone, un seul pied : la phrase si elle
 * existe, sinon la sparkline ; `libelleCourt` remplace le libellé (« Coût / lead Meta », « Signés », « Visites »).
 */
export function Tuile({
  indicateur,
  etat,
  approximatif = false,
  className,
  libelleCourt,
}: {
  indicateur: Indicateur;
  etat?: EtatSource | null;
  approximatif?: boolean;
  className?: string;
  libelleCourt?: string;
}) {
  const absente = indicateur.valeur === null;
  const evolution = evolutionAffichee(indicateur.evolution);
  const couleurTon = COULEURS_TON[indicateur.evolution.ton];
  const couleurSerie = evolution.texte ? evolution.couleur : couleurTon;
  const detail = indicateur.detail ?? null;
  // La phrase à côté de la valeur quand il n'y a pas de comparaison à montrer (maquette), sinon dessous.
  const detailACote = Boolean(detail) && !evolution.texte;
  const aSerie = indicateur.serie.length > 0;
  return (
    <div className={cn(CARTE_A, "flex min-w-0 flex-col gap-1.5 p-3.5 md:gap-2.5 md:px-5 md:py-[18px]", className)} data-indicateur={indicateur.cle}>
      <div className={cn(LBL, "truncate")} title={indicateur.libelle}>
        {libelleCourt ? (
          <>
            <span className="md:hidden">{libelleCourt}</span>
            <span className="hidden md:inline">{indicateur.libelle}</span>
          </>
        ) : (
          indicateur.libelle
        )}
      </div>
      {absente ? (
        <>
          <div className={cn(NUM, "text-[26px] leading-[normal] font-semibold md:text-[30px]")} style={{ color: GRIS_ABSENT }}>
            —
          </div>
          <p className="line-clamp-3 text-[12px] leading-[1.4] text-[#9CA3AF]">{texteAbsence(indicateur, etat)}</p>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className={cn(NUM, "text-[26px] leading-[normal] font-semibold text-[#F2F3F5] md:text-[30px]")} title={titreEvolution(indicateur.evolution, indicateur.format)}>
              {formaterValeur(indicateur.valeur, indicateur.format, {
                approximatif,
              })}
            </span>
            <TexteEvolution indicateur={indicateur} />
            {detailACote ? (
              <span className="hidden min-w-0 text-[12px] leading-[1.35] md:line-clamp-2" style={{ color: couleurTon }} title={detail ?? undefined}>
                {detail}
              </span>
            ) : null}
          </div>
          {detail ? (
            <p className={cn("line-clamp-2 text-[12px] leading-[1.35]", detailACote && "md:hidden")} style={{ color: couleurTon }} title={detail}>
              {detail}
            </p>
          ) : null}
          {aSerie ? <Sparkline serie={indicateur.serie} couleur={couleurSerie} className={cn("mt-auto", detail && "max-md:hidden")} /> : null}
        </>
      )}
    </div>
  );
}

function texteAbsence(indicateur: Indicateur, etat?: EtatSource | null): string {
  if (etat?.etat === "EN_ECHEC") return etat.derniereReussite ? `Synchronisation en échec ; dernière réussie ${momentSynchro(etat.derniereReussite)}.` : "Synchronisation en échec.";
  if (etat?.aFaire) return etat.aFaire;
  if (etat?.etat === "EN_ATTENTE_ACCES") return "En attente d'accès.";
  return indicateur.detail ?? "Pas encore de données sur la période.";
}

/** Les tuiles : 2 colonnes au téléphone, puis 3, puis toutes sur une ligne (4 à 6) à l'ordinateur. */
export function GrilleTuiles({
  indicateurs,
  sources,
  ordreTelephone,
  libellesCourts,
  estimation = false,
}: {
  indicateurs: Indicateur[];
  sources: EtatSource[];
  ordreTelephone?: string[];
  /** Libellés du téléphone, par clé d'indicateur (maquette : « Coût / lead Meta », « Signés », « Visites »). */
  libellesCourts?: Record<string, string>;
  estimation?: boolean;
}) {
  const colonnes = indicateurs.length >= 6 ? "xl:grid-cols-6" : indicateurs.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4";
  return (
    <section className={cn("grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4", indicateurs.length === 8 ? "lg:grid-cols-4" : colonnes)} aria-label="Indicateurs">
      {indicateurs.map((indicateur) => {
        const rang = ordreTelephone ? ordreTelephone.indexOf(indicateur.cle) : -1;
        return (
          <Tuile
            key={indicateur.cle}
            indicateur={indicateur}
            etat={etatDe(sources, indicateur.source)}
            approximatif={estimation && indicateur.source === "META" && indicateur.format === "euros"}
            libelleCourt={libellesCourts?.[indicateur.cle]}
            className={ordreTelephone ? (rang >= 0 ? ORDRES[rang] : "max-md:order-9") : undefined}
          />
        );
      })}
    </section>
  );
}
const ORDRES = ["max-md:order-1", "max-md:order-2", "max-md:order-3", "max-md:order-4", "max-md:order-5", "max-md:order-6", "max-md:order-7", "max-md:order-8"];

/** Un mini-indicateur des cartes (Publicité Meta, SEO Google, Fiche Google, Argent). */
export function MiniIndicateur({ libelle, valeur, couleur, titre }: { libelle: string; valeur: string; couleur?: string; titre?: string }) {
  return (
    <div className="flex min-w-0 flex-col md:gap-1" title={titre}>
      <div className={cn(LBL, "truncate")}>{libelle}</div>
      <div className={cn(NUM, "truncate text-[20px] leading-[normal] font-semibold md:text-[22px]")} style={{ color: couleur ?? "#F2F3F5" }}>
        {valeur}
      </div>
    </div>
  );
}

export function GrilleMini({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2 md:gap-3">{children}</div>;
}

/* ── Barres ─────────────────────────────────────────────────────────── */

/** Barre de progression (campagne, jauges). */
export function Progression({ ratio, couleur = "#5DCAA5", hauteur = 6, repere, titre }: { ratio: number; couleur?: string; hauteur?: number; repere?: number; titre?: string }) {
  const largeur = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="relative rounded-full bg-[#22262D]" style={{ height: hauteur }} title={titre} role={titre ? "img" : undefined} aria-label={titre}>
      <div className="rounded-full" style={{ height: hauteur, width: `${largeur}%`, background: couleur }} />
      {repere !== undefined ? <div className="absolute w-0.5 bg-[#F2F3F5]" style={{ left: `${repere * 100}%`, top: -4, height: hauteur + 8 }} aria-hidden /> : null}
    </div>
  );
}

export type LigneBarre = {
  cle: string;
  libelle: React.ReactNode;
  valeur: number;
  texte?: string;
  couleur?: string;
  detail?: React.ReactNode;
};

/** Barres horizontales pour comparer : libellé et valeur exacte au-dessus, barre de 4 px proportionnelle au maximum. */
export function BarresHorizontales({
  lignes,
  couleur = "#5DCAA5",
  format = "nombre",
  vide = "Rien sur la période.",
}: {
  lignes: LigneBarre[];
  couleur?: string;
  format?: "nombre" | "euros";
  vide?: string;
}) {
  if (lignes.length === 0) return <p className="text-[13px] text-[#6B7280]">{vide}</p>;
  const max = Math.max(...lignes.map((ligne) => ligne.valeur), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {lignes.map((ligne) => (
        <li key={ligne.cle} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-[#D1D5DB]">{ligne.libelle}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {ligne.detail ? <span className="text-[12px] text-[#6B7280]">{ligne.detail}</span> : null}
              <span className={cn(NUM, "text-[#9CA3AF]")}>{ligne.texte ?? formaterValeur(ligne.valeur, format)}</span>
            </span>
          </div>
          <div className="h-1 rounded-[2px] bg-[#22262D]">
            <div
              className="h-1 rounded-[2px]"
              style={{
                width: `${(Math.max(0, ligne.valeur) / max) * 100}%`,
                background: ligne.couleur ?? couleur,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Tunnel ─────────────────────────────────────────────────────────── */

/** Vert qui s'assombrit d'étape en étape (maquette : #5DCAA5 → #4DB892 → #3FA480 → #2F8F6D). */
export const DEGRADE_TUNNEL = ["#5DCAA5", "#4DB892", "#3FA480", "#2F8F6D", "#26805F", "#1F7254", "#19644A"];

const PERDUS: Record<string, (n: number) => string> = {
  appeles: (n) => `${n} ${n > 1 ? "leads n'ont pas été appelés" : "lead n'a pas été appelé"}.`,
  joints: (n) => `${n} ${n > 1 ? "personnes appelées n'ont pas été jointes" : "personne appelée n'a pas été jointe"}.`,
  devis: (n) => `${n} ${n > 1 ? "personnes jointes n'ont pas reçu de devis" : "personne jointe n'a pas reçu de devis"}.`,
  signes: (n) => `${n} ${n > 1 ? "devis n'ont pas été signés" : "devis n'a pas été signé"}.`,
  simulations: (n) => `${n} ${n > 1 ? "visites n'ont pas lancé de simulation" : "visite n'a pas lancé de simulation"}.`,
  leads: (n) => `${n} ${n > 1 ? "simulations n'ont pas laissé de coordonnées" : "simulation n'a pas laissé de coordonnées"}.`,
};

export function phrasePerte(perte: NonNullable<Tunnel["perteMax"]>): string {
  const phrase = PERDUS[perte.vers];
  return phrase ? phrase(perte.perdus) : `${perte.perdus} de moins à l'étape suivante.`;
}

export type LibelleEtape = { long?: string; court?: string };

/**
 * Le tunnel en barres : chaque étape, son nombre, son taux de passage depuis l'étape précédente. L'étape qui perd le
 * plus a son taux en ambre. `depuis` et `jusqua` bornent les étapes.
 * - `groupes` : les clés où commence un nouveau groupe (« leads » : du site au commercial). Chaque groupe a sa propre
 *   échelle (largeur rapportée à sa première étape) et son dégradé, séparés d'un filet : 45 leads ne deviennent pas un
 *   trait à côté de 812 visites.
 * - `replierAuTelephone` : au téléphone, le premier groupe (visites, simulations) se replie sous « Depuis les visites »
 *   (la maquette commence aux leads).
 * - `sansTaux` : étapes sans taux affiché (maquette : la signature, plus lente, n'en a pas).
 * - `libelles` : libellés de l'écran (ordinateur / téléphone), par clé.
 */
export function TunnelBarres({
  tunnel,
  depuis,
  jusqua,
  compact = false,
  encadre = true,
  groupes = [],
  replierAuTelephone = false,
  sansTaux = [],
  libelles = {},
}: {
  tunnel: Tunnel;
  depuis?: string;
  jusqua?: string;
  compact?: boolean;
  encadre?: boolean;
  groupes?: string[];
  replierAuTelephone?: boolean;
  sansTaux?: string[];
  libelles?: Record<string, LibelleEtape>;
}) {
  const debut = depuis
    ? Math.max(
        0,
        tunnel.etapes.findIndex((etape) => etape.cle === depuis)
      )
    : 0;
  const fin = jusqua ? tunnel.etapes.findIndex((etape) => etape.cle === jusqua) : -1;
  const etapes = tunnel.etapes.slice(debut, fin >= debut ? fin + 1 : undefined).filter((etape) => etape.valeur !== null);
  if (etapes.length === 0) return <p className="text-[13px] text-[#6B7280]">Pas encore de données sur la période.</p>;
  const perte = tunnel.perteMax && etapes.some((etape) => etape.cle === tunnel.perteMax?.vers) ? tunnel.perteMax : null;
  const listes: EtapeTunnel[][] = [];
  for (const etape of etapes) {
    if (listes.length === 0 || groupes.includes(etape.cle)) listes.push([etape]);
    else listes[listes.length - 1].push(etape);
  }
  const rendreGroupe = (groupe: EtapeTunnel[], rang: number) => {
    const reference = Math.max(groupe[0].valeur ?? 0, 1);
    return (
      <ol className={cn("flex flex-col", compact ? "gap-[5px]" : "gap-3 md:gap-3.5")} aria-label={rang === 0 ? "Tunnel" : "Tunnel, suite"}>
        {groupe.map((etape, index) => (
          <EtapeBarre
            key={etape.cle}
            etape={etape}
            index={index}
            reference={reference}
            ambre={perte?.vers === etape.cle}
            sansTaux={index === 0 || sansTaux.includes(etape.cle)}
            libelle={libelles[etape.cle]}
          />
        ))}
      </ol>
    );
  };
  const replier = replierAuTelephone && listes.length > 1;
  return (
    <>
      {listes.map((groupe, rang) => (
        <div key={groupe[0].cle} className={cn("flex flex-col", rang > 0 && "border-t border-dashed border-[#2A2D34] pt-3 md:pt-3.5")} data-groupe-tunnel={groupe[0].cle}>
          {rang === 0 && replier ? (
            <>
              <div className="max-md:hidden">{rendreGroupe(groupe, rang)}</div>
              <details className="group md:hidden">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] text-[#9CA3AF] [&::-webkit-details-marker]:hidden">
                  <span>
                    Depuis les visites&nbsp;: {groupe.map((etape) => `${formaterValeur(etape.valeur, "nombre")} ${(libelles[etape.cle]?.court ?? etape.libelle).toLowerCase()}`).join(" → ")}
                  </span>
                  <span aria-hidden className="transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <div className="pb-1">{rendreGroupe(groupe, rang)}</div>
              </details>
            </>
          ) : (
            rendreGroupe(groupe, rang)
          )}
        </div>
      ))}
      {encadre && perte ? (
        <p className={cn(ENCADRE, "px-3.5 py-3")}>
          L&apos;étape qui perd le plus&nbsp;: <span className="text-[#F5B454]">{perte.libelle}</span>. {phrasePerte(perte)}
        </p>
      ) : null}
    </>
  );
}

function EtapeBarre({ etape, index, reference, ambre, sansTaux, libelle }: { etape: EtapeTunnel; index: number; reference: number; ambre: boolean; sansTaux: boolean; libelle?: LibelleEtape }) {
  const valeur = etape.valeur ?? 0;
  const couleur = DEGRADE_TUNNEL[Math.min(index, DEGRADE_TUNNEL.length - 1)];
  const long = libelle?.long ?? etape.libelle;
  const court = libelle?.court ?? long;
  return (
    <li className="flex flex-col gap-[5px] md:gap-1.5" data-etape={etape.cle}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-[#D1D5DB]">
          {court !== long ? (
            <>
              <span className="md:hidden">{court}</span>
              <span className="hidden md:inline">{long}</span>
            </>
          ) : (
            long
          )}
          {!sansTaux && etape.tauxPassage !== null ? (
            <span className={ambre ? "text-[#F5B454]" : "text-[#D1D5DB] md:text-[#6B7280]"}> · {formaterValeur(etape.tauxPassage, "pourcent", { decimales: 0 })}</span>
          ) : null}
        </span>
        <span className={cn(NUM, "text-[#F2F3F5] md:font-semibold")}>{formaterValeur(valeur, "nombre")}</span>
      </div>
      <div className="h-2 rounded-[4px] bg-[#22262D] md:h-2.5 md:rounded-[5px]">
        {valeur > 0 ? (
          <div
            className="h-2 rounded-[4px] md:h-2.5 md:rounded-[5px]"
            style={{
              width: `${Math.max(1.5, Math.min(1, valeur / reference) * 100)}%`,
              background: couleur,
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

/* ── Badges, tableaux, états ────────────────────────────────────────── */

const TONS_VERDICT: Record<Verdict, string> = {
  GARDER: "bg-[#112B22] text-[#5DCAA5]",
  SURVEILLER: "bg-[#2B2414] text-[#F5B454]",
  COUPER: "bg-[#3A2A10] text-[#F5B454] ring-1 ring-inset ring-[#F5B454]/50",
  ATTENDRE: "bg-[#22262D] text-[#9CA3AF]",
};

export function BadgeVerdict({ verdict, titre }: { verdict: Verdict; titre?: string | null }) {
  return (
    <span
      title={titre ?? undefined}
      className={cn("inline-flex shrink-0 items-center rounded-[20px] px-[9px] py-1 text-[12px] leading-[normal] font-semibold whitespace-nowrap md:px-2.5 md:py-[5px]", TONS_VERDICT[verdict])}
    >
      {LIBELLES_VERDICT[verdict]}
    </span>
  );
}

export type Colonne<L> = {
  cle: string;
  titre: string;
  nombre?: boolean;
  rendu: (ligne: L) => React.ReactNode;
  className?: string;
};

/** Tableau de la maquette (en-têtes `.lbl`, lignes séparées d'un filet) ; défile de côté au téléphone si besoin. */
export function Tableau<L>({
  colonnes,
  lignes,
  cle,
  largeurMin = 520,
  vide = "Rien sur la période.",
  classeLigne,
}: {
  colonnes: Colonne<L>[];
  lignes: L[];
  cle: (ligne: L) => string;
  largeurMin?: number;
  vide?: string;
  classeLigne?: (ligne: L) => string | undefined;
}) {
  if (lignes.length === 0) return <p className="text-[13px] text-[#6B7280]">{vide}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <table className="w-full border-collapse text-[13px]" style={{ minWidth: largeurMin }}>
        <thead>
          <tr>
            {colonnes.map((colonne, index) => (
              <th
                key={colonne.cle}
                scope="col"
                className={cn(LBL, "border-b border-[#2A2D34] py-2 font-medium", colonne.nombre ? "pl-3 text-right" : "text-left", index === 0 && "sticky left-0 bg-[#1C1F25] pr-3", colonne.className)}
              >
                {colonne.titre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => (
            <tr key={cle(ligne)} className={cn("border-b border-[#2A2D34] last:border-b-0", classeLigne?.(ligne))}>
              {colonnes.map((colonne, index) => (
                <td
                  key={colonne.cle}
                  className={cn(
                    "py-[11px] align-middle",
                    colonne.nombre ? cn(NUM, "pl-3 text-right whitespace-nowrap text-[#F2F3F5]") : "text-[#D1D5DB]",
                    index === 0 && "sticky left-0 bg-[#1C1F25] pr-3",
                    colonne.className
                  )}
                >
                  {colonne.rendu(ligne)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pastille({ couleur, taille = 8 }: { couleur: string; taille?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: taille, height: taille, background: couleur }} aria-hidden />;
}

const TITRES_ETAT: Record<EtatSource["etat"], string> = {
  A_JOUR: "À jour",
  EN_ECHEC: "Synchronisation en échec",
  NON_BRANCHEE: "Pas encore branché",
  EN_ATTENTE_ACCES: "En attente d'accès",
};

/** Texte court d'un état de source (en-tête des cartes). */
export function libelleEtat(etat: EtatSource): string {
  if (etat.etat === "EN_ATTENTE_ACCES") return "Accès API en attente";
  if (etat.etat === "NON_BRANCHEE") return "Pas encore branché";
  if (etat.etat === "EN_ECHEC") return "En échec";
  return etat.derniereReussite ? `Synchronisé ${momentSynchro(etat.derniereReussite)}` : "À jour";
}

/** Relançable depuis l'écran : les sources externes (le CRM et le site se lisent en direct). */
export const SOURCES_RELANCABLES: SourceDonnees[] = ["META", "GOOGLE_ADS", "SEARCH_CONSOLE", "FICHE_GOOGLE"];

/**
 * L'état vide d'une source non branchée, en attente d'accès ou en échec : ce qu'il faut faire, la dernière
 * synchronisation réussie, et « Relancer » quand la source est branchée.
 */
export function EtatVideSource({ etat, quoi, compact = false }: { etat: EtatSource | null; quoi: string; compact?: boolean }) {
  const titre = etat ? `${LIBELLES_SOURCE_DONNEES[etat.source]} : ${TITRES_ETAT[etat.etat].toLowerCase()}` : `${quoi} : pas encore de données`;
  return (
    <div className={cn("flex flex-col gap-2 rounded-[10px] border border-dashed border-[#2A2D34]", compact ? "px-3 py-2.5" : "px-4 py-4")} data-etat-source={etat?.etat ?? "INCONNU"}>
      <p className="text-[13px] font-medium text-[#D1D5DB]">
        <span
          className="mr-2 inline-block h-[7px] w-[7px] rounded-full align-middle"
          style={{
            background: etat?.etat === "NON_BRANCHEE" ? GRIS_ABSENT : "#F5B454",
          }}
          aria-hidden
        />
        {titre}
      </p>
      {etat?.etat === "EN_ECHEC" ? (
        <p className="text-[12px] leading-[1.45] text-[#9CA3AF]">
          {etat.derniereReussite ? `Dernière synchronisation réussie ${momentSynchro(etat.derniereReussite)}.` : "Aucune synchronisation réussie pour l'instant."}
          {etat.erreur ? ` ${etat.erreur}` : ""}
        </p>
      ) : null}
      {etat?.aFaire ? <p className="text-[12px] leading-[1.45] text-[#9CA3AF]">{etat.aFaire}</p> : null}
      {!etat ? <p className="text-[12px] text-[#9CA3AF]">Aucune donnée sur la période.</p> : null}
      {etat && SOURCES_RELANCABLES.includes(etat.source) && etat.etat !== "NON_BRANCHEE" ? (
        <div>
          <BoutonRelancer source={etat.source} />
        </div>
      ) : null}
    </div>
  );
}
